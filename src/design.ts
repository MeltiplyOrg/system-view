/**
 * JSON design document model and validation.
 *
 * The persisted document is deliberately small: a node is an ID and an
 * optional label, a connection names two IDs, and a cluster groups IDs. Type,
 * color, and position are render-time derivations owned by `layout.ts`, so an
 * exported document never accumulates generated data.
 */
export interface Position {
  /** Generated rack-center X in world units. */
  x: number;
  /** Generated rack-center Y in world units. */
  y: number;
  /** Generated platform elevation in world units. */
  z: number;
}

/**
 * One renderable Database Rack.
 *
 * This is the placed form consumed by the renderer, not the imported JSON
 * shape. `id` stays the stable key connections target; `label` is the
 * user-facing name (an omitted imported label falls back to `id`).
 */
export interface DatabaseNode {
  id: string;
  type: "database-rack";
  label: string;
  position: Position;
  color: string;
}

/**
 * One imported object. Only identity and presentation are persisted.
 *
 * IDs are the source of truth for both the node type (via prefix) and link
 * endpoints. The renderer derives everything else.
 */
export interface DesignNode {
  id: string;
  label?: string;
}

/**
 * Directed link between two distinct nodes.
 *
 * `id` is optional: the renderer falls back to `from->to`, which keeps simple
 * documents free of bookkeeping. `relation` is optional prose for the link
 * (for example "replicates") and is exposed in the cable title.
 */
export interface Connection {
  id?: string;
  from: string;
  to: string;
  relation?: string;
}

/**
 * A named group of nodes that should share a platform and be laid out together.
 *
 * `id` and `label` are optional. The layout pass derives a stable fallback from
 * the declaration order and uses the label for the on-canvas group caption.
 */
export interface Cluster {
  id?: string;
  label?: string;
  nodes: string[];
}

/**
 * A complete editable scene.
 *
 * `connections` and `clusters` may be omitted from imported JSON and normalize
 * to empty arrays. Unknown fields, including the old `type`, `position`, and
 * `color` fields, are ignored so older documents still open and are re-exported
 * in the current shape.
 */
export interface Design {
  version: 1;
  name: string;
  nodes: DesignNode[];
  connections: Connection[];
  clusters: Cluster[];
}

/**
 * Default scene: three peers grouped into one cluster with replication links.
 *
 * IDs intentionally use the `db-` prefix; the layout pass turns that prefix
 * into the database-rack renderer, lays the three racks out in one column, and
 * assigns three distinct colors. The cluster makes their feet share a plinth.
 */
export const example: Design = {
  version: 1,
  name: "Horizontal scaling",
  nodes: [
    { id: "db-01", label: "Database Rack 01" },
    { id: "db-02", label: "Database Rack 02" },
    { id: "db-03", label: "Database Rack 03" },
  ],
  connections: [
    { from: "db-01", to: "db-02", relation: "replicates" },
    { from: "db-02", to: "db-03", relation: "replicates" },
  ],
  clusters: [
    {
      label: "Database cluster",
      nodes: ["db-01", "db-02", "db-03"],
    },
  ],
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
 * Labels, IDs, and relations share this limit so imported text cannot grow SVG
 * output without bound or render as blank.
 */
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100)
    throw new Error(`${path} must contain 1–100 characters.`);
  return value;
}

/**
 * Parse and validate a JSON design without touching the live scene.
 *
 * Validation is all-or-nothing: malformed JSON throws `SyntaxError`, schema
 * violations throw `Error`, and the caller keeps the previous scene. Empty
 * scenes are valid. Duplicate node/link/cluster IDs, dangling endpoints,
 * self-links, and a node appearing in two clusters are rejected because the
 * renderer resolves all of them by ID.
 *
 * `connections` and `clusters` are optional. Node entries may be strings
 * (`"db-01"`) or objects (`{ "id": "db-01", "label": "Primary" }`). Generated
 * fields from the previous schema are ignored and never returned.
 *
 * Limits: 64 nodes, 256 links, 64 clusters, 100-character strings.
 */
