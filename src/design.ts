/**
 * JSON v1: positions are rack-center world coordinates; +x runs down-right,
 * +y down-left, +z up. A rack footprint is 288 × 150 units.
 * Touching/overlapping footprints at equal Z share a seamless platform; gaps stay open.
 * Colors are #RRGGBB. Connection endpoints reference unique node IDs.
 * Imports support 64 nodes / 256 links, coordinates ±10000, and 100-char labels.
 * Example packs parallel database cabinets beside each other along their depth.
 */
export interface Position {
  x: number;
  y: number;
  z: number;
}
export interface DatabaseNode {
  id: string;
  type: "database-rack";
  label: string;
  position: Position;
  color: string;
}
export interface Connection {
  id: string;
  from: string;
  to: string;
  color: string;
}
export interface Design {
  version: 1;
  name: string;
  nodes: DatabaseNode[];
  connections: Connection[];
}

export const example: Design = {
  version: 1,
  name: "Horizontal scaling",
  nodes: [
    {
      id: "database-01",
      type: "database-rack",
      label: "Database Rack 01",
      position: { x: 0, y: 0, z: 0 },
      color: "#ff9d52",
    },
    {
      id: "database-02",
      type: "database-rack",
      label: "Database Rack 02",
      position: { x: 0, y: 128, z: 0 },
      color: "#42d9e8",
    },
    {
      id: "database-03",
      type: "database-rack",
      label: "Database Rack 03",
      position: { x: 0, y: 256, z: 0 },
      color: "#b49aff",
    },
  ],
  // 92-unit cabinets have 36-unit gaps; their overlapping 150-unit feet merge into one platform.
  connections: [],
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100)
    throw new Error(`${path} must contain 1–100 characters.`);
  return value;
}
function color(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw new Error(`${path} must be a six-digit hex color, e.g. #ff9d52.`);
  return value;
}
function coordinate(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 10000
  )
    throw new Error(
      `${path} must be a finite number between -10000 and 10000.`,
    );
  return value;
}

/** Validate before replacing the scene; bad input never destroys the current design. */
export function parseDesign(source: string): Design {
  const root = record(JSON.parse(source) as unknown, "Design");
  if (root.version !== 1) throw new Error("version must be 1.");
  if (!Array.isArray(root.nodes) || root.nodes.length > 64)
    throw new Error(
      "nodes must be an array of at most 64 Database Rack objects.",
    );
  if (!Array.isArray(root.connections) || root.connections.length > 256)
    throw new Error("connections must be an array of at most 256 links.");
  const ids = new Set<string>();
  const nodes = root.nodes.map((value, index): DatabaseNode => {
    const path = `nodes[${index}]`,
      node = record(value, path),
      position = record(node.position, `${path}.position`);
    const id = text(node.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate node id: ${id}`);
    ids.add(id);
    if (node.type !== "database-rack")
      throw new Error(`${path}.type must be "database-rack".`);
    return {
      id,
      type: "database-rack",
      label: text(node.label, `${path}.label`),
      color: color(node.color, `${path}.color`),
      position: {
        x: coordinate(position.x, `${path}.position.x`),
        y: coordinate(position.y, `${path}.position.y`),
        z: coordinate(position.z, `${path}.position.z`),
      },
    };
  });
  const linkIds = new Set<string>();
  const connections = root.connections.map((value, index): Connection => {
    const path = `connections[${index}]`,
      link = record(value, path);
    const id = text(link.id, `${path}.id`),
      from = text(link.from, `${path}.from`),
      to = text(link.to, `${path}.to`);
    if (linkIds.has(id)) throw new Error(`Duplicate connection id: ${id}`);
    linkIds.add(id);
    if (!ids.has(from) || !ids.has(to))
      throw new Error(`${path} references an unknown node.`);
    if (from === to)
      throw new Error(`${path} must connect two different nodes.`);
    return { id, from, to, color: color(link.color, `${path}.color`) };
  });
  return { version: 1, name: text(root.name, "name"), nodes, connections };
}
