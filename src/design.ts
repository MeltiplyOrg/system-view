/**
 * JSON design document model and validation.
 *
 * Instances retain identity, presentation and optional user-authored ground
 * placement. Automatic positions, type and color are derived by `layout.ts`;
 * explicit placement is build intent, never a generated position snapshot
 * silently added by the parser.
 */
import { connectionIssue, replicaGroupIssue } from "./component-rules";
import {
  analyticsExample,
  chatExample,
  ecommerceExample,
  paymentsExample,
  saasExample,
  shardedSocialExample,
  videoStreamingExample,
} from "./app-examples";
import { mediaExample } from "./media-example";
import { inferInstanceType } from "./layout";

/** Omitted coverage is a read-through cache that serves 90% of requests locally. */
export const DEFAULT_CACHE_HIT_PERCENT = 90;

export interface Position {
  /** Generated rack-center X in world units. */
  x: number;
  /** Generated rack-center Y in world units. */
  y: number;
  /** Generated platform elevation in world units. */
  z: number;
}

/** User-authored ground center, in the same world units as the isometric grid. */
export interface GroundPoint {
  x: number;
  y: number;
}

/** Shared document limits also bound interactive construction. */
export const MAX_INSTANCES = 64;
export const MAX_CONNECTIONS = 256;
export const MAX_WORLD_COORDINATE = 100_000;

/**
 * One renderable system component.
 *
 * This is the placed form consumed by the renderer, not the imported JSON
 * shape. `id` stays the stable key connections target; `label` is the
 * user-facing name (an omitted imported label falls back to `id`).
 */
export interface PlacedInstance {
  id: string;
  type:
    | "users"
    | "database-rack"
    | "compute-server"
    | "webpage"
    | "cache"
    | "cdn"
    | "load-balancer"
    | "message-queue"
    | "object-storage"
    | "media-worker"
    | "branch"
    | "merge";
  label: string;
  position: Position;
  color: string;
  /** Provider key carried from the document, when one was declared. */
  provider?: string;
}

/** Explicit visual workflow condition. Field paths read own JSON properties; no scripts are evaluated. */
export interface FlowCondition {
  field: string;
  operator: "equals" | "not-equals" | "greater-than" | "contains";
  value: string | number | boolean | null;
}
export type OutputPort = "out" | "true" | "false";

/**
 * One imported instance. Identity, presentation and explicit ground placement
 * are persisted. IDs select the renderer and link endpoints; without placement
 * the layout derives the ground center automatically.
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
  /** Optional manual ground center. Omission keeps the automatic layout. */
  placement?: GroundPoint;
  condition?: FlowCondition;
  mergeMode?: "all" | "any";
  /** Simulated service time, in milliseconds; never a real network timeout. */
  latencyMs?: number;
  /** Educational throughput budget in requests/second; omitted uses the node type default. */
  capacityRps?: number;
  /** Requests emitted per second by a Users source, 0–20; omitted defaults to one. */
  trafficRps?: number;
  /** Cache-only local hit coverage, 0–100%; misses continue to downstream dependencies. */
  cacheHitPercent?: number;
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
  outlet?: OutputPort;
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

/** Organizational container only: mixed node types retain their own wiring and replica pools. */
export interface NodeGroup {
  id: string;
  label: string;
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
  /** Optional organizational containers; absence means an ungrouped world. */
  groups?: NodeGroup[];
}

/**
 * Horizontal scaling in a complete web path: stateless API replicas, a shared
 * cache, a writable database with stand-by replicas, and one asynchronous
 * worker tier. Explicit placements keep every lane short enough to read.
 */