export function parseDesign(source: string): Design {
  const root = record(JSON.parse(source) as unknown, "Design");
  if (root.version !== 1) throw new Error("version must be 1.");
  if (!Array.isArray(root.nodes) || root.nodes.length > 64)
    throw new Error("nodes must be an array of at most 64 node objects.");

  // IDs are collected before links and clusters are parsed so every reference
  // can be checked against the final node set, not declaration order.
  const ids = new Set<string>();
  const nodes = root.nodes.map((value, index): DesignNode => {
    const path = `nodes[${index}]`,
      node: Record<string, unknown> =
        typeof value === "string" ? { id: value } : record(value, path);
    const id = text(node.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate node id: ${id}`);
    ids.add(id);
    // `type`, `position`, and `color` are intentionally not read. They are
    // derived from the ID and graph by the layout pass.
    return node.label === undefined
      ? { id }
      : { id, label: text(node.label, `${path}.label`) };
  });

  const connectionInput =
    root.connections === undefined ? [] : root.connections;
  if (!Array.isArray(connectionInput) || connectionInput.length > 256)
    throw new Error("connections must be an array of at most 256 links.");

  // Link validation reuses the node ID set and rejects duplicate effective IDs
  // so DOM nodes and CSS variables remain unambiguous.
  const linkIds = new Set<string>();
  const connections = connectionInput.map((value, index): Connection => {
    const path = `connections[${index}]`,
      link = record(value, path);
    const from = text(link.from, `${path}.from`),
      to = text(link.to, `${path}.to`);
    if (!ids.has(from) || !ids.has(to))
      throw new Error(`${path} references an unknown node.`);
    if (from === to)
      throw new Error(`${path} must connect two different nodes.`);

    const explicitId =
      link.id === undefined ? undefined : text(link.id, `${path}.id`);
    const id = explicitId ?? `${from}->${to}`;
    if (linkIds.has(id)) throw new Error(`Duplicate connection id: ${id}`);
    linkIds.add(id);

    return {
      ...(explicitId === undefined ? {} : { id: explicitId }),
      from,
      to,
      ...(link.relation === undefined
        ? {}
        : { relation: text(link.relation, `${path}.relation`) }),
    };
  });

  const clusterInput = root.clusters === undefined ? [] : root.clusters;
  if (!Array.isArray(clusterInput) || clusterInput.length > 64)
    throw new Error("clusters must be an array of at most 64 groups.");

  // A node belongs to at most one cluster: two groups would place the same rack
  // at conflicting coordinates. Cross-cluster membership is therefore treated
  // as a validation error rather than silently picking the first group.
  const clusterIds = new Set<string>(),
    clustered = new Set<string>();
  const clusters = clusterInput.map((value, index): Cluster => {
    const path = `clusters[${index}]`,
      cluster = record(value, path);
    const explicitId =
      cluster.id === undefined ? undefined : text(cluster.id, `${path}.id`);
    const id = explicitId ?? `cluster-${index + 1}`;
    if (clusterIds.has(id)) throw new Error(`Duplicate cluster id: ${id}`);
    clusterIds.add(id);

    if (
      !Array.isArray(cluster.nodes) ||
      cluster.nodes.length === 0 ||
      cluster.nodes.length > 64
    )
      throw new Error(`${path}.nodes must contain 1–64 node IDs.`);

    const members = cluster.nodes.map((nodeId, memberIndex) => {
      const member = text(nodeId, `${path}.nodes[${memberIndex}]`);
      if (!ids.has(member))
        throw new Error(`${path} references an unknown node.`);
      return member;
    });
    if (new Set(members).size !== members.length)
      throw new Error(`${path}.nodes must not repeat a node.`);
    for (const member of members) {
      if (clustered.has(member))
        throw new Error(`${member} appears in more than one cluster.`);
      clustered.add(member);
    }

    return {
      ...(explicitId === undefined ? {} : { id: explicitId }),
      ...(cluster.label === undefined
        ? {}
        : { label: text(cluster.label, `${path}.label`) }),
      nodes: members,
    };
  });

  return {
    version: 1,
    name: text(root.name, "name"),
    nodes,
    connections,
    clusters,
  };
}
