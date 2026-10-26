import type {
  Connection,
  Design,
  DesignInstance,
  FlowCondition,
  OutputPort,
  PlacedInstance,
} from "./design";
import { inferInstanceType } from "./layout";

export type FlowData = Record<string, unknown>;
export type StepState =
  | "waiting"
  | "running"
  | "done"
  | "joined"
  | "blocked"
  | "failed";
export const MAX_FLOW_RUNS = 32;
export const MAX_FLOW_STEPS = 128;
export const MAX_FLOW_DATA = 8192;
/** Visual timing only: these numbers are not vendor performance estimates. */
const LATENCY: Readonly<Record<PlacedInstance["type"], number>> = {
  webpage: 100,
  "compute-server": 300,
  "database-rack": 300,
  cache: 100,
  cdn: 200,
  "message-queue": 100,
  "object-storage": 400,
  "media-worker": 3000,
  branch: 100,
  merge: 100,
};
const MACHINES: Partial<Record<PlacedInstance["type"], true>> = {
  "compute-server": true,
  "database-rack": true,
  cache: true,
  "media-worker": true,
};
/** Outstanding work wins over historical completions when several requests share a visible node. */
const STATE_PRIORITY: Record<StepState, number> = {
  running: 5,
  blocked: 4,
  waiting: 3,
  failed: 2,
  done: 1,
  joined: 1,
};

/** One immutable input/output observation, with mutable execution timing owned solely by the simulator. */
export interface FlowStep {
  id: number;
  nodeId: string;
  instanceId?: string;
  via?: string;
  input: FlowData;
  output?: FlowData;
  outlet?: OutputPort;
  state: StepState;
  progress: number;
  issue: string;
  startedAt?: number;
  finishedAt?: number;
}
export interface FlowRun {
  id: number;
  status: "running" | "waiting" | "complete" | "failed";
  input: FlowData;
  steps: FlowStep[];
  outputs: FlowData[];
  error?: string;
}
interface Token extends FlowStep {
  run: FlowRun;
  hops: number;
  remaining: number;
  duration: number;
}

/** Stable wire identity agrees with the scene and imported document. Explicit IDs distinguish parallel port wires. */
function edgeId(link: Connection): string {
  return link.id ?? `${link.from}->${link.to}`;
}

/** Own-property JSON field traversal, never evaluation of scripts, prototypes or external expressions. */
function fieldValue(data: FlowData, path: string): unknown {
  let value: unknown = data;
  for (const field of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, field))
      return undefined;
    value = (value as Record<string, unknown>)[field];
  }
  return value;
}

/** Match an authored condition against this branch's input snapshot. Missing/non-numeric values never coerce into numeric comparisons. */
function matches(data: FlowData, condition: FlowCondition): boolean {
  const actual = fieldValue(data, condition.field);
  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "not-equals":
      return actual !== condition.value;
    case "greater-than":
      return (
        typeof actual === "number" &&
        typeof condition.value === "number" &&
        actual > condition.value
      );
    case "contains":
      return (
        typeof actual === "string" && actual.includes(String(condition.value))
      );
  }
}

/** Bounded, deterministic workflow interpreter. No networking, provider clients, real files, node-per-packet actors or timers. */
export class FlowSimulation {
  private design!: Design;
  private readonly nodes = new Map<string, DesignInstance>();
  private readonly canonical = new Map<string, string>();
  private readonly members = new Map<string, readonly string[]>();
  private readonly outgoing = new Map<string, Connection[]>();
  private readonly incoming = new Map<string, Set<string>>();
  private readonly occupied = new Set<string>();
  private readonly tokens: Token[] = [];
  private readonly history: FlowRun[] = [];
  private readonly cached = new Map<string, Set<string>>();
  private readonly pendingCache = new Map<FlowRun, Map<string, Set<string>>>();
  private nextRun = 1;
  private nextStep = 1;
  private remainder = 0;
  elapsed = 0;
  cacheHits = 0;
  cacheMisses = 0;