export const example: Design = {
  version: 1,
  name: "Horizontal scaling",
  instances: [
    {
      id: "users-scale",
      label: "Users",
      trafficRps: 1,
      placement: { x: -1680, y: 0 },
    },
    { id: "web-scale", label: "Web frontend", placement: { x: -1260, y: 0 } },
    {
      id: "lb-scale",
      label: "API load balancer",
      placement: { x: -840, y: 0 },
    },
    {
      id: "compute-scale-1",
      label: "API replica 1",
      capacityRps: 80,
      placement: { x: -420, y: -480 },
    },
    {
      id: "compute-scale-2",
      label: "API replica 2",
      capacityRps: 80,
      placement: { x: -420, y: 0 },
    },
    {
      id: "compute-scale-3",
      label: "API replica 3",
      capacityRps: 80,
      placement: { x: -420, y: 480 },
    },
    {
      id: "cache-scale",
      label: "Shared session cache",
      provider: "redis",
      placement: { x: 0, y: 0 },
    },
    {
      id: "db-primary",
      label: "Writable primary",
      provider: "postgresql",
      placement: { x: 420, y: -160 },
    },
    {
      id: "db-replica-1",
      label: "Stand-by replica 1",
      provider: "postgresql",
      placement: { x: 420, y: 160 },
    },
    {
      id: "db-replica-2",
      label: "Stand-by replica 2",
      provider: "postgresql",
      placement: { x: 420, y: 480 },
    },
    {
      id: "queue-events",
      label: "Audit events",
      provider: "rabbitmq",
      placement: { x: 840, y: 0 },
    },
    {
      id: "worker-events",
      label: "Audit worker",
      placement: { x: 1260, y: 0 },
    },
    {
      id: "storage-events",
      label: "Audit archive",
      provider: "amazon-s3",
      placement: { x: 1680, y: 0 },
    },
  ],
  connections: [
    { from: "users-scale", to: "web-scale", relation: "HTTPS" },
    { from: "web-scale", to: "lb-scale", relation: "HTTPS" },
    { from: "lb-scale", to: "compute-scale-1", relation: "HTTP" },
    { from: "lb-scale", to: "compute-scale-2", relation: "HTTP" },
    { from: "lb-scale", to: "compute-scale-3", relation: "HTTP" },
    { from: "compute-scale-1", to: "cache-scale", relation: "SESSION" },
    { from: "compute-scale-2", to: "cache-scale", relation: "SESSION" },
    { from: "compute-scale-3", to: "cache-scale", relation: "SESSION" },
    { from: "cache-scale", to: "db-primary", relation: "MISS" },
    { from: "compute-scale-1", to: "db-primary", relation: "SQL" },
    { from: "compute-scale-2", to: "db-primary", relation: "SQL" },
    { from: "compute-scale-3", to: "db-primary", relation: "SQL" },
    { from: "db-primary", to: "db-replica-1", relation: "REPLICATES" },
    { from: "db-primary", to: "db-replica-2", relation: "REPLICATES" },
    { from: "compute-scale-1", to: "queue-events", relation: "AUDIT" },
    { from: "queue-events", to: "worker-events", relation: "DELIVER" },
    { from: "worker-events", to: "storage-events", relation: "ARCHIVE" },
    { from: "worker-events", to: "db-primary", relation: "CHECKPOINT" },
  ],
  clusters: [
    {
      label: "Stateless API fleet",
      instances: ["compute-scale-1", "compute-scale-2", "compute-scale-3"],
    },
    {
      label: "Primary + stand-by replicas",
      instances: ["db-primary", "db-replica-1", "db-replica-2"],
    },
  ],
};

/** Explicit source-to-storage journey; one visible marker is one real simulated request. */
export const webAppExample: Design = {
  version: 1,
  name: "Simple web app",
  instances: [
    {
      id: "users-source",
      label: "Users",
      trafficRps: 1,
      placement: { x: 0, y: 0 },
      description:
        "Generates individual requests. Select Users to set requests per second.",
    },
    {
      id: "web-frontend",
      label: "Web frontend",
      latencyMs: 100,
      placement: { x: 650, y: 0 },
      description:
        "Receives user requests and forwards them to the backend API.",
    },
    {
      id: "compute-api",
      label: "Backend API",
      capacityRps: 8,
      latencyMs: 100,
      placement: { x: 1300, y: 0 },
      description:
        "Processes each incoming request, then queries the application database.",
    },
    {
      id: "db-app",
      label: "Application database",
      capacityRps: 4,
      latencyMs: 100,
      placement: { x: 1950, y: 0 },
      description:
        "Stores application data. Requests finish here after database processing.",
    },
  ],
  connections: [
    { from: "users-source", to: "web-frontend", relation: "USER REQUEST" },
    { from: "web-frontend", to: "compute-api", relation: "HTTPS / JSON" },
    { from: "compute-api", to: "db-app", relation: "SQL" },
  ],
  clusters: [],
};

/**
 * Database-per-service marketplace. Each service owns its schema, so
 * cross-service reads go through the owning API rather than a shared table;
 * the gateway also fronts session, queue and media delivery.
 */
