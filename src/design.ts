/**
 * JSON design document model and validation.
 *
 * Coordinates are rack-center world units: +x runs down-right, +y down-left,
 * +z is elevation. The projection is defined in `database.ts`; this module
 * only owns the persisted data shape and the trust boundary for imports.
 */
export interface Position {
  /** Rack-center X in world units, constrained to ±10,000. */
  x: number;
  /** Rack-center Y in world units, constrained to ±10,000. */
  y: number;
  /** Platform elevation in world units, constrained to ±10,000. */
  z: number;
}

/**
 * One renderable Database Rack.
 *
 * `id` is the stable key connections target and must be unique in a document.
 * `label` is limited to 1–100 characters; the renderer clips long names.
 * `color` is restricted to six-digit hex so it is safe as a CSS custom property.
 */
export interface DatabaseNode {
  id: string;
  type: "database-rack";
  label: string;
  position: Position;
  color: string;
}

/**
 * Directed link between two distinct Database Racks.
 *
 * Endpoints must reference node IDs present in the same document. The color
 * controls both the static cable and its animated pulse.
 */
export interface Connection {
  id: string;
  from: string;
  to: string;
  color: string;
}

/**
 * A complete editable scene. Version 1 is intentionally small: the renderer
 * knows one object type, and unknown fields are discarded during validation.
 */
export interface Design {
  version: 1;
  name: string;
  nodes: DatabaseNode[];
  connections: Connection[];
}

/**
 * Default scene: three equal peers, not a replication chain.
 *
 * Cabinets are 92 units deep and spaced 128 units apart along +y, leaving
 * 36-unit service gaps. Their 150-unit-deep feet overlap, so the platform
 * union renders one shared plinth. The identical X keeps all baselines level.
 */
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
  connections: [],
};

/**
 * Assert that an untrusted JSON value is a non-array object.
 *
 * @param value - Parsed JSON value to inspect.
 * @param path - Human-readable location included in validation errors.
 * @returns The narrowed object.
 * @throws Error with a `path`-qualified message when the shape is wrong.
 */
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

/**
 * Assert a non-empty string of at most 100 characters.
 *
 * Labels and IDs share this limit so imported text cannot grow SVG output
 * without bound or render as blank.
 */
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100)
    throw new Error(`${path} must contain 1–100 characters.`);
  return value;
}

/**
 * Restrict colors to six-digit hex before they flow into CSS.
 *
 * The value becomes `--cable-color`, which is inherited by SVG strokes and
 * glass tints. Rejecting arbitrary CSS here prevents declaration injection.
 */
function color(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw new Error(`${path} must be a six-digit hex color, e.g. #ff9d52.`);
  return value;
}

/**
 * Assert a finite world coordinate within the supported scene extent.
 *
 * The ±10,000 bound keeps zoom/pan and platform subdivision numerically safe;
 * NaN and Infinity would poison SVG path data.
 */
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

/**
 * Parse and validate a JSON design without touching the live scene.
 *
 * Validation is all-or-nothing: malformed JSON throws `SyntaxError`, schema
 * violations throw `Error`, and the caller keeps the previous scene. Empty
 * scenes are valid. Duplicate node/link IDs, dangling endpoints, and
 * self-links are rejected because connections are resolved by ID at render
 * time. The returned object is normalized and contains only known fields.
 *
 * Limits: 64 nodes, 256 links, ±10,000 coordinates, 100-character strings.
 */
export function parseDesign(source: string): Design {
  const root = record(JSON.parse(source) as unknown, "Design");
  if (root.version !== 1) throw new Error("version must be 1.");
  if (!Array.isArray(root.nodes) || root.nodes.length > 64)
    throw new Error(
      "nodes must be an array of at most 64 Database Rack objects.",
    );
  if (!Array.isArray(root.connections) || root.connections.length > 256)
    throw new Error("connections must be an array of at most 256 links.");

  // IDs are collected before links are parsed so every endpoint can be
  // checked against the final node set, not the declaration order.
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

  // Link validation reuses the node ID set and rejects duplicate link IDs so
  // DOM nodes and CSS variables remain unambiguous.
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
