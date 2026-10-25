/**
 * Import-boundary tests. The renderer trusts validated data, so these cover
 * the failure modes that would otherwise reach SVG path generation.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { examples, parseDesign } from "../src/design";

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
});

describe("example catalogue", () => {
  test("keeps every reference design valid and uniquely labelled", () => {
    expect(examples.length).toBeGreaterThan(1);
    expect(new Set(examples.map(({ id }) => id)).size).toBe(examples.length);
    expect(new Set(examples.map(({ design }) => design.name)).size).toBe(
      examples.length,
    );
    expect(
      examples.some(({ design }) => design.name === "Horizontal scaling"),
    ).toBe(true);
    for (const { id, summary, design } of examples) {
      expect(id.trim()).not.toBe("");
      expect(summary.trim()).not.toBe("");
      expect(design.instances.length).toBeGreaterThan(0);
      expect(design.connections.length).toBeGreaterThan(0);
      expect(parseDesign(JSON.stringify(design))).toEqual(design);
    }
  });
});