const microservicesExample: Design = {
  version: 1,
  name: "Microservices marketplace",
  instances: [
    {
      id: "users-market",
      label: "Marketplace users",
      trafficRps: 1,
      placement: { x: -1680, y: 0 },
    },
    {
      id: "web-market",
      label: "Marketplace web app",
      placement: { x: -1260, y: 0 },
    },
    {
      id: "lb-market",
      label: "Gateway load balancer",
      placement: { x: -840, y: 0 },
    },
    {
      id: "compute-gateway",
      label: "API gateway",
      placement: { x: -420, y: 0 },
    },
    {
      id: "compute-orders",
      label: "Orders service",
      placement: { x: 0, y: -480 },
    },
    {
      id: "db-orders",
      label: "Orders DB",
      provider: "postgresql",
      placement: { x: 420, y: -480 },
    },
    { id: "compute-users", label: "Users service", placement: { x: 0, y: 0 } },
    {
      id: "db-users",
      label: "Users DB",
      provider: "postgresql",
      placement: { x: 420, y: 0 },
    },
    {
      id: "compute-payments",
      label: "Payments service",
      placement: { x: 0, y: 480 },
    },
    {
      id: "db-payments",
      label: "Payments DB",
      provider: "postgresql",
      placement: { x: 420, y: 480 },
    },
    {
      id: "cache-gateway",
      label: "Gateway session cache",
      provider: "redis",
      placement: { x: 0, y: 800 },
    },
    {
      id: "queue-events",
      label: "Domain events",
      provider: "rabbitmq",
      placement: { x: 840, y: 0 },
    },
    {
      id: "worker-events",
      label: "Delivery worker",
      placement: { x: 1260, y: 0 },
    },
    {
      id: "storage-media",
      label: "Listing media",
      provider: "amazon-s3",
      placement: { x: 840, y: -480 },
    },
    {
      id: "cdn-market",
      label: "Marketplace CDN",
      provider: "cloudflare",
      placement: { x: 1260, y: -480 },
    },
  ],
  connections: [
    { from: "users-market", to: "web-market", relation: "HTTPS" },
    { from: "web-market", to: "lb-market", relation: "HTTPS" },
    { from: "lb-market", to: "compute-gateway", relation: "HTTP" },
    { from: "compute-gateway", to: "compute-orders", relation: "gRPC" },
    { from: "compute-gateway", to: "compute-users", relation: "gRPC" },
    { from: "compute-gateway", to: "compute-payments", relation: "gRPC" },
    { from: "compute-gateway", to: "cache-gateway", relation: "SESSION" },
    { from: "cache-gateway", to: "db-users", relation: "MISS" },
    { from: "compute-orders", to: "db-orders", relation: "SQL" },
    { from: "compute-users", to: "db-users", relation: "SQL" },
    { from: "compute-payments", to: "db-payments", relation: "SQL" },
    { from: "compute-orders", to: "queue-events", relation: "ORDER EVENTS" },
    { from: "queue-events", to: "worker-events", relation: "DELIVER" },
    { from: "worker-events", to: "db-orders", relation: "STATUS" },
    { from: "worker-events", to: "storage-media", relation: "ARCHIVE" },
    { from: "compute-users", to: "storage-media", relation: "UPLOAD" },
    { from: "storage-media", to: "cdn-market", relation: "PUBLISH" },
  ],
  clusters: [],
};

/**
 * Edge delivery for a complete site: the CDN serves cached assets, misses
 * reach an origin, and dynamic API traffic runs behind its own load balancer.
 */
