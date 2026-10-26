import { describe, expect, test } from "vite-plus/test";
import { parseDesign, webAppExample } from "../src/design";
import { layoutDesign } from "../src/layout";
import { resizeReplicas } from "../src/replicas";

/** Replica edits must stay exportable and keep existing network endpoints valid. */
describe("replica resizing", () => {
  test("promotes an instance, preserves presentation, and collapses back to one", () => {
    const original = structuredClone(webAppExample);
    const expanded = resizeReplicas(original, "compute-api", 10);
    const cluster = expanded.clusters[0];
    expect(cluster.instances).toHaveLength(10);
    expect(new Set(cluster.instances).size).toBe(10);
    expect(
      expanded.instances.find((item) => item.id === cluster.instances[9]),
    ).toMatchObject({
      label: "Backend API",
      description: original.instances.find((item) => item.id === "compute-api")!
        .description,
    });
    expect(expanded.connections).toEqual(original.connections);
    expect(parseDesign(JSON.stringify(expanded))).toEqual(expanded);
    const collapsed = resizeReplicas(expanded, cluster.instances[9], 1);
    expect(collapsed).toEqual(original);
    expect(webAppExample).toEqual(original);
  });

  test("promoting a database keeps its column and link direction", () => {
    const before = layoutDesign(webAppExample),
      after = layoutDesign(resizeReplicas(webAppExample, "db-app", 3)),
      original = before.instances.find(({ id }) => id === "db-app")!,
      promoted = after.instances.find(({ id }) => id === "db-app")!;
    expect(promoted.position).toEqual(original.position);
    expect(
      after.instances.find(({ id }) => id === "compute-api")!.position.x,
    ).toBeLessThan(promoted.position.x);
  });

  test("retargets removed endpoints, drops internal self links, and preserves other cluster IDs", () => {
    const original = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Resize",
        instances: ["db-a", "db-b", "compute-a", "cache-a", "cache-b"],
        clusters: [
          { instances: ["db-a", "db-b"] },
          { instances: ["cache-a", "cache-b"] },
        ],
        connections: [
          { from: "compute-a", to: "db-b", relation: "SQL" },
          { from: "compute-a", to: "db-a", relation: "SQL" },
          { from: "db-a", to: "db-b" },
        ],
      }),
    );
    const result = resizeReplicas(original, "db-b", 1);
    expect(result.connections).toEqual([
      { from: "compute-a", to: "db-a", relation: "SQL" },
    ]);
    expect(result.clusters[0].id).toBe("cluster-2");
    expect(parseDesign(JSON.stringify(result))).toEqual(result);
  });

  test("skips colliding replica IDs and rejects out-of-range counts", () => {
    const original = structuredClone(webAppExample);
    original.instances.push({ id: "compute-api-replica-2" });
    const result = resizeReplicas(original, "compute-api", 2);
    expect(result.clusters[0].instances).toEqual([
      "compute-api",
      "compute-api-replica-3",
    ]);
    for (const count of [0, 11, 1.5, NaN])
      expect(() => resizeReplicas(original, "compute-api", count)).toThrow(
        "1 to 10",
      );
  });

  test("shrinks an existing cluster without mutating it and redirects removed sources", () => {
    const original = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Shrink",
        instances: ["db-a", "db-b", "db-c", "compute-a"],
        clusters: [{ id: "databases", instances: ["db-a", "db-b", "db-c"] }],
        connections: [{ from: "db-c", to: "compute-a", relation: "results" }],
      }),
    );
    const resized = resizeReplicas(original, "db-b", 2);
    expect(resized.clusters[0].instances).toEqual(["db-a", "db-b"]);
    expect(resized.connections).toEqual([
      { from: "db-a", to: "compute-a", relation: "results" },
    ]);
    expect(original.clusters[0].instances).toEqual(["db-a", "db-b", "db-c"]);
    expect(resizeReplicas(resized, "db-b", 2)).toEqual(resized);
    expect(
      resizeReplicas(resized, "db-b", 1).instances.find((i) => i.id === "db-a"),
    ).toEqual({ id: "db-a" });
  });

  test("preserves existing cluster IDs when promoting an unnamed instance", () => {
    const original = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Independent clusters",
        instances: ["db-a", "db-b", "compute-a"],
        clusters: [{ id: "replicas-1", instances: ["db-a", "db-b"] }],
        connections: [],
      }),
    );
    const resized = resizeReplicas(original, "compute-a", 2);
    expect(resized.clusters.map((c) => c.id)).toEqual([
      "replicas-1",
      "replicas-2",
    ]);
    expect(resized.clusters[1].label).toBe("compute-a");
    expect(resized.clusters[0].instances).toEqual(["db-a", "db-b"]);
    expect(parseDesign(JSON.stringify(resized))).toEqual(resized);
  });

  test("rejects an unknown instance without altering the design", () => {
    const original = structuredClone(webAppExample);
    expect(() => resizeReplicas(original, "missing", 2)).toThrow(
      "Unknown instance",
    );
    expect(original).toEqual(webAppExample);
  });

  test("anchors new replicas beside a manual site instead of copying its exact placement", () => {
    const original = {
      ...structuredClone(webAppExample),
      connections: [],
      clusters: [],
      instances: [{ id: "compute-machine", placement: { x: -640, y: 360 } }],
    };
    const expanded = resizeReplicas(original, "compute-machine", 3);
    const sites = layoutDesign(expanded).instances.map(
      ({ position }) => position,
    );
    expect(sites[0]).toEqual({ x: -640, y: 360, z: 0 });
    expect(new Set(sites.map(({ x, y }) => `${x},${y}`)).size).toBe(3);
    expect(sites.every(({ x }) => x === -640)).toBe(true);
    expect(sites[1].y).toBeGreaterThan(sites[0].y);
    expect(sites[2].y).toBeGreaterThan(sites[1].y);
    expect(parseDesign(JSON.stringify(expanded))).toEqual(expanded);
    const collapsed = resizeReplicas(expanded, "compute-machine", 1);
    expect(collapsed.instances.map(({ id }) => id)).toEqual([
      "compute-machine",
    ]);
    expect(collapsed.instances[0].placement).toEqual(
      original.instances[0].placement,
    );
  });

  test("cannot bypass the shared component limit by adding replicas", () => {
    const full = {
      ...structuredClone(webAppExample),
      connections: [],
      clusters: [],
      instances: Array.from({ length: 64 }, (_, index) => ({
        id: `compute-${index}`,
      })),
    };
    expect(() => resizeReplicas(full, "compute-0", 2)).toThrow("64");
    expect(full.instances).toHaveLength(64);
  });
});
