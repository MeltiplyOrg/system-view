import { describe, expect, test } from "vite-plus/test";
import type { Design } from "../src/design";
import { parseDesign } from "../src/design";

// Import validation uses a connected fixture, independent of the starter layout.
const example: Design = {
  version: 1,
  name: "Connected import",
  nodes: [
    {
      id: "a",
      type: "database-rack",
      label: "A",
      position: { x: 0, y: 0, z: 0 },
      color: "#ff9d52",
    },
    {
      id: "b",
      type: "database-rack",
      label: "B",
      position: { x: 400, y: 0, z: 0 },
      color: "#42d9e8",
    },
    {
      id: "c",
      type: "database-rack",
      label: "C",
      position: { x: 800, y: 0, z: 0 },
      color: "#b49aff",
    },
  ],
  connections: [
    { id: "a-b", from: "a", to: "b", color: "#ff9d52" },
    { id: "b-c", from: "b", to: "c", color: "#42d9e8" },
  ],
};

describe("design imports", () => {
  test("preserves elevated positions, colors, and directed connections through export/import", () => {
    const design = structuredClone(example);
    design.nodes[0].position = { x: -240, y: 500, z: 120 };
    design.nodes[0].color = "#ab12CD";
    const imported = parseDesign(JSON.stringify(design));
    expect(imported).toEqual(design);
    expect(parseDesign(JSON.stringify(imported))).toEqual(design);
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
  test("rejects duplicate link IDs and self-links", () => {
    const duplicate = structuredClone(example);
    duplicate.connections[1].id = duplicate.connections[0].id;
    expect(() => parseDesign(JSON.stringify(duplicate))).toThrow(
      "Duplicate connection id",
    );
    const self = structuredClone(example);
    self.connections[0].to = self.connections[0].from;
    expect(() => parseDesign(JSON.stringify(self))).toThrow(
      "two different nodes",
    );
  });
  test("rejects invalid render coordinates and CSS color injection", () => {
    const position = structuredClone(example);
    position.nodes[0].position.z = 10001;
    expect(() => parseDesign(JSON.stringify(position))).toThrow(
      "finite number",
    );
    expect(() =>
      parseDesign(JSON.stringify(example).replace('"x":0', '"x":1e999')),
    ).toThrow("finite number");
    const color = structuredClone(example);
    color.nodes[0].color = "red;filter:url(https://example.com)";
    expect(() => parseDesign(JSON.stringify(color))).toThrow("hex color");
  });
  test("supports an empty scene but rejects unsupported object types", () => {
    expect(
      parseDesign('{"version":1,"name":"Empty","nodes":[],"connections":[]}'),
    ).toEqual({ version: 1, name: "Empty", nodes: [], connections: [] });
    const unsupported = {
      ...example,
      nodes: [{ ...example.nodes[0], type: "server" }],
    };
    expect(() => parseDesign(JSON.stringify(unsupported))).toThrow();
  });
});