const cdnDeliveryExample: Design = {
  version: 1,
  name: "Global content delivery",
  instances: [
    {
      id: "users-viewers",
      label: "Global viewers",
      trafficRps: 1,
      placement: { x: -1680, y: 0 },
    },
    { id: "web-site", label: "Web site", placement: { x: -1260, y: 0 } },
    {
      id: "cdn-edge",
      label: "Global edge",
      placement: { x: -840, y: 0 },
    },
    {
      id: "compute-origin",
      label: "Asset origin",
      placement: { x: -420, y: -320 },
    },
    {
      id: "storage-assets",
      label: "Published assets",
      provider: "amazon-s3",
      placement: { x: 0, y: -320 },
    },
    {
      id: "lb-api",
      label: "API load balancer",
      placement: { x: -420, y: 320 },
    },
    {
      id: "compute-api-a",
      label: "Dynamic API A",
      capacityRps: 80,
      placement: { x: 0, y: 320 },
    },
    {
      id: "compute-api-b",
      label: "Dynamic API B",
      capacityRps: 80,
      placement: { x: 0, y: 640 },
    },
    {
      id: "cache-content",
      label: "Content cache",
      provider: "redis",
      placement: { x: 420, y: 320 },
    },
    {
      id: "db-content",
      label: "Content database",
      provider: "postgresql",
      placement: { x: 420, y: 640 },
    },
    {
      id: "storage-uploads",
      label: "User uploads",
      provider: "cloudflare-r2",
      placement: { x: 420, y: 0 },
    },
  ],
  connections: [
    { from: "users-viewers", to: "web-site", relation: "HTTPS" },
    { from: "web-site", to: "cdn-edge", relation: "STATIC ASSETS" },
    { from: "web-site", to: "lb-api", relation: "DYNAMIC API" },
    { from: "cdn-edge", to: "compute-origin", relation: "ORIGIN / MISS" },
    { from: "compute-origin", to: "storage-assets", relation: "READ" },
    { from: "compute-origin", to: "db-content", relation: "MANIFEST" },
    { from: "lb-api", to: "compute-api-a", relation: "HTTP" },
    { from: "lb-api", to: "compute-api-b", relation: "HTTP" },
    { from: "compute-api-a", to: "cache-content", relation: "LOOKUP" },
    { from: "compute-api-b", to: "cache-content", relation: "LOOKUP" },
    { from: "cache-content", to: "db-content", relation: "MISS" },
    { from: "compute-api-a", to: "db-content", relation: "SQL" },
    { from: "compute-api-b", to: "db-content", relation: "SQL" },
    { from: "compute-api-a", to: "storage-uploads", relation: "UPLOAD" },
    { from: "compute-api-b", to: "storage-uploads", relation: "UPLOAD" },
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
  /** Picker section; examples with the same label must stay contiguous. */
  group: string;
  summary: string;
  design: Design;
}

/**
 * Curated full-architecture examples grouped by product domain.
 *
 * `main.ts` renders one `<optgroup>` per `group`, selects the default scene's
 * entry on boot/Reset, and keeps the picker and exported document in sync.
 * Every design must round-trip through `parseDesign`, use unique visible names,
 * and keep its explicit sites from overlapping.
 */
export const examples: readonly DesignExample[] = [
  {
    id: "web-app",
    group: "Applications",
    summary:
      "The starter path: Users → frontend → backend API → application database. Use it to learn individual requests, capacity and queued load before exploring larger products.",
    design: webAppExample,
  },
  {
    id: "ecommerce-checkout",
    group: "Applications",
    summary:
      "A complete storefront: edge assets, load-balanced APIs, session and catalog caches, order and payment services, an asynchronous fulfillment queue, notifications and receipt storage.",
    design: ecommerceExample,
  },
  {
    id: "saas-workspace",
    group: "Applications",
    summary:
      "Multi-tenant workspace with a load-balanced API tier, writable tenant primary plus read replica, billing service and an asynchronous export worker.",
    design: saasExample,
  },
  {
    id: "payments-ledger",
    group: "Applications",
    summary:
      "Payment authorization: idempotency cache, risk service, a primary ledger with a read replica, merchant data, settlement workers and archived receipts.",
    design: paymentsExample,
  },
  {
    id: "chat-platform",
    group: "Applications",
    summary:
      "Realtime chat with presence cache, message storage, attachment CDN, fan-out workers and an offline push queue.",
    design: chatExample,
  },
  {
    id: "media-processing",
    group: "Media & delivery",
    summary:
      "Upload, queue, encode and publish media. Parallel video/image paths merge before publication, storage, catalogue and playback delivery.",
    design: mediaExample,
  },
  {
    id: "video-streaming",
    group: "Media & delivery",
    summary:
      "Creator ingest and viewer playback share a transcoding queue, master and rendition buckets, a catalogue cache and a global video CDN.",
    design: videoStreamingExample,
  },
  {
    id: "cdn-delivery",
    group: "Media & delivery",
    summary:
      "A full delivery site: cached assets at the edge, origin misses, dynamic API replicas, content cache and database, plus user uploads stored back in object storage.",
    design: cdnDeliveryExample,
  },
  {
    id: "analytics-pipeline",
    group: "Data & scale",
    summary:
      "Analyst console over an ingest fleet, buffered event stream, batch loader, raw event lake, warehouse and query cache.",
    design: analyticsExample,
  },
  {
    id: "horizontal-scaling",
    group: "Data & scale",
    summary:
      "A complete web path with stateless API replicas, shared cache, writable primary and stand-by replicas, plus an asynchronous audit worker.",
    design: example,
  },
  {
    id: "sharded-social",
    group: "Data & scale",
    summary:
      "Sharded social feed: load-balanced feed APIs, cache, key router, three independent shards, fan-out workers and media delivery.",
    design: shardedSocialExample,
  },
  {
    id: "microservices",
    group: "Data & scale",
    summary:
      "Marketplace microservices with a gateway, independent orders/users/payments databases, session cache, domain-event worker and listing media CDN.",
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

/** Validate explicit build intent before it can affect SVG bounds or camera scale. */
function groundPlacement(value: unknown, path: string): GroundPoint {
  const point = record(value, path);
  for (const axis of ["x", "y"] as const)
    if (
      typeof point[axis] !== "number" ||
      !Number.isFinite(point[axis]) ||
      Math.abs(point[axis]) > MAX_WORLD_COORDINATE
    )
      throw new Error(
        `${path}.${axis} must be a finite coordinate within ±${MAX_WORLD_COORDINATE}.`,
      );
  return { x: point.x as number, y: point.y as number };
}

/** Validate authored capacity only on services; never silently attach a budget to a client or fitting. */
function serviceCapacity(value: unknown, id: string, path: string): number {
  const type = inferInstanceType(id);
  if (
    type === "users" ||
    type === "webpage" ||
    type === "branch" ||
    type === "merge"
  )
    throw new Error(
      `${path}.capacityRps applies only to capacity-limited services.`,
    );
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 1_000_000
  )
    throw new Error(
      `${path}.capacityRps must be between 1 and 1000000 requests/s.`,
    );
  return value;
}

/** Only explicit Users generate traffic; zero pauses this source without deleting its wire. */
function sourceTraffic(value: unknown, id: string, path: string): number {
  if (inferInstanceType(id) !== "users")
    throw new Error(`${path}.trafficRps applies only to Users.`);
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 20
  )
    throw new Error(`${path}.trafficRps must be between 0 and 20 requests/s.`);
  return value;
}

/** Validate cache coverage independently of provider skins; zero and fractional percentages are meaningful. */
function cacheCoverage(value: unknown, id: string, path: string): number {
  if (inferInstanceType(id) !== "cache")
    throw new Error(`${path}.cacheHitPercent applies only to caches.`);
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    throw new Error(
      `${path}.cacheHitPercent must be between 0 and 100 percent.`,
    );
  return value;
}

/** Validate authored workflow behavior independently of renderer/provider presentation. */
function flowSettings(
  instance: Record<string, unknown>,
  path: string,
): Pick<DesignInstance, "condition" | "mergeMode" | "latencyMs"> {
  const settings: Pick<
    DesignInstance,
    "condition" | "mergeMode" | "latencyMs"
  > = {};
  const type = inferInstanceType(String(instance.id));
  if (instance.condition !== undefined && type !== "branch")
    throw new Error(`${path}.condition applies only to If / Else nodes.`);
  if (instance.mergeMode !== undefined && type !== "merge")
    throw new Error(`${path}.mergeMode applies only to Merge nodes.`);
  if (instance.latencyMs !== undefined) {
    if (
      typeof instance.latencyMs !== "number" ||
      !Number.isFinite(instance.latencyMs) ||
      instance.latencyMs < 100 ||
      instance.latencyMs > 30000
    )
      throw new Error(`${path}.latencyMs must be between 100 and 30000.`);
    settings.latencyMs = instance.latencyMs;
  }
  if (instance.mergeMode !== undefined) {
    if (instance.mergeMode !== "all" && instance.mergeMode !== "any")
      throw new Error(`${path}.mergeMode must be all or any.`);
    settings.mergeMode = instance.mergeMode;
  }
  if (instance.condition !== undefined) {
    const condition = record(instance.condition, `${path}.condition`);
    const field = text(condition.field, `${path}.condition.field`);
    if (
      !["equals", "not-equals", "greater-than", "contains"].includes(
        String(condition.operator),
      )
    )
      throw new Error(`${path}.condition.operator is not supported.`);
    if (
      condition.value !== null &&
      typeof condition.value !== "string" &&
      typeof condition.value !== "number" &&
      typeof condition.value !== "boolean"
    )
      throw new Error(`${path}.condition.value must be a JSON scalar.`);
    if (
      (typeof condition.value === "number" &&
        !Number.isFinite(condition.value)) ||
      (typeof condition.value === "string" && condition.value.length > 100)
    )
      throw new Error(
        `${path}.condition.value is outside the supported range.`,
      );
    settings.condition = {
      field,
      operator: condition.operator as FlowCondition["operator"],
      value: condition.value as FlowCondition["value"],
    };
  }
  return settings;
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
  if (!Array.isArray(root.instances) || root.instances.length > MAX_INSTANCES)
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
      ...(instance.placement === undefined
        ? {}
        : {
            placement: groundPlacement(instance.placement, `${path}.placement`),
          }),
      ...(instance.capacityRps === undefined
        ? {}
        : { capacityRps: serviceCapacity(instance.capacityRps, id, path) }),
      ...(instance.trafficRps === undefined
        ? {}
        : { trafficRps: sourceTraffic(instance.trafficRps, id, path) }),
      ...(instance.cacheHitPercent === undefined
        ? {}
        : {
            cacheHitPercent: cacheCoverage(instance.cacheHitPercent, id, path),
          }),
      ...flowSettings(instance, path),
    };
  });

  const connectionInput =
    root.connections === undefined ? [] : root.connections;
  if (
    !Array.isArray(connectionInput) ||
    connectionInput.length > MAX_CONNECTIONS
  )
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

    const issue = connectionIssue(
      instances.find((item) => item.id === from)!,
      instances.find((item) => item.id === to)!,
      link.outlet as OutputPort | undefined,
    );
    if (issue) throw new Error(`${path}: ${issue}`);
    const explicitId =
      link.id === undefined ? undefined : text(link.id, `${path}.id`);
    const id = explicitId ?? `${from}->${to}`;
    if (linkIds.has(id)) throw new Error(`Duplicate connection id: ${id}`);
    linkIds.add(id);

    return {
      ...(explicitId === undefined ? {} : { id: explicitId }),
      from,
      to,
      ...(link.outlet === undefined
        ? {}
        : { outlet: link.outlet as OutputPort }),
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
    const issue = replicaGroupIssue(
      members.map((id) => instances.find((item) => item.id === id)!),
    );
    if (issue) throw new Error(`${path}: ${issue}`);

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

  const groupInput = root.groups === undefined ? [] : root.groups;
  if (!Array.isArray(groupInput) || groupInput.length > 64)
    throw new Error("groups must be an array of at most 64 node groups.");
  const groupIds = new Set<string>(),
    grouped = new Map<string, string>();
  const groups = groupInput.map((value, index): NodeGroup => {
    const path = `groups[${index}]`,
      group = record(value, path);
    const id = text(group.id, `${path}.id`);
    if (groupIds.has(id)) throw new Error(`Duplicate node group id: ${id}`);
    groupIds.add(id);
    if (
      !Array.isArray(group.instances) ||
      !group.instances.length ||
      group.instances.length > 64
    )
      throw new Error(`${path}.instances must contain 1–64 instance IDs.`);
    const members = group.instances.map((value, memberIndex) => {
      const member = text(value, `${path}.instances[${memberIndex}]`);
      if (!ids.has(member))
        throw new Error(`${path} references an unknown instance.`);
      if (grouped.has(member))
        throw new Error(`${member} appears more than once in node groups.`);
      grouped.set(member, id);
      return member;
    });
    return {
      id,
      label: text(group.label, `${path}.label`),
      instances: members,
    };
  });
  // Replica pools are atomic movement units. Splitting one across containers
  // would make a pool handle move nodes outside its organizational group.
  for (const cluster of clusters) {
    const owners = new Set(cluster.instances.map((id) => grouped.get(id)));
    if (owners.size > 1)
      throw new Error(
        "A replica pool must belong entirely to one node group or remain ungrouped.",
      );
  }

  return {
    version: 1,
    name: text(root.name, "name"),
    instances,
    connections,
    clusters,
    ...(root.groups === undefined ? {} : { groups }),
  };
}
