/**
 * JSON design document model and validation.
 *
 * The persisted document is deliberately small: an instance is an ID and an
 * optional label, provider, and description; a connection names two IDs, and a
 * cluster groups IDs. Type, color, and position are render-time derivations
 * owned by `layout.ts`, so an exported document never accumulates generated
 * data.
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
 * One renderable system component.
 *
 * This is the placed form consumed by the renderer, not the imported JSON
 * shape. `id` stays the stable key connections target; `label` is the
 * user-facing name (an omitted imported label falls back to `id`).
 */
export interface PlacedInstance {
  id: string;
  type: "database-rack" | "compute-server" | "webpage" | "cache";
  label: string;
  position: Position;
  color: string;
  /** Provider key carried from the document, when one was declared. */
  provider?: string;
}

/**
 * One imported instance. Only identity and presentation are persisted.
 *
 * IDs are the source of truth for both the renderer type (via prefix) and link
 * endpoints. The renderer derives everything else.
 */
export interface DesignInstance {
  id: string;
  label?: string;
  /** Optional tooltip body; plain text, up to 2,000 characters. */
  description?: string;
  /**
   * Optional product/provider key (for example `redis`).
   *
   * Known providers select a dedicated skin for the renderer types they
   * support: accent palette, optional artwork, tooltip mark, and component
   * footprint. A provider on an unsupported renderer is ignored, and unknown
   * providers keep the default appearance, so documents can name providers
   * this build does not style yet. Matched case-insensitively against
   * `providers.ts`.
   */
  provider?: string;
}

/**
 * Directed link between two distinct instances.
 *
 * `id` is optional: the renderer falls back to `from->to`, which keeps simple
 * documents free of bookkeeping. `relation` is optional prose for the link
 * (for example "replicates"); the renderer draws it beside the cable and the
 * inspector repeats it in the link list.
 */
export interface Connection {
  id?: string;
  from: string;
  to: string;
  relation?: string;
}

/**
 * A logical group of replica instances laid out on separate platforms.
 *
 * `id` and `label` are optional. The layout pass derives a stable fallback from
 * the declaration order and uses the label for the on-canvas group caption.
 * Links that cross the group boundary attach to its dashed frame; links
 * between members stay rack-to-rack so replication remains internal.
 */
export interface Cluster {
  id?: string;
  label?: string;
  /** Description of the logical group shown when its tooltip is active. */
  description?: string;
  instances: string[];
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
  instances: DesignInstance[];
  connections: Connection[];
  clusters: Cluster[];
}

/**
 * Horizontal-scaling example: three peers grouped into one cluster with
 * replication links.
 *
 * IDs intentionally use the `db-` prefix; the layout pass turns that prefix
 * into the database-rack renderer, lays the three racks out in one column, and
 * assigns their shared database palette. A dashed floor frame groups replicas.
 * `webAppExample` is the boot scene because it exercises every renderer.
 */
export const example: Design = {
  version: 1,
  name: "Horizontal scaling",
  instances: [
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
      instances: ["db-01", "db-02", "db-03"],
    },
  ],
};

/**
 * Editable three-tier application: a browser frontend calls an API server,
 * which reads and writes through a cache server. On a cache miss the cache
 * server loads from the database itself, so the backend never talks to the
 * database directly. Prefixes select visuals; connections describe requests,
 * not replica membership. The cache names the Redis provider, which also makes
 * this the boot scene: one of every renderer, all inside the initial fit.
 */
export const webAppExample: Design = {
  version: 1,
  name: "Simple web app",
  instances: [
    {
      id: "web-frontend",
      label: "Web frontend",
      description:
        "Renders the application interface and sends HTTPS / JSON requests to the backend API.",
    },
    {
      id: "compute-api",
      label: "Backend API",
      description:
        "Handles application requests and business logic. Every read and write goes through the cache server.",
    },
    {
      id: "cache-server",
      label: "Cache server",
      provider: "redis",
      description:
        "Keeps frequently requested data in memory. On a cache miss it queries the database itself and stores the result.",
    },
    {
      id: "db-app",
      label: "Application database",
      description:
        "Persists application data. Only the cache server connects to it; the backend never queries it directly.",
    },
  ],
  connections: [
    { from: "web-frontend", to: "compute-api", relation: "HTTPS / JSON" },
    { from: "compute-api", to: "cache-server", relation: "GET / SET" },
    { from: "cache-server", to: "db-app", relation: "SQL on miss" },
  ],
  clusters: [],
};