  constructor(design: Design) {
    this.updateDesign(design);
  }

  /** Preserve in-flight requests across wiring/scaling edits; removal of their executing node is an explicit failure. */
  updateDesign(design: Design): void {
    if (this.design === design) return;
    this.design = design;
    this.nodes.clear();
    this.canonical.clear();
    this.members.clear();
    this.outgoing.clear();
    this.incoming.clear();
    for (const node of design.instances) {
      this.nodes.set(node.id, node);
      this.canonical.set(node.id, node.id);
      this.members.set(node.id, [node.id]);
    }
    for (const group of design.clusters)
      for (const id of group.instances) {
        this.canonical.set(id, group.instances[0]);
        this.members.set(group.instances[0], group.instances);
      }
    for (const id of this.cached.keys())
      if (!this.nodes.has(id)) this.cached.delete(id);
    for (const pending of this.pendingCache.values())
      for (const id of pending.keys())
        if (!this.nodes.has(id)) pending.delete(id);
    for (const link of design.connections) {
      const from = this.key(link.from),
        to = this.key(link.to);
      // Internal replication is not another request hop. A logical pool has one relationship per destination/output.
      if (from === to) continue;
      const edges = this.outgoing.get(from) ?? [];
      const pooled =
        (this.members.get(from)?.length ?? 1) > 1 ||
        (this.members.get(to)?.length ?? 1) > 1;
      if (
        pooled &&
        edges.some(
          (edge) =>
            this.key(edge.to) === to &&
            (edge.outlet ?? "out") === (link.outlet ?? "out"),
        )
      )
        continue;
      edges.push(link);
      this.outgoing.set(from, edges);
      const inputs = this.incoming.get(to) ?? new Set<string>();
      inputs.add(edgeId(link));
      this.incoming.set(to, inputs);
    }
    for (const token of this.tokens)
      if (
        this.active(token) &&
        (!this.nodes.has(token.nodeId) ||
          (token.instanceId && !this.nodes.has(token.instanceId)))
      )
        this.fail(
          token.run,
          `Executing node ${token.instanceId ?? token.nodeId} was removed.`,
        );
    this.refresh();
  }

  /** Borrowed observations; caller changes go through start/advance/updateDesign, never through returned objects. */
  get runs(): readonly FlowRun[] {
    return this.history;
  }

