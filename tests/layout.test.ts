/**
 * Automatic layout tests. They pin the deterministic placement contract and
 * prove colors normalize per renderer type regardless of declaration order.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design, PlacedInstance } from "../src/design";
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
  test("places cluster members in one column with a shared database palette", () => {
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
    ).toBe(1);
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

  test("wraps after five replicas into back rows without stretching the first row", () => {
    for (const count of [5, 6, 10, 11]) {
      const instances = Array.from({ length: count }, (_, index) => ({
        id: `db-${index}`,
      }));
      const layout = layoutDesign(
        design(instances, [{ instances: instances.map(({ id }) => id) }]),
      );
      const rows = new Map<number, number>();
      for (const instance of layout.instances) {
        const { x, y } = instance.position;
        rows.set(x, (rows.get(x) ?? 0) + 1);
        const bounds = layout.clusters[0].bounds;
        expect(x - 144).toBeGreaterThanOrEqual(bounds.x);
        expect(x + 144).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(y - 75).toBeGreaterThanOrEqual(bounds.y);
        expect(y + 75).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
      expect([...rows.values()].every((size) => size <= 5)).toBe(true);
      expect(rows.size).toBe(Math.ceil(count / 5));
      const first = layout.instances[0].position;
      expect(first).toEqual({ x: 0, y: 0, z: 0 });
      if (count > 5) {
        const sixth = layout.instances[5].position;
        expect(sixth.x + 144).toBeLessThan(first.x - 144);
        expect(sixth.y).toBe(first.y);
      }
    }
  });

  test("reserves back-row space between neighboring clusters", () => {
    const instances = Array.from({ length: 20 }, (_, index) => ({
      id: `db-${index}`,
    }));
    const layout = layoutDesign(
      design(instances, [
        { instances: instances.slice(0, 10).map(({ id }) => id) },
        { instances: instances.slice(10).map(({ id }) => id) },
      ]),
    );
    const [left, right] = layout.clusters.map(({ bounds }) => bounds);
    expect(left.x + left.width).toBeLessThan(right.x);
    for (let a = 0; a < layout.instances.length; a++)
      for (let b = a + 1; b < layout.instances.length; b++) {
        const first = layout.instances[a].position;
        const second = layout.instances[b].position;
        expect(
          Math.abs(first.x - second.x) >= 288 ||
            Math.abs(first.y - second.y) >= 150,
        ).toBe(true);
      }
  });

  test("normalizes one color per renderer type", () => {
    const types = [
      "database-rack",
      "compute-server",
      "webpage",
      "cache",
    ] as const;
    expect(types.map(instanceColor)).toEqual([
      "#42d9e8",
      "#ff9d52",
      "#b49aff",
      "#7ee787",
    ]);
    expect(new Set(types.map(instanceColor)).size).toBe(4);
  });

  test("normalizes aliases regardless of declaration order", () => {
    const ids = [
      "compute-api",
      "cache-primary",
      "db-01",
      "web-app",
      "server-2",
      "database.replica",
      "frontend",
      "rack_main",
      "api-edge",
      "webpage.home",
      "cache_session",
      "CACHE.sidecar",
    ];
    const expected: Record<PlacedInstance["type"], string> = {
      "database-rack": "#42d9e8",
      "compute-server": "#ff9d52",
      webpage: "#b49aff",
      cache: "#7ee787",
    };
    const place = (order: string[]) =>
      layoutDesign(design(order.map((id) => ({ id })))).instances;
    const forward = place(ids),
      reversed = new Map(
        place(ids.slice().reverse()).map(({ id, color }) => [id, color]),
      );
    expect(forward.map(({ color }) => color)).toEqual(
      ids.map((id) => expected[inferInstanceType(id)]),
    );
    for (const { id, type, color } of forward) {
      expect(color).toBe(expected[type]);
      expect(reversed.get(id)).toBe(color);
    }
  });

  test("infers types from ID prefixes and keeps unknown IDs renderable", () => {
    for (const id of ["db-01", "database.primary", "rack_main"])
      expect(inferInstanceType(id)).toBe("database-rack");
    expect(inferInstanceType("worker-01")).toBe("database-rack");
    for (const id of ["cache-app", "CACHE.session", "cache_primary"])
      expect(inferInstanceType(id)).toBe("cache");
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
