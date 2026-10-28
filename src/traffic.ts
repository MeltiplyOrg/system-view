import type { Design, DesignInstance, PlacedInstance } from "./design";
import { DEFAULT_CACHE_HIT_PERCENT } from "./design";
import { inferInstanceType } from "./layout";
import { hasResponse } from "./component-rules";

/** Fixed time for one node-to-node journey, in simulated and wall seconds. */
const NETWORK_SECONDS = 0.01;

/** Illustrative service budgets, not vendor benchmarks. */
const CAPACITY: Partial<Record<PlacedInstance["type"], number>> = {
  "compute-server": 1000,
  "database-rack": 500,
  cache: 4000,
  cdn: 8000,
  "load-balancer": 10000,
  "message-queue": 2000,
  "object-storage": 1500,
  "media-worker": 100,
};
export interface NodeLoad {
  id: string;
  capacityRps: number;
  incomingRps: number;
  acceptedRps: number;
  queued: number;
  utilization: number;
}
export interface LinkFlow {
  index: number;
  rateRps: number;
  responseRps: number;
}
/** One visible circle is one request/response branch, never a weighted sample or repeating dash. */
export interface RequestMarker {
  id: number;
  requestId: number;
  connectionIndex: number;
  progress: number;
  direction: "request" | "response";
  failed: boolean;
  phase: "request" | "response" | "queued" | "processing";
}

/** Session SLOs: latency in milliseconds and failed root responses / completed root responses (0..1). */
export interface CrashLimits {
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}
export const DEFAULT_CRASH_LIMITS: Readonly<CrashLimits> = {
  p95Ms: 1_000,
  p99Ms: 2_000,
  errorRate: 0.05,
};
export interface TrafficMetrics {
  p95Ms: number | null;
  p99Ms: number | null;
  errorRate: number | null;
  samples: number;
}
export interface SimulationSnapshot {
  loads: readonly NodeLoad[];
  flows: readonly LinkFlow[];
  requests: readonly RequestMarker[];
  generated: number;
  completed: number;
  rejected: number;
  limited: number;
  time: number;
  metrics: TrafficMetrics;
  crash: { at: number; breaches: (keyof CrashLimits)[] } | null;
}
interface Output {
  to: number;
  link: number;
}
interface Actor {
  marker: RequestMarker;
  node: number;
  hops: number;
  started: number;
  ready: number;
  phase: "request" | "queued" | "processing" | "waiting" | "response";
  parent: Actor | null;
  children: number;
  reply: boolean;
  failed: boolean;
}
interface Service {
  load: NodeLoad;
  tokens: number;
  tokenTime: number;
  arrivals: number[];
  admissions: number[];
  queue: Actor[];
}

/** Sources and routing fittings have no service capacity meter. */
export function capacityRps(instance: DesignInstance): number | null {
  const budget = CAPACITY[inferInstanceType(instance.id)];
  return budget === undefined ? null : (instance.capacityRps ?? budget);
}

/**
 * Deterministic simulated time: 10ms per wire leg, configured processing, then
 * dependency calls. A caller waits for every synchronous child response before
 * replying on its own incoming wire. One-way children detach at dispatch, so
 * queue jobs/replication cannot invent responses or hold an HTTP caller open.
 * Returned success/error markers retain the request ID and consume no new
 * capacity tokens. Excess arrivals wait FIFO; queueing time contributes to root
 * response percentiles. All calls share the 512-actor ceiling; the 32-hop TTL
 * rejects cycles. Rolling root-response SLO breaches latch a frozen crash state.
 * No payload execution, merge barrier or durable queue is implied.
 */
export class TrafficModel {
  private readonly types: PlacedInstance["type"][];
  private readonly outputs: Output[][];
  private readonly turns: number[];
  private readonly cacheMissCredit: number[];
  private readonly sources: { node: number; period: number; next: number }[];
  private readonly services: (Service | null)[];
  private readonly sends: number[][];
  private readonly returns: number[][];
  private readonly replies: boolean[];
  private readonly actors: Actor[] = [];
  private readonly state: SimulationSnapshot;
  private readonly rootStarts = new Map<number, number>();
  private readonly outcomes: {
    at: number;
    latencyMs: number;
    failed: boolean;
  }[] = [];
  private readonly limits: CrashLimits;
  private metricsChanged = false;
  private nextActor = 1;
  private nextRequest = 1;

