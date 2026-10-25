/**
 * Automatic layout tests. They pin the deterministic placement contract and
 * prove colors are unique and cluster grouping changes the shared footprint.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { example } from "../src/design";
import { inferInstanceType, layoutDesign, instanceColor } from "../src/layout";

/** Build a minimal document around the supplied instances and clusters. */
function design(
  instances: Design["instances"],
  clusters: Design["clusters"] = [],
): Design {
  return { version: 1, name: "Layout", instances, connections: [], clusters };
}

describe("automatic layout", () => {
  test("places cluster members in one column with distinct colors", () => {
    const layout = layoutDesign(example);
    expect(layout.instances.map((instance) => instance.position)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 176, z: 0 },
      { x: 0, y: 352, z: 0 },
    ]);
    expect(layout.instances.map((instance) => instance.type)).toEqual([
      "database-rack",
      "database-rack",
      "database-rack",
    ]);
    expect(
      new Set(layout.instances.map((instance) => instance.color)).size,
    ).toBe(3);
    expect(layout.clusters).toEqual([
      {
        id: "cluster-1",
        label: "Database cluster",
        bounds: { x: -144, y: -75, width: 288, height: 502 },
      },
    ]);
  });

  test("keeps unclustered instances in separate columns and falls back to IDs", () => {
    const layout = layoutDesign(design([{ id: "db-a" }, { id: "db-b" }]));
    expect(
      layout.instances.map(({ label, position }) => ({ label, position })),
    ).toEqual([
      { label: "db-a", position: { x: 0, y: 0, z: 0 } },
      { label: "db-b", position: { x: 420, y: 0, z: 0 } },
    ]);
    expect(layout.clusters).toEqual([]);
  });

  test("derives cluster fallbacks and supports multiple group columns", () => {
    const layout = layoutDesign(
      design(
        [{ id: "db-a" }, { id: "db-b" }, { id: "db-c" }],
        [{ instances: ["db-a", "db-b"] }, { id: "third", instances: ["db-c"] }],
      ),
    );
    expect(layout.instances.map((instance) => instance.position.x)).toEqual([
      0, 0, 420,
    ]);
    expect(layout.clusters).toEqual([
      {
        id: "cluster-1",
        label: "cluster-1",
        bounds: { x: -144, y: -75, width: 288, height: 326 },
      },
      {
        id: "third",
        label: "third",
        bounds: { x: 276, y: -75, width: 288, height: 150 },
      },
    ]);
  });

  test("assigns a different color to every supported instance", () => {
    const instances = Array.from({ length: 64 }, (_, index) => ({
      id: `db-${index}`,
    }));
    const colors = layoutDesign(design(instances)).instances.map(
      (instance) => instance.color,
    );
    expect(new Set(colors).size).toBe(64);
    expect(colors.slice(0, 3)).toEqual(["#ff9d52", "#42d9e8", "#b49aff"]);
    expect(colors.every((color) => /^#[\da-f]{6}$/.test(color))).toBe(true);
    expect(instanceColor(64)).toBe(colors[0]);
  });

  test("infers types from ID prefixes and keeps unknown IDs renderable", () => {
    for (const id of ["db-01", "database.primary", "rack_main"])
      expect(inferInstanceType(id)).toBe("database-rack");
    expect(inferInstanceType("worker-01")).toBe("database-rack");
  });

  test("rejects cluster members that bypassed validation", () => {
    expect(() =>
      layoutDesign(
        design([{ id: "db-a" }], [{ instances: ["db-a", "missing"] }]),
      ),
    ).toThrow("unknown instance");
  });

  test("keeps a declared cluster caption even when its ID looks internal", () => {
    const layout = layoutDesign(
      design(
        [{ id: "db-a" }],
        [{ id: "instance:custom", label: "Custom", instances: ["db-a"] }],
      ),
    );
    expect(layout.clusters).toEqual([
      {
        id: "instance:custom",
        label: "Custom",
        bounds: { x: -144, y: -75, width: 288, height: 150 },
      },
    ]);
  });
});