/**
 * Read/write split: one writable primary streams changes to two read replicas.
 *
 * The database nodes share a replica-set cluster; role labels and directed
 * links carry the split that the isometric geometry cannot.
 */
const readReplicaExample: Design = {
  version: 1,
  name: "Read replicas",
  instances: [
    {
      id: "web-frontend",
      label: "Web frontend",
      description: "A browser client that only talks to the backend API.",
    },
    {
      id: "compute-api",
      label: "Backend API",
      description:
        "Sends every write to the primary and spreads reads across the replicas.",
    },
    {
      id: "db-primary",
      label: "Primary database",
      description:
        "The single writer. Streams its changes to the two read replicas.",
    },
    {
      id: "db-read-1",
      label: "Read replica 1",
      description:
        "Serves read queries. May lag slightly behind the primary after a write.",
    },
    {
      id: "db-read-2",
      label: "Read replica 2",
      description:
        "Serves read queries. May lag slightly behind the primary after a write.",
    },
  ],
  connections: [
    { from: "web-frontend", to: "compute-api", relation: "HTTPS / JSON" },
    { from: "compute-api", to: "db-primary", relation: "writes" },
    { from: "compute-api", to: "db-read-1", relation: "reads" },
    { from: "compute-api", to: "db-read-2", relation: "reads" },
    { from: "db-primary", to: "db-read-1", relation: "replicates" },
    { from: "db-primary", to: "db-read-2", relation: "replicates" },
  ],
  clusters: [
    {
      label: "Users replica set",
      description:
        "One writable primary and two read replicas. Reads scale out; writes still have a single home.",
      instances: ["db-primary", "db-read-1", "db-read-2"],
    },
  ],
};

/**
 * Range-sharded users table.
 *
 * Each shard is an independent database, so a hot key or a failed shard is
 * contained to one slice. The API owns the routing table.
 */
const shardingExample: Design = {
  version: 1,
  name: "Database sharding",
  instances: [
    {
      id: "compute-api",
      label: "API + shard router",
      description:
        "Hashes each user ID and sends the query to the shard that owns that key range.",
    },
    {
      id: "db-shard-a",
      label: "Shard A",
      description:
        "Stores the first third of user rows. No other shard keeps a copy.",
    },
    {
      id: "db-shard-b",
      label: "Shard B",
      description:
        "Stores the middle third of user rows. A hot key here affects only this shard.",
    },
    {
      id: "db-shard-c",
      label: "Shard C",
      description:
        "Stores the last third of user rows. Adding a shard means moving keys.",
    },
  ],
  connections: [
    { from: "compute-api", to: "db-shard-a", relation: "keys 0-33%" },
    { from: "compute-api", to: "db-shard-b", relation: "keys 34-66%" },
    { from: "compute-api", to: "db-shard-c", relation: "keys 67-100%" },
  ],
  clusters: [],
};

/**
 * Stateless API fleet behind one load balancer.
 *
 * Every replica shares the same database and keeps no session state, so any
 * request can land on any healthy server.
 */
