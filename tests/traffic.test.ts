import { describe, expect, test } from "vite-plus/test";
import { parseDesign, type Design } from "../src/design";
import { TrafficModel, capacityRps } from "../src/traffic";
import { hasResponse } from "../src/component-rules";

/** Explicit source and service settings make a single request's journey observable. */
function chain(rate = 1): Design {
  return {
    version: 1,
    name: "Request journey",
    instances: [
      { id: "users-source", trafficRps: rate },
      { id: "web-client", latencyMs: 100 },
      { id: "compute-api", capacityRps: 8, latencyMs: 100 },
      { id: "db-data", capacityRps: 4, latencyMs: 100 },
    ],
    connections: [
      { from: "users-source", to: "web-client" },
      { from: "web-client", to: "compute-api" },
      { from: "compute-api", to: "db-data" },
    ],
    clusters: [],
  };
}

/** Advance in bounded frames, as the app does, and return an immutable observation. */
function advance(model: TrafficModel, seconds: number) {
  for (let time = 0; time < seconds - 1e-8; time += 0.05)
    model.step(Math.min(0.05, seconds - time));
  return structuredClone(model.snapshot());
}

/** Advance to an exact simulated instant in 1ms frames, resolving 10ms hops. */
function atTime(model: TrafficModel, seconds: number) {
  for (let time = model.snapshot().time; time < seconds - 1e-9; time += 0.001)
    model.step(Math.min(0.001, seconds - time));
  return structuredClone(model.snapshot());
}

