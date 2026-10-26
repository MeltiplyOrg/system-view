import { expect, test } from "vite-plus/test";
import { parseDesign } from "../src/design";
import { FlowSimulation } from "../src/flow-simulation";
import { connectComponents } from "../src/construction";
import { mediaExample } from "../src/media-example";
import { resizeReplicas } from "../src/replicas";

/** Public simulator behavior: arbitrary user data and actual wired branches, not a predetermined media path. */
test("executes only the chosen branch and exposes each node's input/output", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Conditional",
      instances: [
        "web-start",
        {
          id: "branch-type",
          condition: {
            field: "media.type",
            operator: "equals",
            value: "video",
          },
        },
        "compute-video",
        "compute-image",
      ],
      connections: [
        { from: "web-start", to: "branch-type" },
        { from: "branch-type", to: "compute-video", outlet: "true" },
        { from: "branch-type", to: "compute-image", outlet: "false" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  const id = sim.start("web-start", { media: { type: "video" } });
  sim.advance(5000);
  const run = sim.runs.find((item) => item.id === id)!;
  expect(run.status).toBe("complete");
  expect(run.steps.map((step) => step.nodeId)).toEqual([
    "web-start",
    "branch-type",
    "compute-video",
  ]);
  expect(run.steps[1].outlet).toBe("true");
  expect(run.steps[2].input).toEqual({ media: { type: "video" } });
  expect(run.steps[2].output).toMatchObject({
    media: { type: "video" },
    handledBy: "compute-video",
  });
  const other = sim.start("web-start", { media: { type: "image" } });
  sim.advance(5000);
  expect(sim.runs.find((item) => item.id === other)!.steps.at(-1)!.nodeId).toBe(
    "compute-image",
  );
});

test("load balances each request to one backend in round-robin order", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Balanced API",
      instances: ["web-start", "lb-entry", "compute-a", "compute-b"],
      connections: [
        { from: "web-start", to: "lb-entry" },
        { from: "lb-entry", to: "compute-a" },
        { from: "lb-entry", to: "compute-b" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  for (let request = 0; request < 4; request++) {
    sim.start("web-start", { request });
    sim.advance(2000);
  }
  expect(sim.runs.map((run) => run.status)).toEqual([
    "complete",
    "complete",
    "complete",
    "complete",
  ]);
  expect(sim.runs.map((run) => run.outputs)).toEqual([
    [{ request: 0, balancedBy: "lb-entry", handledBy: "compute-a" }],
    [{ request: 1, balancedBy: "lb-entry", handledBy: "compute-b" }],
    [{ request: 2, balancedBy: "lb-entry", handledBy: "compute-a" }],
    [{ request: 3, balancedBy: "lb-entry", handledBy: "compute-b" }],
  ]);
  expect(sim.activity(sim.runs[3].id).wires).toEqual(
    new Set(["web-start->lb-entry", "lb-entry->compute-b"]),
  );
});

test("balances physical pool members without duplicating pool wires or stealing a busy backend's slot", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Balanced pools",
      instances: [
        "lb-pool",
        { id: "compute-a", latencyMs: 3000 },
        { id: "compute-b", latencyMs: 100 },
        "compute-c",
      ],
      clusters: [{ instances: ["compute-a", "compute-b"] }],
      connections: [
        { from: "lb-pool", to: "compute-a" },
        { from: "lb-pool", to: "compute-b" },
        { from: "lb-pool", to: "compute-c" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  for (let request = 0; request < 6; request++) {
    sim.start("lb-pool", { request });
    sim.advance(6000);
  }
  expect(
    sim.runs.flatMap((run) => run.outputs.map((out) => out.handledBy)),
  ).toEqual([
    "compute-a",
    "compute-b",
    "compute-c",
    "compute-a",
    "compute-b",
    "compute-c",
  ]);
  sim.start("lb-pool", { request: "burst" }, 4);
  sim.advance(1000);
  expect(sim.runs.slice(6).map((run) => run.status)).toEqual([
    "running",
    "complete",
    "complete",
    "waiting",
  ]);
  expect(sim.runs[9].steps.at(-1)!.instanceId).toBeUndefined();
  sim.advance(6000);
  expect(
    sim.runs.slice(6).flatMap((run) => run.outputs.map((out) => out.handledBy)),
  ).toEqual(["compute-a", "compute-b", "compute-c", "compute-a"]);
});

test("unconnected balancers stop the clock and resume after wiring without resetting other balancers", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Editable balancers",
      instances: ["lb-main", "lb-other", "compute-a", "compute-b"],
      connections: [
        { from: "lb-main", to: "compute-a" },
        { from: "lb-main", to: "compute-b" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("lb-main", {});
  sim.start("lb-other", {});
  sim.advance(1000);
  expect(sim.runs.map((run) => run.status)).toEqual(["complete", "waiting"]);
  expect(sim.hasWork).toBe(false);
  sim.updateDesign(connectComponents(design, "lb-other", "compute-a"));
  expect(sim.hasWork).toBe(true);
  sim.start("lb-main", {});
  sim.advance(2000);
  expect(sim.runs.flatMap((run) => run.outputs)).toEqual([
    { balancedBy: "lb-main", handledBy: "compute-a" },
    { balancedBy: "lb-other", handledBy: "compute-a" },
    { balancedBy: "lb-main", handledBy: "compute-b" },
  ]);
});

test("fans out and waits for both parallel inputs before executing a merge once", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Fan out",
      instances: [
        "compute-start",
        "db-record",
        "storage-object",
        "merge-results",
        "compute-response",
      ],
      connections: [
        { from: "compute-start", to: "db-record" },
        { from: "compute-start", to: "storage-object" },
        { from: "db-record", to: "merge-results" },
        { from: "storage-object", to: "merge-results" },
        { from: "merge-results", to: "compute-response" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("compute-start", { request: "parallel" });
  sim.advance(1000);
  expect(sim.runs[0].status).not.toBe("complete");
  sim.advance(2000);
  expect(sim.runs[0].status).toBe("complete");
  const responses = sim.runs[0].steps.filter(
    (step) => step.nodeId === "compute-response",
  );
  expect(responses).toHaveLength(1);
  expect(responses[0].input.branches).toEqual([
    {
      from: "db-record->merge-results",
      data: {
        request: "parallel",
        handledBy: "compute-start",
        persistedBy: "db-record",
      },
    },
    {
      from: "storage-object->merge-results",
      data: {
        request: "parallel",
        handledBy: "compute-start",
        storedBy: "storage-object",
      },
    },
  ]);
});

test("queues requests behind real consumer capacity and drains faster after worker scaling", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Jobs",
      instances: [
        "queue-jobs",
        { id: "worker-encode", latencyMs: 2000 },
        "storage-output",
      ],
      connections: [
        { from: "queue-jobs", to: "worker-encode" },
        { from: "worker-encode", to: "storage-output" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("queue-jobs", { mediaType: "video" }, 3);
  sim.advance(400);
  expect(sim.stats.queued).toBe(2);
  expect(
    sim.runs[0].steps.find((step) => step.nodeId === "worker-encode")!.state,
  ).toBe("running");
  sim.updateDesign(resizeReplicas(design, "worker-encode", 3));
  sim.advance(400);
  expect(sim.stats.queued).toBe(0);
  const consumers = sim.runs.flatMap((run) =>
    run.steps
      .filter((step) => step.nodeId === "worker-encode")
      .map((step) => step.instanceId),
  );
  expect(new Set(consumers).size).toBe(3);
  sim.advance(4000);
  expect(sim.runs.map((run) => run.status)).toEqual([
    "complete",
    "complete",
    "complete",
  ]);
});

test("does not warm a cache from a request blocked before its origin flow completes", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Cache",
      instances: [
        "cdn-edge",
        {
          id: "branch-cache",
          condition: { field: "cache", operator: "equals", value: "miss" },
        },
        "compute-hit",
      ],
      connections: [
        { from: "cdn-edge", to: "branch-cache" },
        { from: "branch-cache", to: "compute-hit", outlet: "false" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("cdn-edge", { assetId: "asset-a" });
  sim.advance(2000);
  expect(sim.runs[0].status).toBe("waiting");
  sim.start("cdn-edge", { assetId: "asset-a" });
  sim.advance(2000);
  expect(sim.stats.cacheMisses).toBe(2);
  expect(sim.stats.cacheHits).toBe(0);
  const repaired = connectComponents(
    { ...design, instances: [...design.instances, { id: "storage-origin" }] },
    "branch-cache",
    "storage-origin",
    "",
    "true",
  );
  sim.updateDesign(repaired);
  sim.advance(2000);
  expect(sim.runs[0].status).toBe("complete");
  sim.start("cdn-edge", { assetId: "asset-a" });
  sim.advance(2000);
  expect(sim.stats.cacheHits).toBe(1);
  expect(sim.runs[2].steps.at(-1)!.nodeId).toBe("compute-hit");
});

test("the editable media app routes upload types, joins parallel work, and bypasses origin after a completed playback", () => {
  const sim = new FlowSimulation(parseDesign(JSON.stringify(mediaExample)));
  sim.start("web-media", {
    action: "upload",
    mediaType: "video",
    assetId: "demo",
  });
  sim.start("web-media", {
    action: "upload",
    mediaType: "image",
    assetId: "image",
  });
  sim.advance(20000);
  expect(sim.runs.map((run) => run.status)).toEqual(["complete", "complete"]);
  expect(
    sim.runs[0].steps.some((step) => step.nodeId === "worker-encoder"),
  ).toBe(true);
  expect(
    sim.runs[1].steps.some((step) => step.nodeId === "worker-encoder"),
  ).toBe(false);
  expect(sim.runs[1].outputs[0]).toMatchObject({ persistedBy: "db-media" });
  sim.start("web-media", { action: "play", assetId: "demo" });
  sim.advance(3000);
  expect(
    sim.runs[2].steps.some((step) => step.nodeId === "storage-delivery"),
  ).toBe(true);
  sim.start("web-media", { action: "play", assetId: "demo" });
  sim.advance(3000);
  expect(
    sim.runs[3].steps.some((step) => step.nodeId === "storage-delivery"),
  ).toBe(false);
  expect(sim.runs[3].outputs[0]).toMatchObject({
    cache: "hit",
    servedBy: "cdn-media",
  });
});

test("cycles terminate every branch and release consumers instead of growing work forever", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Cycle",
      instances: [
        { id: "compute-a", latencyMs: 100 },
        { id: "compute-b", latencyMs: 100 },
        { id: "worker-long", latencyMs: 30000 },
      ],
      connections: [
        { from: "compute-a", to: "compute-b" },
        { from: "compute-b", to: "compute-a" },
        { from: "compute-a", to: "worker-long" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("compute-a", {});
  sim.advance(30000);
  expect(sim.runs[0].status).toBe("failed");
  expect(sim.runs[0].error).toMatch(/limit/);
  expect(sim.hasWork).toBe(false);
  expect(sim.runs[0].steps.length).toBeLessThanOrEqual(128);
  sim.start("worker-long", {});
  sim.advance(31000);
  expect(sim.runs[1].status).toBe("complete");
});

test("rejects oversized/invalid batches atomically and does not borrow mutable caller data", () => {
  const design = parseDesign(
    JSON.stringify({ version: 1, name: "Data", instances: ["compute-api"] }),
  );
  const sim = new FlowSimulation(design);
  const input = { body: { title: "Original" } };
  sim.start("compute-api", input);
  input.body.title = "Changed outside the run";
  sim.advance(1000);
  expect(sim.runs[0].outputs[0]).toMatchObject({ body: { title: "Original" } });
  for (const data of [{ invalid: Infinity }, { text: "x".repeat(8193) }])
    expect(() => sim.start("compute-api", data)).toThrow();
  for (const count of [0, 11, NaN, 1.5])
    expect(() => sim.start("compute-api", {}, count)).toThrow();
  expect(() => sim.start("missing", {})).toThrow(/entry/);
  expect(() => sim.advance(Infinity)).toThrow(/Advance/);
  expect(sim.runs).toHaveLength(1);
});

test("world activity keeps waiting work visible after another request finishes the same node", () => {
  const sim = new FlowSimulation(mediaExample);
  const video = sim.start("web-media", {
    action: "upload",
    mediaType: "video",
  });
  sim.start("web-media", { action: "upload", mediaType: "image" });
  sim.advance(5000);
  expect(sim.runs[1].status).toBe("complete");
  expect(sim.activity().nodes.get("merge-upload")).toBe("waiting");
  const trace = sim.activity(video);
  expect(trace.nodes.get("worker-encoder")).toBe("running");
  expect(trace.wires.has("branch-media->compute-image")).toBe(false);
  expect(trace.wires.has("branch-media->queue-encoding")).toBe(true);
});

test("replica internals are not request cycles and equivalent pool wires do not duplicate calls", () => {
  const design = parseDesign(
    JSON.stringify({
      version: 1,
      name: "Replica pool",
      instances: ["compute-api", "db-primary", "db-read"],
      clusters: [{ instances: ["db-primary", "db-read"] }],
      connections: [
        { from: "compute-api", to: "db-primary" },
        { from: "compute-api", to: "db-read" },
        { from: "db-primary", to: "db-read", relation: "replicates" },
      ],
    }),
  );
  const sim = new FlowSimulation(design);
  sim.start("compute-api", { path: "/catalogue" });
  sim.advance(3000);
  expect(sim.runs[0].status).toBe("complete");
  expect(sim.runs[0].steps.map((step) => step.nodeId)).toEqual([
    "compute-api",
    "db-primary",
  ]);
  expect(sim.runs[0].outputs).toHaveLength(1);
});

test("conditions keep scalar types and missing fields distinct without reading prototypes", () => {
  const cases = [
    {
      field: "size",
      operator: "greater-than",
      value: 10,
      data: { size: 20 },
      outlet: "true",
    },
    {
      field: "size",
      operator: "greater-than",
      value: 10,
      data: { size: "20" },
      outlet: "false",
    },
    {
      field: "mime",
      operator: "contains",
      value: "video",
      data: { mime: "video/mp4" },
      outlet: "true",
    },
    {
      field: "missing",
      operator: "not-equals",
      value: null,
      data: {},
      outlet: "true",
    },
    {
      field: "constructor.name",
      operator: "equals",
      value: "Object",
      data: {},
      outlet: "false",
    },
    {
      field: "value",
      operator: "equals",
      value: null,
      data: { value: null },
      outlet: "true",
    },
  ];
  for (const item of cases) {
    const design = parseDesign(
      JSON.stringify({
        version: 1,
        name: "Condition",
        instances: [
          {
            id: "branch-test",
            condition: {
              field: item.field,
              operator: item.operator,
              value: item.value,
            },
          },
          "compute-yes",
          "compute-no",
        ],
        connections: [
          { from: "branch-test", to: "compute-yes", outlet: "true" },
          { from: "branch-test", to: "compute-no", outlet: "false" },
        ],
      }),
    );
    const sim = new FlowSimulation(design);
    sim.start("branch-test", item.data);
    sim.advance(1000);
    expect(sim.runs[0].steps[0].outlet).toBe(item.outlet);
    expect(sim.runs[0].status).toBe("complete");
  }
});