const loadBalancedExample: Design = {
  version: 1,
  name: "Load-balanced API",
  instances: [
    {
      id: "web-frontend",
      label: "Web frontend",
      description: "Sends requests to one stable load-balancer address.",
    },
    {
      id: "compute-lb",
      label: "Load balancer",
      description:
        "Checks API health and spreads each request across the live replicas.",
    },
    { id: "compute-api-1", label: "API replica 1" },
    { id: "compute-api-2", label: "API replica 2" },
    { id: "compute-api-3", label: "API replica 3" },
    {
      id: "db-app",
      label: "Application database",
      description: "Shared state lives here; the API tier stays stateless.",
    },
  ],
  connections: [
    { from: "web-frontend", to: "compute-lb", relation: "HTTPS" },
    { from: "compute-lb", to: "compute-api-1", relation: "HTTP" },
    { from: "compute-lb", to: "compute-api-2", relation: "HTTP" },
    { from: "compute-lb", to: "compute-api-3", relation: "HTTP" },
    { from: "compute-api-1", to: "db-app", relation: "SQL" },
    { from: "compute-api-2", to: "db-app", relation: "SQL" },
    { from: "compute-api-3", to: "db-app", relation: "SQL" },
  ],
  clusters: [
    {
      label: "Stateless API tier",
      description:
        "Identical API servers behind the load balancer. Add or remove replicas without changing client behavior.",
      instances: ["compute-api-1", "compute-api-2", "compute-api-3"],
    },
  ],
};

/**
 * Database-per-service topology.
 *
 * Each service owns its schema, so cross-service reads go through the owning
 * API rather than a shared table. Deployments and failures stay independent.
 */
const microservicesExample: Design = {
  version: 1,
  name: "Microservices",
  instances: [
    {
      id: "web-frontend",
      label: "Web app",
      description:
        "Calls the API gateway and never queries a service database.",
    },
    {
      id: "compute-gateway",
      label: "API gateway",
      description:
        "Authenticates requests and routes each call to the owning service.",
    },
    {
      id: "compute-orders",
      label: "Orders service",
      description:
        "Owns orders and fulfillment. Deploys independently of the users service.",
    },
    {
      id: "db-orders",
      label: "Orders DB",
      description:
        "Private to the orders service. Other services call its API instead of reading it directly.",
    },
    {
      id: "compute-users",
      label: "Users service",
      description:
        "Owns profiles and authentication data. Deploys independently of orders.",
    },
    {
      id: "db-users",
      label: "Users DB",
      description:
        "Private to the users service. Cross-service reads go through the service API.",
    },
  ],
  connections: [
    { from: "web-frontend", to: "compute-gateway", relation: "HTTPS" },
    { from: "compute-gateway", to: "compute-orders", relation: "gRPC" },
    { from: "compute-gateway", to: "compute-users", relation: "gRPC" },
    { from: "compute-orders", to: "db-orders", relation: "SQL" },
    { from: "compute-users", to: "db-users", relation: "SQL" },
  ],
  clusters: [],
};

/**
 * One reference design in the sidebar picker.
 *
 * `id` is the stable option value; `design.name` is the visible label. The
 * summary states the concept to look for, so switching examples teaches
 * something before the learner hovers a component.
 */
export interface DesignExample {
  id: string;
  summary: string;
  design: Design;
}

/**
 * Curated examples ordered from one request path to distributed topologies.
 *
 * `main.ts` selects the default scene's entry on boot and after Reset. Keep
 * every design valid through `parseDesign` and every name unique: both back
 * the picker's labels and the exported document.
 */
export const examples: readonly DesignExample[] = [
  {
    id: "web-app",
    summary:
      "Follow one request from the browser through the API to the cache and database.",
    design: webAppExample,
  },
  {
    id: "horizontal-scaling",
    summary:
      "Replicas share the traffic; replication keeps their copies in sync.",
    design: example,
  },
  {
    id: "read-replicas",
    summary:
      "Send writes to one primary and spread reads across stand-by replicas.",
    design: readReplicaExample,
  },
  {
    id: "sharding",
    summary:
      "Split rows across independent databases so each shard owns a key range.",
    design: shardingExample,
  },
  {
    id: "load-balanced-api",
    summary:
      "Put a load balancer in front of identical, stateless API servers.",
    design: loadBalancedExample,
  },
  {
    id: "microservices",
    summary:
      "Give each service its own database and let services talk over the network.",
    design: microservicesExample,
  },
];

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
 * Assert a non-empty string within the supplied character limit.
 *
 * IDs, labels, and relations default to 100 characters to bound SVG text.
 * Plain-text tooltip descriptions explicitly use the larger 2,000 limit.
 */
function text(value: unknown, path: string, maxLength = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`${path} must contain 1–${maxLength} characters.`);
  return value;
}

