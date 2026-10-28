/**
 * Import-boundary tests. The renderer trusts validated data, so these cover
 * the failure modes that would otherwise reach SVG path generation.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { examples, parseDesign } from "../src/design";
import { instanceFootprint, layoutDesign } from "../src/layout";
import { TrafficModel } from "../src/traffic";

/** Connected three-instance fixture, intentionally independent of the default scene. */
const example: Design = {
  version: 1,
  name: "Connected import",
  instances: [
    { id: "db-a", label: "A" },
    { id: "db-b" },
    { id: "db-c", label: "C" },
  ],
  connections: [
    { from: "db-a", to: "db-b", relation: "replicates" },
    { id: "b-c", from: "db-b", to: "db-c" },
  ],
  clusters: [{ label: "Database cluster", instances: ["db-a", "db-b"] }],
};

describe("design imports", () => {
  test("round-trips optional labels, relations, and clusters", () => {
    const imported = parseDesign(JSON.stringify(example));
    expect(imported).toEqual(example);
    expect(parseDesign(JSON.stringify(imported))).toEqual(example);
  });

  test("preserves optional instance and cluster descriptions as plain text", () => {
    const described: Design = structuredClone(example);
    described.instances[0].description = "<b>Primary</b>\nHandles writes.";
    described.clusters[0].description = "Replicas serving application data.";
    const imported = parseDesign(JSON.stringify(described));
    expect(imported).toEqual(described);
    expect(parseDesign(JSON.stringify(imported))).toEqual(described);
    expect(Object.hasOwn(imported.instances[1], "description")).toBe(false);
  });

  test("validates description types and length on instances and clusters", () => {
    for (const collection of ["instances", "clusters"] as const) {
      for (const description of [null, 42, "", "   ", "x".repeat(2001)]) {
        const document = structuredClone(example);
        Object.assign(document[collection][0], { description });
        expect(() => parseDesign(JSON.stringify(document))).toThrow(
          `${collection}[0].description must contain 1–2000 characters.`,
        );
      }
      const document = structuredClone(example);
      document[collection][0].description = "x".repeat(2000);
      expect(
        parseDesign(JSON.stringify(document))[collection][0].description,
      ).toBe("x".repeat(2000));
    }
  });

  test("accepts minimal instances and strips the old generated fields", () => {
    const imported = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Minimal",
        instances: [
          "db-only",
          {
            id: "db-two",
            label: "Two",
            type: "server",
            position: { x: 50, y: 60, z: 70 },
            color: "not-a-color",
          },
        ],
      }),
    );
    expect(imported).toEqual({
      version: 1,
      name: "Minimal",
      instances: [{ id: "db-only" }, { id: "db-two", label: "Two" }],
      connections: [],
      clusters: [],
    });
  });

  test("accepts an empty scene and omitted optional collections", () => {
    expect(parseDesign('{"version":1,"name":"Empty","instances":[]}')).toEqual({
      version: 1,
      name: "Empty",
      instances: [],
      connections: [],
      clusters: [],
    });
    expect(
      parseDesign(
        '{"version":1,"name":"Unnamed group","instances":["db-a"],"clusters":[{"instances":["db-a"]}]}',
      ).clusters,
    ).toEqual([{ instances: ["db-a"] }]);
  });

  test("rejects duplicate instance IDs and dangling connection endpoints", () => {
    const duplicate = structuredClone(example);
    duplicate.instances[1].id = duplicate.instances[0].id;
    expect(() => parseDesign(JSON.stringify(duplicate))).toThrow(
      "Duplicate instance id",
    );

    const dangling = structuredClone(example);
    dangling.instances.pop();
    expect(() => parseDesign(JSON.stringify(dangling))).toThrow(
      "unknown instance",
    );
  });

  test("rejects duplicate effective link IDs and self-links", () => {
    const duplicate = structuredClone(example);
    duplicate.connections.push({
      from: duplicate.connections[0].from,
      to: duplicate.connections[0].to,
    });
    expect(() => parseDesign(JSON.stringify(duplicate))).toThrow(
      "Duplicate connection id: db-a->db-b",
    );

    const duplicateId = structuredClone(example);
    duplicateId.connections[0].id = "link";
    duplicateId.connections[1].id = "link";
    expect(() => parseDesign(JSON.stringify(duplicateId))).toThrow(
      "Duplicate connection id",
    );

    const self = structuredClone(example);
    self.connections[0].to = self.connections[0].from;
    expect(() => parseDesign(JSON.stringify(self))).toThrow(
      "two different instances",
    );
  });

  test("validates cluster membership and IDs", () => {
    const unknown = structuredClone(example);
    unknown.clusters[0].instances.push("missing");
    expect(() => parseDesign(JSON.stringify(unknown))).toThrow(
      "unknown instance",
    );

    const repeated = structuredClone(example);
    repeated.clusters[0].instances.push("db-a");
    expect(() => parseDesign(JSON.stringify(repeated))).toThrow("repeat");

    const overlapping = structuredClone(example);
    overlapping.clusters.push({ instances: ["db-a"] });
    expect(() => parseDesign(JSON.stringify(overlapping))).toThrow(
      "more than one cluster",
    );

    const duplicateId = structuredClone(example);
    duplicateId.clusters[0].id = "group";
    duplicateId.clusters.push({ id: "group", instances: ["db-c"] });
    expect(() => parseDesign(JSON.stringify(duplicateId))).toThrow(
      "Duplicate cluster id",
    );

    const empty = structuredClone(example);
    empty.clusters[0].instances = [];
    expect(() => parseDesign(JSON.stringify(empty))).toThrow(
      "1–64 instance IDs",
    );
  });

  test("rejects invalid text, versions, and collection shapes", () => {
    expect(() => parseDesign("[]")).toThrow("must be an object");
    expect(() =>
      parseDesign('{"version":2,"name":"Bad","instances":[]}'),
    ).toThrow("version must be 1");
    expect(() => parseDesign('{"version":1,"name":"","instances":[]}')).toThrow(
      "name must contain",
    );
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","instances":[[]]}'),
    ).toThrow("must be an object");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","instances":[{"id":"db-a","label":""}]}',
      ),
    ).toThrow("label must contain");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","instances":[{"id":"db-a"}],"connections":[{"from":"","to":"db-a"}]}',
      ),
    ).toThrow("from must contain");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","instances":[{"id":"db-a"}],"connections":[{"from":"db-a","to":"db-a"}]}',
      ),
    ).toThrow("two different instances");
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","instances":[],"connections":{}}'),
    ).toThrow("connections must be an array");
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","instances":[],"clusters":{}}'),
    ).toThrow("clusters must be an array");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","instances":["db-a"],"clusters":[{"instances":["db-a"],"label":""}]}',
      ),
    ).toThrow("label must contain");
  });

  test("enforces document limits", () => {
    const tooManyInstances = Array.from({ length: 65 }, (_, index) => ({
      id: `db-${index}`,
    }));
    expect(() =>
      parseDesign(
        JSON.stringify({
          version: 1,
          name: "Too many",
          instances: tooManyInstances,
        }),
      ),
    ).toThrow("at most 64");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","instances":[],"connections":[],"clusters":[{"instances":[]}]}',
      ),
    ).toThrow("1–64 instance IDs");
    expect(() =>
      parseDesign(
        `{"version":1,"name":"Bad","instances":["db-a","db-b"],"connections":[{"from":"db-a","to":"db-b","relation":"${"x".repeat(101)}"}]}`,
      ),
    ).toThrow("relation must contain");
  });

  test("preserves manual ground placement but rejects coordinates unsafe for world geometry", () => {
    const manual = {
      ...example,
      instances: [{ id: "cdn-edge", placement: { x: -640, y: 0 } }],
      connections: [],
      clusters: [],
    };
    expect(parseDesign(JSON.stringify(manual))).toEqual(manual);
    for (const placement of [
      null,
      [],
      { x: 1 },
      { x: "0", y: 0 },
      { x: 0, y: Infinity },
      { x: NaN, y: 0 },
      { x: 100001, y: 0 },
    ])
      expect(() =>
        parseDesign(
          JSON.stringify({
            ...manual,
            instances: [{ id: "cdn-edge", placement }],
          }),
        ),
      ).toThrow("placement");
  });
});

