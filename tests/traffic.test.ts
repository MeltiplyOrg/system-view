import { describe, expect, test } from "vite-plus/test";
import { parseDesign, type Design } from "../src/design";
import { TrafficModel, capacityRps } from "../src/traffic";

/** Model designs use explicit budgets so examples test throughput, not incidental default values. */
function design(
  instances: Design["instances"],
  connections: Design["connections"],
): Design {
  return {
    version: 1,
    name: "Capacity exercise",
    instances,
    connections,
    clusters: [],
  };
}

/** Settle a small graph's pipeline without depending on browser clocks. */
function settle(model: TrafficModel, rate: number, steps = 8) {
  for (let tick = 0; tick < steps; tick++) model.step(rate);
  return model.snapshot();
}

describe("request capacity", () => {
  test("rejects overload before forwarding and recovers when demand drops", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "web-entry" },
          { id: "compute-api", capacityRps: 100 },
          { id: "db-data", capacityRps: 200 },
        ],
        [
          { from: "web-entry", to: "compute-api" },
          { from: "compute-api", to: "db-data" },
        ],
      ),
    );
    settle(model, 150);
    expect(
      model.snapshot().find((node) => node.id === "compute-api"),
    ).toMatchObject({
      incomingRps: 150,
      acceptedRps: 100,
      rejectedRps: 50,
      utilization: 1.5,
    });
    expect(
      model.snapshot().find((node) => node.id === "db-data"),
    ).toMatchObject({
      incomingRps: 100,
      acceptedRps: 100,
      rejectedRps: 0,
      utilization: 0.5,
    });
    settle(model, 20);
    expect(
      model.snapshot().find((node) => node.id === "compute-api"),
    ).toMatchObject({
      incomingRps: 20,
      rejectedRps: 0,
      utilization: 0.2,
    });
    settle(model, 0);
    expect(model.snapshot().every((node) => node.incomingRps === 0)).toBe(true);
  });

  test("load balancing spreads demand while downstream dependencies receive accepted work", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "web-entry" },
          { id: "lb-entry", capacityRps: 1000 },
          { id: "compute-one", capacityRps: 100 },
          { id: "compute-two", capacityRps: 100 },
          { id: "db-shared", capacityRps: 1000 },
          { id: "cache-disconnected", capacityRps: 100 },
        ],
        [
          { from: "web-entry", to: "lb-entry" },
          { from: "lb-entry", to: "compute-one" },
          { from: "lb-entry", to: "compute-two" },
          { from: "compute-one", to: "db-shared" },
          { from: "compute-two", to: "db-shared" },
        ],
      ),
    );
    settle(model, 160);
    expect(
      model.snapshot().find((node) => node.id === "compute-one")?.incomingRps,
    ).toBe(80);
    expect(
      model.snapshot().find((node) => node.id === "compute-two")?.incomingRps,
    ).toBe(80);
    expect(
      model.snapshot().find((node) => node.id === "db-shared")?.incomingRps,
    ).toBe(160);
    expect(
      model.snapshot().find((node) => node.id === "cache-disconnected")
        ?.incomingRps,
    ).toBe(0);
  });

  test("a single total ingress budget is shared by clients, not multiplied per client", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "web-one" },
          { id: "web-two" },
          { id: "compute-api", capacityRps: 1000 },
        ],
        [
          { from: "web-one", to: "compute-api" },
          { from: "web-two", to: "compute-api" },
        ],
      ),
    );
    settle(model, 120);
    expect(model.snapshot()[0].incomingRps).toBe(120);
  });

  test("cycles have finite lifetimes and cannot retain stopped traffic forever", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "web-entry" },
          { id: "compute-a", capacityRps: 1000 },
          { id: "compute-b", capacityRps: 1000 },
        ],
        [
          { from: "web-entry", to: "compute-a" },
          { from: "compute-a", to: "compute-b" },
          { from: "compute-b", to: "compute-a" },
        ],
      ),
    );
    settle(model, 10, 40);
    expect(
      model.snapshot().find((node) => node.id === "compute-a")!.incomingRps,
    ).toBeGreaterThan(10);
    settle(model, 0, 40);
    expect(model.snapshot().every((node) => node.incomingRps === 0)).toBe(true);
  });

  test("without clients ingress enters graph roots while rootless cycles stay idle", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "compute-root", capacityRps: 100 },
          { id: "db-next", capacityRps: 100 },
          { id: "compute-cycle-a", capacityRps: 100 },
          { id: "compute-cycle-b", capacityRps: 100 },
        ],
        [
          { from: "compute-root", to: "db-next" },
          { from: "compute-cycle-a", to: "compute-cycle-b" },
          { from: "compute-cycle-b", to: "compute-cycle-a" },
        ],
      ),
    );
    settle(model, 40);
    expect(
      model.snapshot().find((node) => node.id === "compute-root")?.incomingRps,
    ).toBe(40);
    expect(
      model.snapshot().find((node) => node.id === "db-next")?.incomingRps,
    ).toBe(40);
    expect(
      model.snapshot().find((node) => node.id === "compute-cycle-a")
        ?.incomingRps,
    ).toBe(0);
    for (const rate of [-1, NaN, Infinity])
      expect(() => model.step(rate)).toThrow(/nonnegative/);
    expect(
      model.snapshot().find((node) => node.id === "db-next")?.incomingRps,
    ).toBe(40);
  });

  test("conditional rate splits converge without multiplying the original ingress", () => {
    const model = new TrafficModel(
      design(
        [
          { id: "web-entry" },
          { id: "branch-route" },
          { id: "compute-a", capacityRps: 100 },
          { id: "compute-b", capacityRps: 100 },
          { id: "merge-results" },
          { id: "db-final", capacityRps: 1000 },
        ],
        [
          { from: "web-entry", to: "branch-route" },
          { from: "branch-route", to: "compute-a", outlet: "true" },
          { from: "branch-route", to: "compute-b", outlet: "false" },
          { from: "compute-a", to: "merge-results" },
          { from: "compute-b", to: "merge-results" },
          { from: "merge-results", to: "db-final" },
        ],
      ),
    );
    settle(model, 80);
    expect(
      model.snapshot().find((node) => node.id === "compute-a")?.incomingRps,
    ).toBe(40);
    expect(
      model.snapshot().find((node) => node.id === "compute-b")?.incomingRps,
    ).toBe(40);
    expect(
      model.snapshot().find((node) => node.id === "db-final")?.incomingRps,
    ).toBe(80);
  });

  test("capacity budgets round-trip and cannot be attached to non-service nodes", () => {
    const valid = design([{ id: "compute-api", capacityRps: 250 }], []);
    expect(parseDesign(JSON.stringify(valid)).instances[0].capacityRps).toBe(
      250,
    );
    for (const value of [0, -1, 1_000_001, "100"]) {
      expect(() =>
        parseDesign(
          JSON.stringify(
            design([{ id: "compute-api", capacityRps: value as number }], []),
          ),
        ),
      ).toThrow(/capacityRps/);
    }
    for (const id of ["web-entry", "branch-check", "merge-result"]) {
      expect(capacityRps({ id })).toBeNull();
      expect(() =>
        parseDesign(JSON.stringify(design([{ id, capacityRps: 100 }], []))),
      ).toThrow(/capacityRps/);
    }
  });
});
