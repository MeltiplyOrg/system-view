import { describe, expect, test } from "vite-plus/test";
import { parseDesign, type Design } from "../src/design";
import { connectComponents } from "../src/construction";
import { resizeReplicas } from "../src/replicas";

/** Exercise the public document operations, not a second copy of the type matrix. */
function world(...ids: string[]): Design {
  return {
    version: 1,
    name: "Rules",
    instances: ids.map((id) => ({ id })),
    connections: [],
    clusters: [],
  };
}

describe("component relationships", () => {
  test("rejects direct browser database access in construction and imports", () => {
    const design = world("web-client", "db-metadata");
    expect(() =>
      connectComponents(design, "web-client", "db-metadata"),
    ).toThrow(/cannot connect/i);
    expect(() =>
      parseDesign(
        JSON.stringify({
          ...design,
          connections: [{ from: "web-client", to: "db-metadata" }],
        }),
      ),
    ).toThrow(/cannot connect/i);
    expect(design.connections).toEqual([]);
  });
  test("logical services and SQLite cannot become machine replicas", () => {
    for (const id of [
      "web-client",
      "cdn-edge",
      "queue-jobs",
      "storage-media",
      "db-embedded",
    ]) {
      const design = world(id);
      if (id === "db-embedded") design.instances[0].provider = "sqlite";
      expect(() => resizeReplicas(design, id, 2)).toThrow(/replica|scal/i);
      expect(() =>
        parseDesign(
          JSON.stringify({
            ...design,
            instances: [
              design.instances[0],
              { ...design.instances[0], id: `${id}-copy` },
            ],
            clusters: [{ instances: [id, `${id}-copy`] }],
          }),
        ),
      ).toThrow(/replica|scal/i);
    }
    expect(
      resizeReplicas(world("compute-api"), "compute-api", 3).clusters[0]
        .instances,
    ).toHaveLength(3);
  });
  test("rejects mixed replica products and SQLite server-to-server replication", () => {
    for (const providers of [
      ["sqlite", "postgresql"],
      ["postgresql", "mysql"],
    ]) {
      const design = world("db-a", "db-b");
      design.instances.forEach((node, index) => {
        node.provider = providers[index];
      });
      expect(() => connectComponents(design, "db-a", "db-b")).toThrow(
        /replica/,
      );
      expect(() =>
        parseDesign(
          JSON.stringify({
            ...design,
            clusters: [{ instances: ["db-a", "db-b"] }],
          }),
        ),
      ).toThrow(/replica/i);
    }
    const mixed = world("compute-api", "db-data");
    expect(() =>
      parseDesign(
        JSON.stringify({
          ...mixed,
          clusters: [{ instances: ["compute-api", "db-data"] }],
        }),
      ),
    ).toThrow(/same component type/);
  });

  test("requires an explicit branch output and permits each port to reach the same destination independently", () => {
    const design = world("branch-route", "compute-api");
    expect(() =>
      connectComponents(design, "branch-route", "compute-api"),
    ).toThrow(/output port/);
    const yes = connectComponents(
      design,
      "branch-route",
      "compute-api",
      "",
      "true",
    );
    const both = connectComponents(
      yes,
      "branch-route",
      "compute-api",
      "",
      "false",
    );
    expect(
      parseDesign(JSON.stringify(both)).connections.map((link) => link.outlet),
    ).toEqual(["true", "false"]);
    expect(() =>
      connectComponents(both, "branch-route", "compute-api", "", "true"),
    ).toThrow(/already/);
    expect(() =>
      parseDesign(
        JSON.stringify({
          ...both,
          connections: [
            { from: "branch-route", to: "compute-api", outlet: "maybe" },
          ],
        }),
      ),
    ).toThrow(/output port/);
  });
});