  constructor(
    private readonly design: Design,
    limits: CrashLimits = DEFAULT_CRASH_LIMITS,
  ) {
    this.cacheMissCredit = design.instances.map(() => 0);
    if (
      ![limits.p95Ms, limits.p99Ms].every(
        (value) => Number.isFinite(value) && value > 0,
      ) ||
      !Number.isFinite(limits.errorRate) ||
      limits.errorRate < 0 ||
      limits.errorRate > 1
    )
      throw new Error(
        "Crash limits need positive finite latencies and an error rate between 0 and 1.",
      );
    this.limits = { ...limits };
    this.types = design.instances.map((node) => inferInstanceType(node.id));
    this.outputs = design.instances.map(() => []);
    this.turns = design.instances.map(() => 0);
    this.sends = design.connections.map(() => []);
    this.returns = design.connections.map(() => []);
    const indices = new Map(design.instances.map((node, i) => [node.id, i]));
    this.replies = design.connections.map((edge, link) => {
      const from = indices.get(edge.from),
        to = indices.get(edge.to);
      if (from === undefined || to === undefined) return false;
      this.outputs[from].push({ to, link });
      return hasResponse(design.instances[from], design.instances[to]);
    });
    this.sources = design.instances.flatMap((node, i) => {
      if (this.types[i] !== "users") return [];
      const rate = node.trafficRps ?? 1,
        period = rate > 0 ? 1 / rate : Infinity;
      return [{ node: i, period, next: period }];
    });
    this.services = design.instances.map((node) => {
      const capacity = capacityRps(node);
      if (capacity === null) return null;
      return {
        load: {
          id: node.id,
          capacityRps: capacity,
          incomingRps: 0,
          acceptedRps: 0,
          queued: 0,
          utilization: 0,
        },
        tokens: capacity,
        tokenTime: 0,
        arrivals: [],
        admissions: [],
        queue: [],
      };
    });
    this.state = {
      loads: this.services.flatMap((service) =>
        service ? [service.load] : [],
      ),
      flows: design.connections.map((_, index) => ({
        index,
        rateRps: 0,
        responseRps: 0,
      })),
      requests: [],
      generated: 0,
      completed: 0,
      rejected: 0,
      limited: 0,
      time: 0,
      metrics: { p95Ms: null, p99Ms: null, errorRate: null, samples: 0 },
      crash: null,
    };
  }

  /** Borrow current state; only step advances time, so pausing freezes both directions. */
  snapshot(): SimulationSnapshot {
    return this.state;
  }

  /** Skip only the initial empty interval so Run starts with an actual source emission. */
  begin(): SimulationSnapshot {
    if (this.state.time === 0 && this.state.generated === 0) {
      const first = Math.min(...this.sources.map((source) => source.next));
      if (Number.isFinite(first)) this.state.time = first;
    }
    return this.step(0);
  }