  /** Validate the entire batch before creating anything. Copy JSON once so callers cannot rewrite an in-flight request. */
  start(entry: string, input: FlowData, count = 1): number {
    if (!this.nodes.has(entry))
      throw new Error("Choose an entry node in this world.");
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10 ||
      this.history.length + count > MAX_FLOW_RUNS
    )
      throw new Error(
        `Use 1–10 requests per batch; reset after ${MAX_FLOW_RUNS} requests.`,
      );
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null)
    )
      throw new Error("Request data must be a JSON object.");
    const text = JSON.stringify(input, (_key, value: unknown) => {
      if (
        (typeof value === "number" && !Number.isFinite(value)) ||
        typeof value === "undefined" ||
        typeof value === "function" ||
        typeof value === "symbol"
      )
        throw new Error("Request data must contain only finite JSON values.");
      return value;
    });
    if (text.length > MAX_FLOW_DATA)
      throw new Error(
        `Request data must be at most ${MAX_FLOW_DATA} characters.`,
      );
    const data = JSON.parse(text) as FlowData,
      first = this.nextRun;
    for (let index = 0; index < count; index++) {
      const run: FlowRun = {
        id: this.nextRun++,
        status: "running",
        input: data,
        steps: [],
        outputs: [],
      };
      this.history.push(run);
      this.add(run, this.key(entry), data, undefined, 0);
    }
    this.refresh();
    return first;
  }

  /** Fixed 100 ms quanta keep branching, queue order and completion independent of display frame partitioning. */
  advance(milliseconds: number): void {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000
    )
      throw new Error("Advance must be between 0 and 60000 milliseconds.");
    this.remainder += milliseconds;
    while (this.remainder >= 100) {
      this.remainder -= 100;
      this.elapsed += 100;
      const length = this.tokens.length;
      for (let index = 0; index < length; index++) {
        const token = this.tokens[index];
        if (token.run.status === "failed") continue;
        if (token.state === "blocked") {
          if (this.routes(token).length) this.deliver(token);
          continue;
        }
        if (token.state === "waiting") {
          this.begin(token);
          continue;
        }
        if (token.state !== "running") continue;
        token.remaining -= 100;
        token.progress = Math.min(1, 1 - token.remaining / token.duration);
        if (token.remaining <= 0) this.finish(token);
      }
      this.refresh();
    }
  }

  /** The UI can stop its clock entirely when only incomplete merges, unconnected branches or blocked queues remain. */
  get hasWork(): boolean {
    return this.tokens.some(
      (token) =>
        token.run.status !== "failed" &&
        (token.state === "running" ||
          (token.state === "waiting" && this.canBegin(token)) ||
          (token.state === "blocked" && this.routes(token).length > 0)),
    );
  }

  /** Compact counts derive from bounded trace state, not decorative packet animations. */
  get stats() {
    let queued = 0,
      running = 0,
      complete = 0,
      failed = 0;
    for (const token of this.tokens) {
      if (
        token.state === "waiting" &&
        inferInstanceType(token.nodeId) === "message-queue"
      )
        queued++;
      if (token.state === "running") running++;
    }
    for (const run of this.history) {
      if (run.status === "complete") complete++;
      if (run.status === "failed") failed++;
    }
    return {
      queued,
      running,
      complete,
      failed,
      requests: this.history.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  /** Reuse world nodes and existing wires. Only the selected request is traced, preventing a swarm of SVG actors. */
  activity(runId?: number): { nodes: Map<string, string>; wires: Set<string> } {
    const nodes = new Map<string, string>(),
      wires = new Set<string>();
    for (const token of this.tokens) {
      if (runId !== undefined && token.run.id !== runId) continue;
      const state = token.state === "joined" ? "done" : token.state;
      const id = token.instanceId ?? token.nodeId;
      const current = nodes.get(id) as StepState | undefined;
      if (!current || STATE_PRIORITY[state] > STATE_PRIORITY[current])
        nodes.set(id, state);
      if (token.via) wires.add(token.via);
    }
    return { nodes, wires };
  }

  /** Logical replica endpoints share outgoing edges but consume separate physical machine slots. */
  private key(id: string): string {
    return this.canonical.get(id) ?? id;
  }
  private active(token: Token): boolean {
    return (
      token.state === "waiting" ||
      token.state === "running" ||
      token.state === "blocked"
    );
  }
  private free(node: string): string | undefined {
    return (this.members.get(this.key(node)) ?? []).find(
      (id) => !this.occupied.has(id),
    );
  }
  private routes(token: Token): Connection[] {
    return (this.outgoing.get(token.nodeId) ?? []).filter(
      (link) => (link.outlet ?? "out") === (token.outlet ?? "out"),
    );
  }

  /** Queue consumers compete for a job; queue fan-out would duplicate work and is deliberately not used. */
  private consumer(token: Token): Connection | undefined {
    return (this.outgoing.get(token.nodeId) ?? []).find(
      (link) =>
        inferInstanceType(link.to) === "media-worker" && !!this.free(link.to),
    );
  }

  /** All-mode merges wait for one arrival on every connected input. Any-mode merges explicitly do not synchronize. */
  private arrivals(token: Token): Token[] {
    return this.tokens.filter(
      (item) =>
        item.run === token.run &&
        item.nodeId === token.nodeId &&
        item.state === "waiting",
    );
  }
  private canBegin(token: Token): boolean {
    const node = this.nodes.get(token.nodeId);
    if (!node) return false;
    const type = inferInstanceType(node.id);
    if (type === "message-queue") return !!this.consumer(token);
    if (type === "merge" && node.mergeMode !== "any") {
      const arrived = new Set(
        this.arrivals(token).map((item) => item.via ?? "entry"),
      );
      const expected = this.incoming.get(token.nodeId);
      return !expected?.size || [...expected].every((id) => arrived.has(id));
    }
    return !MACHINES[type] || !!this.free(token.nodeId);
  }

  /** Append at most 128 observations per request; cycles and exponential fan-out fail visibly instead of exhausting the browser. */
  private add(
    run: FlowRun,
    nodeId: string,
    input: FlowData,
    via: string | undefined,
    hops: number,
  ): Token | null {
    if (run.status === "failed") return null;
    if (run.steps.length >= MAX_FLOW_STEPS || hops >= 64) {
      this.fail(
        run,
        "Execution limit reached: check for cycles or excessive branching.",
      );
      return null;
    }
    const token: Token = {
      id: this.nextStep++,
      nodeId,
      input,
      via,
      run,
      hops,
      state: "waiting",
      progress: 0,
      issue: "",
      remaining: 0,
      duration: 0,
    };
    run.steps.push(token);
    this.tokens.push(token);
    return token;
  }

  /** Acquire capacity and fold a synchronized merge into one execution without losing the individual arrival observations. */
  private begin(token: Token): void {
    const node = this.nodes.get(token.nodeId)!;
    if (!this.canBegin(token)) {
      const type = inferInstanceType(node.id);
      token.issue =
        type === "merge"
          ? "Waiting for every connected input. Use Any mode to converge mutually exclusive branches."
          : type === "message-queue"
            ? "Queued: connect an idle media worker to this queue."
            : "Waiting for an available machine.";
      return;
    }
    const type = inferInstanceType(node.id);
    if (type === "merge" && node.mergeMode !== "any") {
      const arrivals = this.arrivals(token),
        byInput = new Map<string, Token>();
      for (const item of arrivals)
        if (!byInput.has(item.via ?? "entry"))
          byInput.set(item.via ?? "entry", item);
      token.output = {
        ...token.input,
        branches: [...byInput.values()].map((item) => ({
          from: item.via ?? "entry",
          data: item.input,
        })),
      };
      if (JSON.stringify(token.output).length > MAX_FLOW_DATA) {
        this.fail(token.run, "Merged data exceeds the request data limit.");
        return;
      }
      for (const item of byInput.values())
        if (item !== token) {
          item.state = "joined";
          item.finishedAt = this.elapsed;
        }
    }
    token.instanceId = MACHINES[type] ? this.free(node.id)! : node.id;
    if (MACHINES[type]) this.occupied.add(token.instanceId);
    token.duration =
      this.nodes.get(token.instanceId)!.latencyMs ?? LATENCY[type];
    token.remaining = token.duration;
    token.state = "running";
    token.issue = "";
    token.startedAt = this.elapsed;
  }

  /** Simulated service effects enrich data for inspection; none invoke software, storage, databases or cloud APIs. */
  private finish(token: Token): void {
    const node = this.nodes.get(token.nodeId)!,
      type = inferInstanceType(node.id);
    if (type === "message-queue" && !this.consumer(token)) {
      token.state = "waiting";
      token.progress = 0;
      token.issue = "Queued: all consumers are busy.";
      return;
    }
    let output = token.output ?? token.input;
    if (type === "branch")
      token.outlet = matches(
        token.input,
        node.condition ?? {
          field: "mediaType",
          operator: "equals",
          value: "video",
        },
      )
        ? "true"
        : "false";
    if (type === "compute-server")
      output = { ...output, handledBy: token.instanceId };
    if (type === "message-queue") output = { ...output, queuedBy: node.id };
    if (type === "media-worker")
      output = {
        ...output,
        processedBy: token.instanceId,
        rendition: "encoded",
      };
    if (type === "object-storage")
      output =
        token.input.action === "play"
          ? { ...output, readFrom: node.id }
          : { ...output, storedBy: node.id };
    if (type === "database-rack")
      output = { ...output, persistedBy: token.instanceId };
    if (type === "cache" || type === "cdn") {
      const key = JSON.stringify(output.assetId ?? output.path ?? "default");
      const hit = this.cached.get(node.id)?.has(key) ?? false;
      if (!hit) {
        const pending =
          this.pendingCache.get(token.run) ?? new Map<string, Set<string>>();
        const keys = pending.get(node.id) ?? new Set<string>();
        keys.add(key);
        pending.set(node.id, keys);
        this.pendingCache.set(token.run, pending);
      }
      if (hit) this.cacheHits++;
      else this.cacheMisses++;
      output = { ...output, cache: hit ? "hit" : "miss", servedBy: node.id };
    }
    if (JSON.stringify(output).length > MAX_FLOW_DATA) {
      this.fail(token.run, "Node output exceeds the request data limit.");
      return;
    }
    token.output = output;
    token.finishedAt = this.elapsed;
    if (token.instanceId) this.occupied.delete(token.instanceId);
    if (type === "branch" && !this.routes(token).length) {
      token.state = "blocked";
      token.issue = `Connect this node's ${token.outlet!.toUpperCase()} output.`;
      return;
    }
    this.deliver(token);
  }

  /** Broadcast ordinary outputs; a queue hands off to exactly one reserved consumer. New work starts no earlier than this quantum. */
  private deliver(token: Token): void {
    token.state = "done";
    token.issue = "";
    const queue = inferInstanceType(token.nodeId) === "message-queue";
    const links = queue ? [this.consumer(token)!] : this.routes(token);
    if (!links.length) token.run.outputs.push(token.output!);
    for (const link of links) {
      const next = this.add(
        token.run,
        this.key(link.to),
        token.output!,
        edgeId(link),
        token.hops + 1,
      );
      if (queue && next) this.begin(next);
    }
  }

  /** Failure terminates all branches and releases physical slots; no hanging worker remains after a guard trips. */
  private fail(run: FlowRun, reason: string): void {
    run.status = "failed";
    run.error = reason;
    this.pendingCache.delete(run);
    for (const token of this.tokens)
      if (token.run === run && this.active(token)) {
        token.state = "failed";
        token.issue = reason;
        token.finishedAt = this.elapsed;
        if (token.instanceId) this.occupied.delete(token.instanceId);
      }
  }

  /** A run completes only after all parallel branches finish, not when its first leaf returns. */
  private refresh(): void {
    for (const run of this.history) {
      if (run.status === "failed") continue;
      let active = 0,
        runnable = false;
      for (const step of run.steps) {
        const token = step as Token;
        if (!this.active(token)) continue;
        active++;
        if (
          token.state === "running" ||
          (token.state === "waiting" && this.canBegin(token)) ||
          (token.state === "blocked" && this.routes(token).length)
        )
          runnable = true;
        if (token.state === "waiting" && !this.canBegin(token))
          token.issue =
            inferInstanceType(token.nodeId) === "merge"
              ? "Waiting for all connected inputs; Any mode does not wait."
              : "Waiting for a connected, available consumer or machine.";
      }
      run.status = active === 0 ? "complete" : runnable ? "running" : "waiting";
      // A miss warms only after the entire request succeeds, never while its origin branch is blocked.
      if (run.status === "complete") {
        const pending = this.pendingCache.get(run);
        if (pending) {
          for (const [node, keys] of pending) {
            const cache = this.cached.get(node) ?? new Set<string>();
            for (const key of keys) cache.add(key);
            this.cached.set(node, cache);
          }
          this.pendingCache.delete(run);
        }
      }
    }
  }
}