/**
 * Parse and validate a JSON design without touching the live scene.
 *
 * Validation is all-or-nothing: malformed JSON throws `SyntaxError`, schema
 * violations throw `Error`, and the caller keeps the previous scene. Empty
 * scenes are valid. Duplicate instance/link/cluster IDs, dangling endpoints,
 * self-links, and an instance appearing in two clusters are rejected because
 * the renderer resolves all of them by ID.
 *
 * `connections` and `clusters` are optional. Instance entries may be strings
 * (`"db-01"`) or objects (`{ "id": "db-01", "label": "Primary" }`). Generated
 * fields from the previous schema are ignored and never returned.
 *
 * Limits: 64 instances, 256 links, 64 clusters, 100-character strings except
 * optional descriptions (up to 2,000 characters, preserved as plain text) and
 * provider keys (up to 40 characters). Provider keys are trimmed and kept
 * verbatim; the renderer matches them case-insensitively.
 */
export function parseDesign(source: string): Design {
  const root = record(JSON.parse(source) as unknown, "Design");
  if (root.version !== 1) throw new Error("version must be 1.");
  if (!Array.isArray(root.instances) || root.instances.length > 64)
    throw new Error(
      "instances must be an array of at most 64 instance objects.",
    );

  // IDs are collected before links and clusters are parsed so every reference
  // can be checked against the final instance set, not declaration order.
  const ids = new Set<string>();
  const instances = root.instances.map((value, index): DesignInstance => {
    const path = `instances[${index}]`,
      instance: Record<string, unknown> =
        typeof value === "string" ? { id: value } : record(value, path);
    const id = text(instance.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate instance id: ${id}`);
    ids.add(id);
    // `type`, `position`, and `color` are intentionally not read. They are
    // derived from the ID and graph by the layout pass.
    return {
      id,
      ...(instance.label === undefined
        ? {}
        : { label: text(instance.label, `${path}.label`) }),
      ...(instance.description === undefined
        ? {}
        : {
            description: text(
              instance.description,
              `${path}.description`,
              2000,
            ),
          }),
      // Providers name a product skin. Unknown values are preserved so the
      // document remains portable to builds that register more themes.
      ...(instance.provider === undefined
        ? {}
        : { provider: text(instance.provider, `${path}.provider`, 40).trim() }),
    };
  });

  const connectionInput =
    root.connections === undefined ? [] : root.connections;
  if (!Array.isArray(connectionInput) || connectionInput.length > 256)
    throw new Error("connections must be an array of at most 256 links.");

  // Link validation reuses the instance ID set and rejects duplicate effective
  // IDs so DOM elements and CSS variables remain unambiguous.
  const linkIds = new Set<string>();
  const connections = connectionInput.map((value, index): Connection => {
    const path = `connections[${index}]`,
      link = record(value, path);
    const from = text(link.from, `${path}.from`),
      to = text(link.to, `${path}.to`);
    if (!ids.has(from) || !ids.has(to))
      throw new Error(`${path} references an unknown instance.`);
    if (from === to)
      throw new Error(`${path} must connect two different instances.`);

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

  // An instance belongs to at most one cluster: two groups would place the
  // same rack at conflicting coordinates. Cross-cluster membership is therefore
  // treated as a validation error rather than silently picking the first group.
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
      !Array.isArray(cluster.instances) ||
      cluster.instances.length === 0 ||
      cluster.instances.length > 64
    )
      throw new Error(`${path}.instances must contain 1–64 instance IDs.`);

    const members = cluster.instances.map((instanceId, memberIndex) => {
      const member = text(instanceId, `${path}.instances[${memberIndex}]`);
      if (!ids.has(member))
        throw new Error(`${path} references an unknown instance.`);
      return member;
    });
    if (new Set(members).size !== members.length)
      throw new Error(`${path}.instances must not repeat an instance.`);
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
      ...(cluster.description === undefined
        ? {}
        : {
            description: text(cluster.description, `${path}.description`, 2000),
          }),
      instances: members,
    };
  });

  return {
    version: 1,
    name: text(root.name, "name"),
    instances,
    connections,
    clusters,
  };
}
