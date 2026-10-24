/**
 * Automatic layout tests. They pin the deterministic placement contract and
 * prove colors are unique and cluster grouping changes the shared footprint.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { example } from "../src/design";
import { inferNodeType, layoutDesign, nodeColor } from "../src/layout";

/** Build a minimal document around the supplied nodes and clusters. */
function design(
  nodes: Design["nodes"],
  clusters: Design["clusters"] = [],
): Design {
  return { version: 1, name: "Layout", nodes, connections: [], clusters };
}

describe("automatic layout", () => {
  test("places cluster members in one column with distinct colors", () => {
    const layout = layoutDesign(example);
    expect(layout.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 128, z: 0 },
      { x: 0, y: 256, z: 0 },
    ]);
    expect(layout.nodes.map((node) => node.type)).toEqual([
      "database-rack",
      "database-rack",
      "database-rack",
    ]);
    expect(new Set(layout.nodes.map((node) => node.color)).size).toBe(3);
    expect(layout.clusters).toEqual([
      {
        id: "cluster-1",
        label: "Database cluster",
        bounds: { x: -144, y: -75, width: 288, height: 406 },
      },
    ]);
  });

  test("keeps unclustered nodes in separate columns and falls back to IDs", () => {
    const layout = layoutDesign(design([{ id: "db-a" }, { id: "db-b" }]));
    expect(
      layout.nodes.map(({ label, position }) => ({ label, position })),
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
        [{ nodes: ["db-a", "db-b"] }, { id: "third", nodes: ["db-c"] }],
      ),
    );
    expect(layout.nodes.map((node) => node.position.x)).toEqual([0, 0, 420]);
    expect(layout.clusters).toEqual([
      {
        id: "cluster-1",
        label: "cluster-1",
        bounds: { x: -144, y: -75, width: 288, height: 278 },
      },
      {
        id: "third",
        label: "third",
        bounds: { x: 276, y: -75, width: 288, height: 150 },
      },
    ]);
  });

  test("assigns a different color to every supported node", () => {
    const nodes = Array.from({ length: 64 }, (_, index) => ({
      id: `db-${index}`,
    }));
    const colors = layoutDesign(design(nodes)).nodes.map((node) => node.color);
    expect(new Set(colors).size).toBe(64);
    expect(colors.slice(0, 3)).toEqual(["#ff9d52", "#42d9e8", "#b49aff"]);
    expect(colors.every((color) => /^#[\da-f]{6}$/.test(color))).toBe(true);
    expect(nodeColor(64)).toBe(colors[0]);
  });

  test("infers types from ID prefixes and keeps unknown IDs renderable", () => {
    for (const id of ["db-01", "database.primary", "rack_main"])
      expect(inferNodeType(id)).toBe("database-rack");
    expect(inferNodeType("worker-01")).toBe("database-rack");
  });

  test("rejects cluster members that bypassed validation", () => {
    expect(() =>
      layoutDesign(design([{ id: "db-a" }], [{ nodes: ["db-a", "missing"] }])),
    ).toThrow("unknown node");
  });

  test("keeps a declared cluster caption even when its ID looks internal", () => {
    const layout = layoutDesign(
      design(
        [{ id: "db-a" }],
        [{ id: "node:custom", label: "Custom", nodes: ["db-a"] }],
      ),
    );
    expect(layout.clusters).toEqual([
      {
        id: "node:custom",
        label: "Custom",
        bounds: { x: -144, y: -75, width: 288, height: 150 },
      },
    ]);
  });
});