describe("example catalogue", () => {
  test("groups every reference design and keeps each a full architecture", () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
    expect(new Set(examples.map(({ id }) => id)).size).toBe(examples.length);
    expect(new Set(examples.map(({ design }) => design.name)).size).toBe(
      examples.length,
    );
    expect(
      examples.some(({ design }) => design.name === "Horizontal scaling"),
    ).toBe(true);

    const groups: string[] = [];
    for (const { id, group, summary, design } of examples) {
      expect(group.trim()).not.toBe("");
      expect(summary.trim()).not.toBe("");
      expect(id.trim()).not.toBe("");
      // The boot walkthrough is deliberately minimal; every curated app is a
      // complete architecture with several tiers and asynchronous work.
      const minimumNodes = id === "web-app" ? 4 : 8;
      const minimumConnections = id === "web-app" ? 3 : 8;
      expect(design.instances.length).toBeGreaterThanOrEqual(minimumNodes);
      expect(design.connections.length).toBeGreaterThanOrEqual(
        minimumConnections,
      );
      expect(design.instances.some(({ id }) => id.startsWith("users-"))).toBe(
        true,
      );
      const worldGroups = design.groups ?? [];
      expect(worldGroups.length).toBeGreaterThan(0);
      expect(new Set(worldGroups.map(({ id }) => id)).size).toBe(
        worldGroups.length,
      );
      const groupedIds = worldGroups.flatMap(({ instances }) => instances);
      expect(groupedIds).toHaveLength(design.instances.length);
      expect(new Set(groupedIds).size).toBe(design.instances.length);
      for (const worldGroup of worldGroups) {
        expect(worldGroup.label.trim()).not.toBe("");
        expect(worldGroup.instances.length).toBeGreaterThan(0);
      }
      expect(parseDesign(JSON.stringify(design))).toEqual(design);
      if (groups.at(-1) !== group) groups.push(group);
    }
    // Grouped picker sections must stay contiguous and appear once.
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups.length).toBeGreaterThanOrEqual(3);

    for (const { design } of examples) {
      const placed = layoutDesign(design).instances;
      for (let a = 0; a < placed.length; a++)
        for (let b = a + 1; b < placed.length; b++) {
          const first = placed[a],
            second = placed[b],
            firstFoot = instanceFootprint(first.type, first.provider),
            secondFoot = instanceFootprint(second.type, second.provider);
          const separated =
            Math.abs(first.position.x - second.position.x) >=
              firstFoot.halfWidth + secondFoot.halfWidth + 12 ||
            Math.abs(first.position.y - second.position.y) >=
              firstFoot.halfDepth + secondFoot.halfDepth + 12;
          expect(
            separated,
            `${design.name}: ${first.id} and ${second.id} overlap`,
          ).toBe(true);
        }
    }
  });

  test("every example runs a real request within the default SLOs", () => {
    for (const { design } of examples) {
      const model = new TrafficModel(design);
      let state = model.step(0);
      for (let time = 0; time < 30; time += 0.05) state = model.step(0.05);
      expect(
        { example: design.name, rejected: state.rejected, crash: state.crash },
        `${design.name} must have a complete runnable path`,
      ).toEqual({ example: design.name, rejected: 0, crash: null });
      expect(state.completed).toBeGreaterThan(0);
    }
  });
});
