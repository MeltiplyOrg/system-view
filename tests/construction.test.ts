import { describe, expect, test } from "vite-plus/test";
import {
  BUILD_ITEMS,
  BUILD_TYPES,
  canPlace,
  connectComponents,
  disconnectComponents,
  pinWorld,
  placeComponent,
  removeComponent,
  snapPlacement,
} from "../src/construction";
import {
  MAX_CONNECTIONS,
  MAX_INSTANCES,
  MAX_WORLD_COORDINATE,
  parseDesign,
  type Design,
} from "../src/design";
import { layoutDesign } from "../src/layout";

/** A small connected graph independent of the boot example and catalogue contents. */
function world(): Design {
  return {
    version: 1,
    name: "Factory",
    instances: [{ id: "compute-1" }, { id: "compute-3" }, { id: "db-1" }],
    connections: [],
    clusters: [],
  };
}

describe("world construction", () => {
  test("retains exact manual sites through import, graph edits and neighbour removal", () => {
    const original = world();
    const before = layoutDesign(original).instances;
    const pinned = pinWorld(original, before);
    const placed = placeComponent(
      pinned,
      BUILD_TYPES.find((item) => item.type === "compute-server")!,
      { x: -501, y: 111 },
    );
    const added = placed.instances.at(-1)!;
    expect(added.id).toBe("compute-2");
    expect(added.placement).toEqual({ x: -520, y: 120 });
    expect(original.instances).toEqual([
      { id: "compute-1" },
      { id: "compute-3" },
      { id: "db-1" },
    ]);
    const imported = parseDesign(JSON.stringify(placed));
    expect(imported).toEqual(placed);
    const removed = removeComponent(imported, "compute-1");
    const after = new Map(
      layoutDesign(removed).instances.map((instance) => [
        instance.id,
        instance.position,
      ]),
    );
    for (const instance of before.slice(1))
      expect(after.get(instance.id)).toEqual(instance.position);
    expect(after.get(added.id)).toEqual({ x: -520, y: 120, z: 0 });
  });

  test("places every catalogue skin with its own renderer and provider intact", () => {
    for (const item of BUILD_ITEMS) {
      const design = placeComponent({ ...world(), instances: [] }, item, {
        x: 0,
        y: 0,
      });
      const rendered = layoutDesign(parseDesign(JSON.stringify(design)))
        .instances[0];
      expect(rendered.type).toBe(item.type);
      expect(rendered.provider).toBe(item.provider);
      expect(rendered.position).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  test("uses product footprints to reject occupied ground while allowing compact appliances", () => {
    const cache = BUILD_TYPES.find((item) => item.id === "cache")!;
    const redis = BUILD_ITEMS.find((item) => item.provider === "redis")!;
    const instances = layoutDesign({
      ...world(),
      instances: [
        { id: "cache-origin", provider: "redis", placement: { x: 0, y: 0 } },
      ],
    }).instances;
    expect(canPlace(redis, { x: 0, y: 0 }, instances)).toBe(false);
    expect(canPlace(redis, { x: 200, y: 0 }, instances)).toBe(true);
    expect(canPlace(cache, { x: 200, y: 0 }, instances)).toBe(false);
    expect(canPlace(cache, { x: 0, y: -1000 }, instances)).toBe(true);
    const occupied = {
      ...world(),
      instances: [
        { id: "cache-origin", provider: "redis", placement: { x: 0, y: 0 } },
      ],
    };
    expect(() => placeComponent(occupied, redis, { x: 0, y: 0 })).toThrow(
      "occupied",
    );
  });

  test("builds directed wires without self links, duplicate pairs or identifier collisions", () => {
    const design = world();
    design.connections = [{ id: "wire-1", from: "compute-3", to: "db-1" }];
    const connected = connectComponents(design, "compute-1", "db-1", "  SQL  ");
    expect(connected.connections.at(-1)).toEqual({
      id: "wire-2",
      from: "compute-1",
      to: "db-1",
      relation: "SQL",
    });
    expect(parseDesign(JSON.stringify(connected))).toEqual(connected);
    expect(
      connectComponents(connected, "db-1", "compute-1").connections.at(-1),
    ).not.toHaveProperty("relation");
    expect(() => connectComponents(connected, "compute-1", "db-1")).toThrow(
      "already connected",
    );
    expect(() => connectComponents(design, "db-1", "db-1")).toThrow(
      "different component",
    );
    expect(() => connectComponents(design, "missing", "db-1")).toThrow(
      "two components",
    );
    expect(() =>
      connectComponents(design, "compute-1", "db-1", "x".repeat(101)),
    ).toThrow("100");
    expect(design.connections).toEqual([
      { id: "wire-1", from: "compute-3", to: "db-1" },
    ]);
  });

  test("cutting one parallel branch outlet preserves its sibling and every node", () => {
    const original: Design = {
      ...world(),
      instances: [
        { id: "branch-choice" },
        { id: "compute-1", placement: { x: 400, y: 120 } },
      ],
      connections: [
        { id: "yes", from: "branch-choice", to: "compute-1", outlet: "true" },
        { id: "no", from: "branch-choice", to: "compute-1", outlet: "false" },
      ],
    };
    const cut = disconnectComponents(original, 0);
    expect(cut.connections).toEqual([original.connections[1]]);
    expect(cut.instances).toEqual(original.instances);
    expect(parseDesign(JSON.stringify(cut))).toEqual(cut);
    expect(original.connections).toHaveLength(2);
    for (const index of [-1, 2, 0.5, NaN])
      expect(() => disconnectComponents(original, index)).toThrow(
        "no longer exists",
      );
  });

  test("removing a machine prunes only incident wires and dissolves singleton groups", () => {
    const design = world();
    design.clusters = [
      { id: "peers", instances: ["compute-1", "compute-3"] },
      { id: "single-db", instances: ["db-1"] },
    ];
    design.connections = [
      { from: "compute-1", to: "db-1" },
      { from: "compute-3", to: "db-1" },
    ];
    const result = removeComponent(design, "compute-1");
    expect(result.instances.map(({ id }) => id)).toEqual(["compute-3", "db-1"]);
    expect(result.connections).toEqual([{ from: "compute-3", to: "db-1" }]);
    expect(result.clusters).toEqual([{ id: "single-db", instances: ["db-1"] }]);
    expect(parseDesign(JSON.stringify(result))).toEqual(result);
    expect(design.clusters[0].instances).toEqual(["compute-1", "compute-3"]);
  });

  test("keeps a surviving multi-member group and normalizes sites around the origin", () => {
    const design = world();
    design.clusters = [
      {
        id: "all-machines",
        label: "Production",
        instances: design.instances.map(({ id }) => id),
      },
    ];
    expect(removeComponent(design, "compute-1").clusters).toEqual([
      {
        id: "all-machines",
        label: "Production",
        instances: ["compute-3", "db-1"],
      },
    ]);
    expect(snapPlacement({ x: -1, y: 1 })).toEqual({ x: 0, y: 0 });
  });

  test("enforces world, component and wire limits before changing the document", () => {
    expect(
      snapPlacement({ x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE }),
    ).toEqual({ x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE });
    for (const point of [
      { x: Infinity, y: 0 },
      { x: 0, y: NaN },
      { x: MAX_WORLD_COORDINATE + 1, y: 0 },
    ])
      expect(() => snapPlacement(point)).toThrow("buildable world");
    const full = {
      ...world(),
      instances: Array.from({ length: MAX_INSTANCES }, (_, index) => ({
        id: `compute-${index}`,
      })),
    };
    expect(() => placeComponent(full, BUILD_TYPES[0], { x: 0, y: 0 })).toThrow(
      "64",
    );
    const wired = world();
    wired.connections = Array.from({ length: MAX_CONNECTIONS }, (_, index) => ({
      id: `existing-${index}`,
      from: "compute-1",
      to: "compute-3",
    }));
    expect(() => connectComponents(wired, "compute-1", "db-1")).toThrow("256");
    expect(full.instances).toHaveLength(MAX_INSTANCES);
    expect(wired.connections).toHaveLength(MAX_CONNECTIONS);
  });
});
