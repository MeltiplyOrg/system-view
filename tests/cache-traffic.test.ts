import { expect, test } from "vite-plus/test";
import { parseDesign, type Design } from "../src/design";
import { TrafficModel } from "../src/traffic";

/** Zero processing isolates cache decisions and real wire journeys from service saturation. */
function cacheSystem(percent: number): Design {
  return {
    version: 1,
    name: "Read-through cache",
    clusters: [],
    instances: [
      { id: "users-readers", trafficRps: 10 },
      { id: "web-client", latencyMs: 0 },
      { id: "compute-api", latencyMs: 0, capacityRps: 100 },
      {
        id: "cache-data",
        latencyMs: 0,
        capacityRps: 100,
        cacheHitPercent: percent,
      },
      { id: "db-origin", latencyMs: 0, capacityRps: 100 },
    ],
    connections: [
      { from: "users-readers", to: "web-client" },
      { from: "web-client", to: "compute-api" },
      { from: "compute-api", to: "cache-data" },
      { from: "cache-data", to: "db-origin" },
    ],
  };
}

/** Observe actual origin-bound identities, never a rounded flow-rate estimate or mock hit count. */
function originRequests(percent: number, dt: number): number[] {
  const model = new TrafficModel(cacheSystem(percent));
  const ids = new Set<number>();
  for (let at = 0; at < 2.6 - 1e-9; at += dt) {
    const state = model.step(Math.min(dt, 2.6 - at));
    for (const request of state.requests)
      if (
        request.connectionIndex === 3 &&
        request.direction === "request" &&
        request.requestId <= 20
      )
        ids.add(request.requestId);
    expect(state.crash).toBeNull();
  }
  expect(model.snapshot().metrics.samples).toBe(model.snapshot().completed);
  return [...ids].sort((a, b) => a - b);
}

test("90% cache coverage serves nine requests and sends every tenth identity to the origin", () => {
  expect(originRequests(90, 0.001)).toEqual([10, 20]);
});

test("cache coverage boundaries and fractional settings preserve individual requests", () => {
  expect(originRequests(100, 0.001)).toEqual([]);
  expect(originRequests(0, 0.001)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  expect(originRequests(87.5, 0.001)).toEqual([8, 16]);
});

test("a hit returns from cache while a miss waits for the origin response", () => {
  const model = new TrafficModel(cacheSystem(90));
  const phases = new Map<number, Set<string>>();
  for (let tick = 0; tick < 1500; tick++) {
    const state = model.step(0.001);
    for (const request of state.requests) {
      if (request.requestId > 10) continue;
      const seen = phases.get(request.requestId) ?? new Set<string>();
      seen.add(`${request.connectionIndex}:${request.direction}`);
      phases.set(request.requestId, seen);
    }
  }
  expect(phases.get(9)).toContain("2:response");
  expect(phases.get(9)).not.toContain("3:request");
  expect(phases.get(10)).toContain("3:request");
  expect(phases.get(10)).toContain("2:response");
});

test("an unconnected cache cannot fulfill a miss but can serve a hit", () => {
  for (const percent of [0, 100]) {
    const design = cacheSystem(percent);
    design.connections.pop();
    const model = new TrafficModel(design);
    for (let i = 0; i < 60; i++) model.step(0.01);
    expect(model.snapshot().rejected > 0).toBe(percent === 0);
    expect(
      model.snapshot().crash?.breaches.includes("errorRate") ?? false,
    ).toBe(percent === 0);
    expect(model.snapshot().completed > 0).toBe(percent === 100);
  }
});

test("cache percentage round-trips only on caches and rejects invalid percentages", () => {
  const design = cacheSystem(90);
  for (const node of design.instances) delete node.latencyMs;
  expect(parseDesign(JSON.stringify(design)).instances[3].cacheHitPercent).toBe(
    90,
  );
  for (const invalid of [-1, 100.1, "90", null]) {
    const json = JSON.parse(JSON.stringify(design));
    json.instances[3].cacheHitPercent = invalid;
    expect(() => parseDesign(JSON.stringify(json))).toThrow(/cacheHitPercent/);
  }
  const wrongNode = JSON.parse(JSON.stringify(design));
  wrongNode.instances[2].cacheHitPercent = 90;
  expect(() => parseDesign(JSON.stringify(wrongNode))).toThrow(/only.*cache/i);
});
