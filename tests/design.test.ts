/**
 * Import-boundary tests. The renderer trusts validated data, so these cover
 * the failure modes that would otherwise reach SVG path generation.
 */
import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { parseDesign } from "../src/design";

/** Connected three-node fixture, intentionally independent of the default scene. */
const example: Design = {
  version: 1,
  name: "Connected import",
  nodes: [
    { id: "db-a", label: "A" },
    { id: "db-b" },
    { id: "db-c", label: "C" },
  ],
  connections: [
    { from: "db-a", to: "db-b", relation: "replicates" },
    { id: "b-c", from: "db-b", to: "db-c" },
  ],
  clusters: [{ label: "Database cluster", nodes: ["db-a", "db-b"] }],
};

describe("design imports", () => {
  test("round-trips optional labels, relations, and clusters", () => {
    const imported = parseDesign(JSON.stringify(example));
    expect(imported).toEqual(example);
    expect(parseDesign(JSON.stringify(imported))).toEqual(example);
  });

  test("accepts minimal nodes and strips the old generated fields", () => {
    const imported = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Minimal",
        nodes: [
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
      nodes: [{ id: "db-only" }, { id: "db-two", label: "Two" }],
      connections: [],
      clusters: [],
    });
  });

  test("accepts an empty scene and omitted optional collections", () => {
    expect(parseDesign('{"version":1,"name":"Empty","nodes":[]}')).toEqual({
      version: 1,
      name: "Empty",
      nodes: [],
      connections: [],
      clusters: [],
    });
    expect(
      parseDesign(
        '{"version":1,"name":"Unnamed group","nodes":["db-a"],"clusters":[{"nodes":["db-a"]}]}',
      ).clusters,
    ).toEqual([{ nodes: ["db-a"] }]);
  });

  test("rejects duplicate node IDs and dangling connection endpoints", () => {
    const duplicate = structuredClone(example);
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    expect(() => parseDesign(JSON.stringify(duplicate))).toThrow(
      "Duplicate node id",
    );

    const dangling = structuredClone(example);
    dangling.nodes.pop();
    expect(() => parseDesign(JSON.stringify(dangling))).toThrow("unknown node");
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
      "two different nodes",
    );
  });

  test("validates cluster membership and IDs", () => {
    const unknown = structuredClone(example);
    unknown.clusters[0].nodes.push("missing");
    expect(() => parseDesign(JSON.stringify(unknown))).toThrow("unknown node");

    const repeated = structuredClone(example);
    repeated.clusters[0].nodes.push("db-a");
    expect(() => parseDesign(JSON.stringify(repeated))).toThrow("repeat");

    const overlapping = structuredClone(example);
    overlapping.clusters.push({ nodes: ["db-a"] });
    expect(() => parseDesign(JSON.stringify(overlapping))).toThrow(
      "more than one cluster",
    );

    const duplicateId = structuredClone(example);
    duplicateId.clusters[0].id = "group";
    duplicateId.clusters.push({ id: "group", nodes: ["db-c"] });
    expect(() => parseDesign(JSON.stringify(duplicateId))).toThrow(
      "Duplicate cluster id",
    );

    const empty = structuredClone(example);
    empty.clusters[0].nodes = [];
    expect(() => parseDesign(JSON.stringify(empty))).toThrow("1–64 node IDs");
  });

  test("rejects invalid text, versions, and collection shapes", () => {
    expect(() => parseDesign("[]")).toThrow("must be an object");
    expect(() => parseDesign('{"version":2,"name":"Bad","nodes":[]}')).toThrow(
      "version must be 1",
    );
    expect(() => parseDesign('{"version":1,"name":"","nodes":[]}')).toThrow(
      "name must contain",
    );
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","nodes":[[]]}'),
    ).toThrow("must be an object");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","nodes":[{"id":"db-a","label":""}]}',
      ),
    ).toThrow("label must contain");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","nodes":[{"id":"db-a"}],"connections":[{"from":"","to":"db-a"}]}',
      ),
    ).toThrow("from must contain");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","nodes":[{"id":"db-a"}],"connections":[{"from":"db-a","to":"db-a"}]}',
      ),
    ).toThrow("two different nodes");
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","nodes":[],"connections":{}}'),
    ).toThrow("connections must be an array");
    expect(() =>
      parseDesign('{"version":1,"name":"Bad","nodes":[],"clusters":{}}'),
    ).toThrow("clusters must be an array");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","nodes":["db-a"],"clusters":[{"nodes":["db-a"],"label":""}]}',
      ),
    ).toThrow("label must contain");
  });

  test("enforces document limits", () => {
    const tooManyNodes = Array.from({ length: 65 }, (_, index) => ({
      id: `db-${index}`,
    }));
    expect(() =>
      parseDesign(
        JSON.stringify({
          version: 1,
          name: "Too many",
          nodes: tooManyNodes,
        }),
      ),
    ).toThrow("at most 64");
    expect(() =>
      parseDesign(
        '{"version":1,"name":"Bad","nodes":[],"connections":[],"clusters":[{"nodes":[]}]}',
      ),
    ).toThrow("1–64 node IDs");
    expect(() =>
      parseDesign(
        `{"version":1,"name":"Bad","nodes":["db-a","db-b"],"connections":[{"from":"db-a","to":"db-b","relation":"${"x".repeat(101)}"}]}`,
      ),
    ).toThrow("relation must contain");
  });
});