  /** Advance 0..1 seconds, resolving chronological events independently of display frame size. */
  step(dtSeconds: number): SimulationSnapshot {
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0 || dtSeconds > 1)
      throw new Error("Simulation step must be between 0 and 1 second.");
    if (this.state.crash) return this.state;
    const end = this.state.time + dtSeconds;
    for (;;) {
      if (this.state.crash) return this.refresh();
      let at = Infinity,
        actorIndex = -1,
        sourceIndex = -1;
      for (let i = 0; i < this.actors.length; i++)
        if (this.actors[i].ready < at) {
          at = this.actors[i].ready;
          actorIndex = i;
        }
      for (let i = 0; i < this.sources.length; i++)
        if (this.sources[i].next < at) {
          at = this.sources[i].next;
          actorIndex = -1;
          sourceIndex = i;
        }
      if (at > end + 1e-9 || !Number.isFinite(at)) break;
      this.state.time = at;
      if (sourceIndex >= 0) {
        const source = this.sources[sourceIndex];
        source.next += source.period;
        this.state.generated++;
        this.rootStarts.set(this.nextRequest, at);
        const outputs = this.outputs[source.node];
        if (!outputs.length) {
          this.state.rejected++;
          this.outcome(this.nextRequest, at, true);
        } else if (
          !this.spawn(
            outputs[this.turns[source.node]++ % outputs.length],
            this.nextRequest,
            1,
            at,
            null,
          )
        )
          this.outcome(this.nextRequest, at, true);
        this.nextRequest++;
        continue;
      }
      const actor = this.actors[actorIndex];
      if (actor.phase === "response") {
        this.settle(actor, at);
        continue;
      }
      if (actor.phase === "processing") {
        this.forward(actor, at);
        continue;
      }
      const service = this.services[actor.node];
      if (service) {
        if (actor.phase === "request") {
          service.arrivals.push(at);
          service.queue.push(actor);
          actor.phase = "queued";
          actor.ready = Infinity;
        }
        this.admit(service, at);
      } else this.process(actor, at);
    }
    this.state.time = end;
    return this.refresh();
  }

  /** FIFO admission: only the head wakes at the next available token; new arrivals cannot jump it. */
  private admit(service: Service, at: number): void {
    const capacity = service.load.capacityRps;
    service.tokens = Math.min(
      capacity,
      service.tokens + (at - service.tokenTime) * capacity,
    );
    service.tokenTime = at;
    while (service.queue.length && service.tokens >= 1 - 1e-9) {
      service.tokens = Math.max(0, service.tokens - 1);
      service.admissions.push(at);
      this.process(service.queue.shift()!, at);
    }
    if (service.queue.length)
      service.queue[0].ready = at + (1 - service.tokens) / capacity;
  }

  /** Processing starts only after admission; queue waiting contributes to end-to-end latency. */
  private process(actor: Actor, at: number): void {
    actor.phase = "processing";
    actor.ready =
      at + (this.design.instances[actor.node].latencyMs ?? 100) / 1000;
  }

  /** Reserve one bounded call. A synchronous child references its waiting caller; async work detaches. */
  private spawn(
    output: Output,
    requestId: number,
    hops: number,
    at: number,
    parent: Actor | null,
  ): boolean {
    if (this.actors.length >= 512) {
      this.state.limited++;
      return false;
    }
    const reply = this.replies[output.link];
    this.sends[output.link].push(at);
    this.actors.push({
      marker: {
        id: this.nextActor++,
        requestId,
        connectionIndex: output.link,
        progress: 0,
        direction: "request",
        failed: false,
        phase: "request",
      },
      node: output.to,
      hops,
      started: at,
      ready: at + NETWORK_SECONDS,
      phase: "request",
      parent: reply ? parent : null,
      children: 0,
      reply,
      failed: false,
    });
    return true;
  }

  /** Dispatch dependencies after processing, retaining a caller until all synchronous children finish. */
  private forward(actor: Actor, at: number): void {
    const outputs = this.outputs[actor.node];
    if (actor.hops >= 32) {
      this.state.rejected++;
      actor.failed = true;
      this.finish(actor, at);
      return;
    }
    if (this.types[actor.node] === "cache") {
      // Accumulate misses instead of sampling randomness: at 90%, the first nine hit and the tenth misses.
      const credit =
        this.cacheMissCredit[actor.node] +
        100 -
        (this.design.instances[actor.node].cacheHitPercent ??
          DEFAULT_CACHE_HIT_PERCENT);
      if (credit < 100 - 1e-9) {
        this.cacheMissCredit[actor.node] = credit;
        this.finish(actor, at);
        return;
      }
      this.cacheMissCredit[actor.node] = Math.max(0, credit - 100);
      if (!outputs.length) {
        this.state.rejected++;
        actor.failed = true;
        this.finish(actor, at);
        return;
      }
    }
    actor.phase = "waiting";
    actor.ready = Infinity;
    const single = ["load-balancer", "branch"].includes(this.types[actor.node]);
    const start =
      single && outputs.length ? this.turns[actor.node]++ % outputs.length : 0;
    const count = single ? Math.min(1, outputs.length) : outputs.length;
    for (let i = 0; i < count; i++) {
      const output = outputs[start + i];
      if (
        !this.spawn(output, actor.marker.requestId, actor.hops + 1, at, actor)
      )
        actor.failed = true;
      else if (this.replies[output.link]) actor.children++;
    }
    if (!actor.children) this.finish(actor, at);
  }

  /** A finished call returns on the same logical link, or completes a detached one-way delivery. */
  private finish(actor: Actor, at: number): void {
    if (!actor.reply) {
      this.settle(actor, at);
      return;
    }
    actor.phase = "response";
    actor.marker.direction = "response";
    actor.marker.failed = actor.failed;
    actor.started = at;
    actor.ready = at + NETWORK_SECONDS;
    this.returns[actor.marker.connectionIndex].push(at);
  }

  /** Response arrival releases a caller exactly once; returning traffic never re-enters service capacity. */
  private settle(actor: Actor, at: number): void {
    this.actors.splice(this.actors.indexOf(actor), 1);
    const parent = actor.parent;
    if (parent) {
      parent.children--;
      parent.failed ||= actor.failed;
      if (!parent.children) this.finish(parent, at);
    } else if (!actor.failed) this.state.completed++;
    if (!parent && actor.hops === 1)
      this.outcome(actor.marker.requestId, at, actor.failed);
  }

  /** Only the original caller produces an outcome: dependency/async branch counts cannot bias SLOs. */
  private outcome(requestId: number, at: number, failed: boolean): void {
    const started = this.rootStarts.get(requestId)!;
    this.rootStarts.delete(requestId);
    this.outcomes.push({ at, latencyMs: (at - started) * 1000, failed });
    this.metricsChanged = true;
    this.measure(at);
  }

  /** Nearest-rank percentiles over completed root calls in the last 30s; no samples is unknown, not zero. */
  private measure(at: number): void {
    let changed = this.metricsChanged;
    while (this.outcomes.length && this.outcomes[0].at <= at - 30 + 1e-9) {
      this.outcomes.shift();
      changed = true;
    }
    if (!changed) return;
    this.metricsChanged = false;
    const values = this.outcomes
      .map((sample) => sample.latencyMs)
      .sort((a, b) => a - b);
    const samples = values.length;
    const metrics = this.state.metrics;
    metrics.samples = samples;
    metrics.p95Ms = samples ? values[Math.ceil(samples * 0.95) - 1] : null;
    metrics.p99Ms = samples ? values[Math.ceil(samples * 0.99) - 1] : null;
    metrics.errorRate = samples
      ? this.outcomes.filter((sample) => sample.failed).length / samples
      : null;
    const breaches = (["p95Ms", "p99Ms", "errorRate"] as const).filter(
      (key) =>
        metrics[key] !== null &&
        metrics[key]! > this.limits[key] + (key === "errorRate" ? 0 : 1e-6),
    );
    if (!this.state.crash && breaches.length)
      this.state.crash = { at, breaches };
  }

  /** Expire real one-second measurement windows and expose only travelling request/response markers. */
  private refresh(): SimulationSnapshot {
    const cutoff = this.state.time - 1 + 1e-9;
    this.measure(this.state.time);
    for (const service of this.services) {
      if (!service) continue;
      while (service.arrivals.length && service.arrivals[0] <= cutoff)
        service.arrivals.shift();
      while (service.admissions.length && service.admissions[0] <= cutoff)
        service.admissions.shift();
      Object.assign(service.load, {
        incomingRps: service.arrivals.length,
        acceptedRps: service.admissions.length,
        queued: service.queue.length,
        utilization: service.queue.length
          ? 1
          : Math.min(1, service.admissions.length / service.load.capacityRps),
      });
    }
    for (const flow of this.state.flows) {
      const sends = this.sends[flow.index],
        returns = this.returns[flow.index];
      while (sends.length && sends[0] <= cutoff) sends.shift();
      while (returns.length && returns[0] <= cutoff) returns.shift();
      flow.rateRps = sends.length;
      flow.responseRps = returns.length;
    }
    this.state.requests = this.actors.flatMap((actor) => {
      if (actor.phase === "waiting") return [];
      actor.marker.phase = actor.phase;
      actor.marker.progress = Math.max(
        0,
        actor.phase === "queued" || actor.phase === "processing"
          ? 1
          : Math.min(1, (this.state.time - actor.started) / NETWORK_SECONDS),
      );
      return [actor.marker];
    });
    return this.state;
  }
}
