import { expect, test } from "vite-plus/test";
import { parseDesign, type Design } from "../src/design";
import { layoutDesign } from "../src/layout";
import { pinWorld, removeComponent } from "../src/construction";
import { resizeReplicas } from "../src/replicas";
import {
  moveNodeGroup,
  nodeGroupMembers,
  saveNodeGroup,
  ungroupNodes,
} from "../src/node-groups";

/** Mixed types and a separate replica pool catch accidental reuse of replication semantics. */
function world(): Design {
  return parseDesign(
    JSON.stringify({
      version: 1,
      name: "Groups",
      instances: [
        { id: "web-client", placement: { x: -400, y: 0 } },
        { id: "compute-api", placement: { x: 0, y: 0 } },
        { id: "db-a", placement: { x: 400, y: 0 } },
        { id: "db-b", placement: { x: 400, y: 200 } },
        { id: "branch-route", placement: { x: -200, y: 0 } },
      ],
      connections: [
        { from: "web-client", to: "compute-api" },
        { from: "compute-api", to: "db-a" },
      ],
      clusters: [{ id: "data", instances: ["db-a", "db-b"] }],
    }),
  );
}

test("grouping mixed nodes preserves layout, individual wire endpoints, replica pools and immutable input", () => {
  const original = world();
  const grouped = saveNodeGroup(
    original,
    ["web-client", "db-b", "branch-route"],
    " Media pipeline ",
  );
  expect(grouped.groups).toEqual([
    {
      id: "group-1",
      label: "Media pipeline",
      instances: ["web-client", "db-a", "db-b", "branch-route"],
    },
  ]);
  expect(grouped.connections).toEqual(original.connections);
  expect(grouped.clusters).toEqual(original.clusters);
  expect(layoutDesign(grouped)).toEqual(layoutDesign(original));
  expect(original.groups).toBeUndefined();
  expect(parseDesign(JSON.stringify(grouped))).toEqual(grouped);
  expect(nodeGroupMembers(original, ["db-a", "db-a"])).toEqual([
    "db-a",
    "db-b",
  ]);
});

test("renaming, membership transfers and ungrouping preserve every node and wire", () => {
  let design = saveNodeGroup(
    world(),
    ["web-client", "compute-api"],
    "Frontend",
  );
  design = saveNodeGroup(design, ["db-a", "branch-route"], "Backend");
  design = saveNodeGroup(design, ["web-client", "db-b"], "Combined", "group-1");
  expect(design.groups).toEqual([
    {
      id: "group-1",
      label: "Combined",
      instances: ["web-client", "db-a", "db-b"],
    },
    { id: "group-2", label: "Backend", instances: ["branch-route"] },
  ]);
  design = saveNodeGroup(design, ["compute-api", "branch-route"], "Processing");
  expect(design.groups!.map((g) => g.id)).toEqual(["group-1", "group-3"]);
  const ungrouped = ungroupNodes(design, "group-1");
  expect(ungrouped.instances).toEqual(design.instances);
  expect(ungrouped.connections).toEqual(design.connections);
  expect(ungrouped.groups!.map((g) => g.id)).toEqual(["group-3"]);
  expect(() => ungroupNodes(design, "missing")).toThrow("Unknown node group");
  expect(() => saveNodeGroup(design, ["web-client"], "Bad", "missing")).toThrow(
    "Unknown node group",
  );
  expect(() => saveNodeGroup(world(), ["web-client"], "Bad")).toThrow(
    "two nodes",
  );
  expect(() => saveNodeGroup(design, [], "Bad", "group-1")).toThrow("one node");
  expect(() =>
    saveNodeGroup(world(), ["missing", "web-client"], "Bad"),
  ).toThrow("Unknown group member");
  expect(() =>
    saveNodeGroup(world(), ["web-client", "compute-api"], " "),
  ).toThrow("label");
});

test("moving a group clamps one shared delta at the world boundary without distorting spacing or moving outsiders", () => {
  const original = saveNodeGroup(world(), ["compute-api", "db-a"], "Services");
  const moved = moveNodeGroup(original, "group-1", { x: 99999, y: -99999 });
  expect(moved.instances.map((n) => n.placement)).toEqual([
    { x: -400, y: 0 },
    { x: 99600, y: -99999 },
    { x: 100000, y: -99999 },
    { x: 100000, y: -99799 },
    { x: -200, y: 0 },
  ]);
  expect(
    moveNodeGroup(original, "group-1", { x: -999999, y: 999999 }).instances[3]
      .placement,
  ).toEqual({ x: -99600, y: 100000 });
  expect(original.instances[1].placement).toEqual({ x: 0, y: 0 });
  expect(moved.connections).toBe(original.connections);
  expect(() => moveNodeGroup(original, "missing", { x: 0, y: 0 })).toThrow(
    "Unknown node group",
  );
  expect(() => moveNodeGroup(original, "group-1", { x: NaN, y: 0 })).toThrow(
    "finite",
  );
  const automatic = {
    ...original,
    instances: original.instances.map(({ placement: _p, ...node }) => node),
  };
  expect(() => moveNodeGroup(automatic, "group-1", { x: 1, y: 1 })).toThrow(
    "Pin",
  );
  expect(
    moveNodeGroup(
      pinWorld(automatic, layoutDesign(automatic).instances),
      "group-1",
      { x: 40, y: 40 },
    ).groups,
  ).toEqual(original.groups);
});

test("scaling and deleting grouped nodes maintains valid organization without turning it into a replica pool", () => {
  let design = saveNodeGroup(world(), ["web-client", "compute-api"], "App");
  design = resizeReplicas(design, "compute-api", 3);
  expect(design.groups![0].instances).toEqual([
    "web-client",
    "compute-api",
    "compute-api-replica-2",
    "compute-api-replica-3",
  ]);
  expect(parseDesign(JSON.stringify(design))).toEqual(design);
  design = resizeReplicas(design, "compute-api", 1);
  expect(design.groups![0].instances).toEqual(["web-client", "compute-api"]);
  design = removeComponent(design, "web-client");
  expect(design.groups![0].instances).toEqual(["compute-api"]);
  design = removeComponent(design, "compute-api");
  expect(design.groups).toEqual([]);
  expect(parseDesign(JSON.stringify(design))).toEqual(design);
});

test("imports reject ambiguous, unsafe or split-pool group membership atomically", () => {
  const original = world();
  const cases: unknown[] = [
    null,
    {},
    Array.from({ length: 65 }, () => ({})),
    [{}],
    [{ id: "g", label: "G", instances: [] }],
    [{ id: "g", label: "G", instances: ["missing"] }],
    [{ id: "g", label: "G", instances: ["web-client", "web-client"] }],
    [
      { id: "g", label: "G", instances: ["web-client"] },
      { id: "g", label: "G", instances: ["compute-api"] },
    ],
    [
      { id: "g", label: "G", instances: ["web-client"] },
      { id: "h", label: "H", instances: ["web-client"] },
    ],
    [{ id: "g", label: "G", instances: ["db-a"] }],
    [
      { id: "g", label: "G", instances: ["db-a"] },
      { id: "h", label: "H", instances: ["db-b"] },
    ],
  ];
  for (const groups of cases)
    expect(() =>
      parseDesign(JSON.stringify({ ...original, groups })),
    ).toThrow();
  expect(original.groups).toBeUndefined();
});