describe("individual requests", () => {
  test("one request travels Users → Frontend → Backend → Database in order", () => {
    const model = new TrafficModel(chain());
    const flying = atTime(model, 1.15);
    expect(flying.generated).toBe(1);
    expect(flying.requests).toHaveLength(1);
    expect(flying.requests[0]).toMatchObject({
      requestId: 1,
      connectionIndex: 0,
    });
    expect(flying.requests[0].progress).toBeGreaterThan(0);
    expect(flying.requests[0].progress).toBeLessThan(1);
    expect(atTime(model, 1.35).requests[0]).toMatchObject({
      connectionIndex: 0,
      phase: "processing",
    });
    expect(atTime(model, 1.55).requests[0]).toMatchObject({
      connectionIndex: 1,
      direction: "request",
    });
    expect(atTime(model, 1.75).requests[0]).toMatchObject({
      connectionIndex: 1,
      phase: "processing",
    });
    expect(atTime(model, 1.95).requests[0]).toMatchObject({
      connectionIndex: 2,
      direction: "request",
    });
    expect(atTime(model, 2.15).requests[0]).toMatchObject({
      connectionIndex: 2,
      phase: "processing",
    });
    const databaseReply = atTime(model, 2.35);
    expect(
      databaseReply.requests.find((packet) => packet.requestId === 1),
    ).toMatchObject({ connectionIndex: 2, direction: "response" });
    expect(databaseReply.completed).toBe(0);
    expect(atTime(model, 2.65).requests[0]).toMatchObject({
      connectionIndex: 1,
      direction: "response",
    });
    expect(atTime(model, 2.95).requests[0]).toMatchObject({
      connectionIndex: 0,
      direction: "response",
    });
    const delivered = atTime(model, 3.15);
    expect(delivered.requests.some((packet) => packet.requestId === 1)).toBe(
      false,
    );
    expect(delivered.completed).toBe(1);
    expect(delivered.metrics.p95Ms).toBeCloseTo(2100, 6);
  });

  test("traffic comes only from Users and zero-rate sources stay silent", () => {
    const silent = new TrafficModel(chain(0));
    expect(advance(silent, 5).generated).toBe(0);
    const sourceFree = chain();
    sourceFree.instances.shift();
    sourceFree.connections.shift();
    expect(advance(new TrafficModel(sourceFree), 5).requests).toEqual([]);
  });

  test("each source retains its own traffic setting independent of frame size", () => {
    const design = chain(2);
    design.instances.push({ id: "users-second", trafficRps: 1 });
    design.connections.push({ from: "users-second", to: "web-client" });
    const small = new TrafficModel(design),
      large = new TrafficModel(design);
    const a = advance(small, 3.25);
    for (let i = 0; i < 13; i++) large.step(0.25);
    const b = large.snapshot();
    expect(a.generated).toBe(9);
    expect(b.generated).toBe(a.generated);
    expect(
      b.requests.map((packet) => [packet.requestId, packet.connectionIndex]),
    ).toEqual(
      a.requests.map((packet) => [packet.requestId, packet.connectionIndex]),
    );
    for (let i = 0; i < b.requests.length; i++)
      expect(b.requests[i].progress).toBeCloseTo(a.requests[i].progress, 7);
  });

  test("saturated nodes stay at 100% and queue excess arrivals instead of rejecting them", () => {
    const design = chain(10);
    design.instances[2].capacityRps = 1;
    const model = new TrafficModel(design);
    const loaded = advance(model, 4);
    expect(loaded.rejected).toBe(0);
    const backend = loaded.loads.find((load) => load.id === "compute-api")!;
    expect(backend.queued).toBeGreaterThan(0);
    expect(backend.utilization).toBe(1);
    expect(
      loaded.loads.every(
        (load) => load.utilization >= 0 && load.utilization <= 1,
      ),
    ).toBe(true);
    expect(loaded.flows[2].rateRps).toBeLessThanOrEqual(2);
    expect(
      loaded.requests.every(
        (packet) => packet.progress >= 0 && packet.progress <= 1,
      ),
    ).toBe(true);
    const paused = structuredClone(model.snapshot());
    expect(model.snapshot()).toEqual(paused);
    const reset = new TrafficModel(design).snapshot();
    expect(reset.generated).toBe(0);
    expect(reset.requests).toEqual([]);
  });

  test("FIFO waiting requests resume in arrival order when processing budget becomes available", () => {
    const design = chain(4);
    design.instances[2].capacityRps = 1;
    const model = new TrafficModel(design, {
      p95Ms: 60_000,
      p99Ms: 60_000,
      errorRate: 1,
    });
    const waiting = atTime(model, 1.8);
    expect(
      waiting.loads.find((load) => load.id === "compute-api")?.queued,
    ).toBe(3);
    expect(
      waiting.requests.find((packet) => packet.requestId === 2),
    ).toMatchObject({ phase: "queued", progress: 1 });
    const resumed = atTime(model, 2.06);
    expect(
      resumed.requests.find((packet) => packet.requestId === 2),
    ).toMatchObject({ connectionIndex: 2, direction: "request" });
    expect(
      resumed.requests.some(
        (packet) => packet.requestId === 3 && packet.connectionIndex === 2,
      ),
    ).toBe(false);
    const next = atTime(model, 3.06);
    expect(
      next.requests.find((packet) => packet.requestId === 3),
    ).toMatchObject({ connectionIndex: 2, direction: "request" });
    expect(next.rejected).toBe(0);
  });

  test("a load balancer sends each request to one backend, not both", () => {
    const design = chain(2);
    design.instances = [
      { id: "users-source", trafficRps: 2 },
      { id: "web-client" },
      { id: "lb-router" },
      { id: "compute-a" },
      { id: "compute-b" },
    ];
    design.connections = [
      { from: "users-source", to: "web-client" },
      { from: "web-client", to: "lb-router" },
      { from: "lb-router", to: "compute-a" },
      { from: "lb-router", to: "compute-b" },
    ];
    const loaded = advance(new TrafficModel(design), 4);
    const ids = loaded.requests.map((packet) => packet.requestId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(loaded.flows[2].rateRps).toBe(1);
    expect(loaded.flows[3].rateRps).toBe(1);
  });

  test("request lifetime and actor limits bound cyclic or exploding designs", () => {
    const design = chain(0.05);
    design.connections.push({ from: "db-data", to: "compute-api" });
    const state = advance(new TrafficModel(design), 60);
    expect(state.rejected).toBeGreaterThan(0);
    expect(state.requests.length).toBeLessThanOrEqual(512);
    const many = chain(20);
    many.instances = [
      { id: "users-source", trafficRps: 20 },
      { id: "web-client" },
      ...Array.from({ length: 300 }, (_, i) => ({ id: `compute-${i}` })),
    ];
    many.connections = [
      { from: "users-source", to: "web-client" },
      ...many.instances
        .slice(2)
        .map((node) => ({ from: "web-client", to: node.id })),
    ];
    const bounded = advance(new TrafficModel(many), 4);
    expect(bounded.limited).toBeGreaterThan(0);
    expect(bounded.requests.length).toBeLessThanOrEqual(512);
  });

  test("newly placed Users emit real requests, while invalid time cannot advance them", () => {
    const design = chain();
    delete design.instances[0].trafficRps;
    const model = new TrafficModel(design);
    expect(advance(model, 1.02).requests[0]).toMatchObject({
      requestId: 1,
      connectionIndex: 0,
    });
    const before = structuredClone(model.snapshot());
    for (const dt of [-1, NaN, Infinity, 2])
      expect(() => model.step(dt)).toThrow(/Simulation step/);
    expect(model.snapshot()).toEqual(before);
    model.step(0);
    expect(model.snapshot()).toEqual(before);
  });

  test("Run begins with real traffic immediately and processing stays visible without changing simulated latency", () => {
    const model = new TrafficModel(chain());
    expect(model.begin().requests[0]).toMatchObject({
      requestId: 1,
      progress: 0,
      phase: "request",
    });
    expect(model.snapshot().time).toBe(1);
    expect(advance(model, 0.1).requests[0]).toMatchObject({
      requestId: 1,
      phase: "request",
    });
    const completed = advance(model, 2.2);
    expect(completed.completed).toBe(1);
    expect(completed.metrics.p95Ms).toBeCloseTo(2100, 6);
    expect(completed.generated).toBe(3);
    expect(new TrafficModel(chain(0)).begin().generated).toBe(0);
  });

  test("an error-rate breach crashes the system and freezes it until reset", () => {
    const design = chain(2);
    design.connections = [];
    const model = new TrafficModel(design);
    const state = advance(model, 2);
    expect(state.generated).toBe(1);
    expect(state.completed).toBe(0);
    expect(state.rejected).toBe(1);
    expect(state.metrics).toMatchObject({ samples: 1, errorRate: 1 });
    expect(state.crash).toEqual({ at: 0.5, breaches: ["errorRate"] });
    model.step(1);
    expect(model.snapshot()).toEqual(state);
    const reset = new TrafficModel(design).snapshot();
    expect(reset.crash).toBeNull();
    expect(reset.metrics.samples).toBe(0);
  });

  test("one-way queue deliveries never invent return traffic and do not hold the HTTP response", () => {
    const design = chain();
    design.instances[3] = { id: "queue-jobs" };
    design.instances.push({ id: "worker-job" });
    design.connections[2] = { from: "compute-api", to: "queue-jobs" };
    design.connections.push({ from: "queue-jobs", to: "worker-job" });
    const model = new TrafficModel(design);
    let sawDelivery = false,
      sawHttpResponse = false;
    for (let i = 0; i < 3000; i++) {
      const state = model.step(0.002);
      for (const packet of state.requests) {
        if (packet.connectionIndex >= 2) {
          sawDelivery = true;
          expect(packet.direction).toBe("request");
        }
        if (
          packet.requestId === 1 &&
          packet.connectionIndex === 1 &&
          packet.direction === "response"
        )
          sawHttpResponse = true;
      }
    }
    expect(sawDelivery).toBe(true);
    expect(sawHttpResponse).toBe(true);
    expect(model.snapshot().flows[2].responseRps).toBe(0);
    expect(model.snapshot().flows[3].responseRps).toBe(0);
  });

  test("fan-out waits for every dependency response before replying upstream", () => {
    const design = chain();
    design.instances[3].latencyMs = 500;
    design.instances.push({ id: "cache-fast", latencyMs: 100 });
    design.connections.push({ from: "compute-api", to: "cache-fast" });
    const model = new TrafficModel(design);
    const waiting = atTime(model, 2.8);
    expect(
      waiting.requests.filter(
        (packet) =>
          packet.requestId === 1 &&
          packet.direction === "response" &&
          packet.connectionIndex === 1,
      ),
    ).toHaveLength(0);
    const replied = atTime(model, 3.05);
    expect(
      replied.requests.find((packet) => packet.requestId === 1),
    ).toMatchObject({ connectionIndex: 1, direction: "response" });
  });

  test("latency percentiles include real FIFO waiting and count root responses once", () => {
    const design = chain(2);
    design.instances[2].capacityRps = 1;
    const model = new TrafficModel(design, {
      p95Ms: 60_000,
      p99Ms: 60_000,
      errorRate: 1,
    });
    const state = advance(model, 22);
    expect(state.metrics.samples).toBe(20);
    expect(state.metrics.p95Ms).toBeCloseTo(11_100, 5);
    expect(state.metrics.p99Ms).toBeCloseTo(11_600, 5);
    expect(state.metrics.errorRate).toBe(0);
  });

  test.each(["p95Ms", "p99Ms"] as const)(
    "%s independently crashes only after a completed call exceeds its limit",
    (key) => {
      const limits = {
        p95Ms: 60_000,
        p99Ms: 60_000,
        errorRate: 1,
        [key]: 2_099,
      };
      const model = new TrafficModel(chain(), limits);
      expect(advance(model, 3.05).crash).toBeNull();
      const crashed = advance(model, 0.1);
      expect(crashed.crash?.breaches).toEqual([key]);
      expect(crashed.crash?.at).toBeCloseTo(3.1, 8);
      expect(model.step(0.5)).toEqual(crashed);
      const boundary = advance(
        new TrafficModel(chain(), { p95Ms: 2_100, p99Ms: 2_100, errorRate: 0 }),
        3.2,
      );
      expect(boundary.crash).toBeNull();
    },
  );

  test("error rate counts root outcomes, not dependency branches or generated calls still pending", () => {
    const design = chain();
    design.instances.push({ id: "users-unwired", trafficRps: 1 });
    const state = advance(
      new TrafficModel(design, { p95Ms: 60_000, p99Ms: 60_000, errorRate: 1 }),
      3.15,
    );
    expect(state.metrics.samples).toBe(4);
    expect(state.metrics.errorRate).toBe(3 / 4);
    expect(state.metrics.p95Ms).toBeCloseTo(2100, 6);
  });

  test("rolling metrics expire old outcomes and report unknown until a response completes", () => {
    const model = new TrafficModel(chain(0.01));
    expect(model.snapshot().metrics).toEqual({
      p95Ms: null,
      p99Ms: null,
      errorRate: null,
      samples: 0,
    });
    expect(advance(model, 107).metrics.samples).toBe(1);
    expect(advance(model, 31).metrics).toEqual({
      p95Ms: null,
      p99Ms: null,
      errorRate: null,
      samples: 0,
    });
  });

  test("invalid crash limits cannot silently disable threshold detection", () => {
    for (const limits of [
      { p95Ms: 0, p99Ms: 1, errorRate: 0 },
      { p95Ms: 1, p99Ms: Infinity, errorRate: 0 },
      { p95Ms: 1, p99Ms: 1, errorRate: NaN },
      { p95Ms: 1, p99Ms: 1, errorRate: -0.1 },
      { p95Ms: 1, p99Ms: 1, errorRate: 1.1 },
    ])
      expect(() => new TrafficModel(chain(), limits)).toThrow(/Crash limits/);
  });

  test("source rate round-trips only on Users, capacity stays on services", () => {
    expect(parseDesign(JSON.stringify(chain(3))).instances[0].trafficRps).toBe(
      3,
    );
    expect(capacityRps({ id: "users-source" })).toBeNull();
    for (const value of [-1, 21, "3"])
      expect(() =>
        parseDesign(
          JSON.stringify({
            ...chain(),
            instances: [{ id: "users-source", trafficRps: value }],
          }),
        ),
      ).toThrow(/trafficRps/);
    expect(() =>
      parseDesign(
        JSON.stringify({
          ...chain(),
          instances: [{ id: "web-client", trafficRps: 1 }],
        }),
      ),
    ).toThrow(/trafficRps/);
    expect(() =>
      parseDesign(
        JSON.stringify({
          ...chain(),
          instances: [{ id: "users-source", capacityRps: 1 }],
        }),
      ),
    ).toThrow(/capacityRps/);
    for (const capacityRps of [0, -1, 1_000_001, "100"])
      expect(() =>
        parseDesign(
          JSON.stringify({
            ...chain(),
            instances: [{ id: "compute-api", capacityRps }],
          }),
        ),
      ).toThrow(/capacityRps/);
  });
  test("same-store replication is one-way but database/cache queries return responses", () => {
    expect(hasResponse({ id: "db-primary" }, { id: "db-replica" })).toBe(false);
    expect(hasResponse({ id: "cache-primary" }, { id: "cache-replica" })).toBe(
      false,
    );
    expect(hasResponse({ id: "db-primary" }, { id: "cache-primary" })).toBe(
      true,
    );
    expect(hasResponse({ id: "cache-primary" }, { id: "db-primary" })).toBe(
      true,
    );
  });
});
