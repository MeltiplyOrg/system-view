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
        instances: ["db-a", "db-b", "web-a", "cache-a", "cache-b"],
        clusters: [
          { instances: ["db-a", "db-b"] },
          { instances: ["cache-a", "cache-b"] },
        ],
        connections: [
          { from: "web-a", to: "db-b", relation: "SQL" },
          { from: "web-a", to: "db-a", relation: "SQL" },
          { from: "db-a", to: "db-b" },
        ],
      }),
    );
    const result = resizeReplicas(original, "db-b", 1);
    expect(result.connections).toEqual([
      { from: "web-a", to: "db-a", relation: "SQL" },
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
});
