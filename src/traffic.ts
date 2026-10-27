import type { Design, DesignInstance, PlacedInstance } from "./design";
import { inferInstanceType } from "./layout";

/** Illustrative service budgets, not measurements or cloud-provider guarantees. */
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

/** Current offered/accepted throughput and saturation for one capacity-limited node. */
export interface NodeLoad {
  id: string;
  capacityRps: number;
  incomingRps: number;
  acceptedRps: number;
  rejectedRps: number;
  utilization: number;
}

/** Clients and routing fittings have no service budget and never get a meter. */
export function capacityRps(instance: DesignInstance): number | null {
  const budget = CAPACITY[inferInstanceType(instance.id)];
  return budget === undefined ? null : (instance.capacityRps ?? budget);
}

/**
 * A deterministic request-rate pipeline: one hop per sample, no per-request actors.
 * Saturated services reject excess work before forwarding. Balancers and branches
 * divide traffic over wired outputs; other services fan out to every dependency.
 * Branch predicates/merge synchronization are annotations, not payload execution.
 * Cohorts expire after 32 hops so cycles cannot retain traffic forever after stop.
 * Storage/queues use throughput budgets, not byte limits or persistent backlogs.
 */
export class TrafficModel {
  private readonly nodes: readonly DesignInstance[];
  private readonly types: readonly PlacedInstance["type"][];
  private readonly outputs: number[][];
  private readonly sources: number[];
  private readonly loads: NodeLoad[];
  private readonly byNode: (NodeLoad | null)[];
  private pending: Float64Array;
  private next: Float64Array;
  private readonly hops = 32;

  constructor(design: Design) {
    this.nodes = design.instances;
    this.types = this.nodes.map((node) => inferInstanceType(node.id));
    this.outputs = this.nodes.map(() => []);
    const indices = new Map(this.nodes.map((node, index) => [node.id, index]));
    const incoming = new Uint16Array(this.nodes.length);
    for (const link of design.connections) {
      const from = indices.get(link.from),
        to = indices.get(link.to);
      if (from === undefined || to === undefined) continue;
      this.outputs[from].push(to);
      incoming[to]++;
    }
    this.sources = this.nodes.flatMap((_, i) =>
      this.types[i] === "webpage" ? [i] : [],
    );
    if (!this.sources.length)
      this.sources.push(
        ...this.nodes.flatMap((_, i) => (incoming[i] === 0 ? [i] : [])),
      );
    this.byNode = this.nodes.map((node) => {
      const capacity = capacityRps(node);
      return capacity === null
        ? null
        : {
            id: node.id,
            capacityRps: capacity,
            incomingRps: 0,
            acceptedRps: 0,
            rejectedRps: 0,
            utilization: 0,
          };
    });
    this.loads = this.byNode.filter((load): load is NodeLoad => load !== null);
    this.pending = new Float64Array(this.hops * this.nodes.length);
    this.next = new Float64Array(this.pending.length);
  }

  /** Borrow the current stable records; the next step mutates them in place. */
  snapshot(): readonly NodeLoad[] {
    return this.loads;
  }

  /** Advance one sample at a nonnegative total ingress rate, measured in requests/s. */
  step(rateRps: number): readonly NodeLoad[] {
    if (!Number.isFinite(rateRps) || rateRps < 0)
      throw new Error("Traffic rate must be finite and nonnegative.");
    const count = this.nodes.length;
    this.next.fill(0);
    for (const index of this.sources)
      this.pending[index] += rateRps / this.sources.length;
    for (let index = 0; index < count; index++) {
      let incoming = 0;
      for (let hop = 0; hop < this.hops; hop++)
        incoming += this.pending[hop * count + index];
      const load = this.byNode[index];
      const accepted = load ? Math.min(incoming, load.capacityRps) : incoming;
      if (load) {
        load.incomingRps = incoming;
        load.acceptedRps = accepted;
        load.rejectedRps = incoming - accepted;
        load.utilization = incoming / load.capacityRps;
      }
      const outputs = this.outputs[index];
      if (!incoming || !outputs.length) continue;
      const split =
        this.types[index] === "load-balancer" || this.types[index] === "branch";
      const fraction = accepted / incoming / (split ? outputs.length : 1);
      for (let hop = 0; hop < this.hops - 1; hop++) {
        const forwarded = this.pending[hop * count + index] * fraction;
        if (!forwarded) continue;
        for (const destination of outputs)
          this.next[(hop + 1) * count + destination] += forwarded;
      }
    }
    const previous = this.pending;
    this.pending = this.next;
    this.next = previous;
    return this.loads;
  }
}
