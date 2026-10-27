import type { DesignInstance, PlacedInstance, OutputPort } from "./design";
import { inferInstanceType } from "./layout";

/** Typed visual workflow edges, not external integrations. Responses are data, never a browser → database connection. */
const TARGETS: Readonly<
  Record<PlacedInstance["type"], readonly PlacedInstance["type"][]>
> = {
  users: ["webpage"],
  webpage: ["compute-server", "cdn", "object-storage", "load-balancer"],
  "compute-server": [
    "compute-server",
    "load-balancer",
    "database-rack",
    "cache",
    "message-queue",
    "object-storage",
    "media-worker",
  ],
  "database-rack": ["database-rack", "compute-server", "cache"],
  cache: ["cache", "database-rack", "object-storage"],
  cdn: ["cdn", "compute-server", "cache", "object-storage", "load-balancer"],
  "load-balancer": ["compute-server"],
  "message-queue": ["media-worker"],
  "media-worker": ["object-storage", "database-rack", "cache", "message-queue"],
  "object-storage": [
    "object-storage",
    "message-queue",
    "database-rack",
    "cdn",
    "compute-server",
  ],
  branch: [
    "compute-server",
    "load-balancer",
    "database-rack",
    "cache",
    "message-queue",
    "object-storage",
    "media-worker",
    "cdn",
    "branch",
    "merge",
  ],
  merge: [
    "compute-server",
    "load-balancer",
    "database-rack",
    "cache",
    "message-queue",
    "object-storage",
    "media-worker",
    "cdn",
    "branch",
    "merge",
  ],
};

/** Canonical product identity; generic products stay unspecified, not a different database vendor. */
function product(instance: DesignInstance): string {
  return instance.provider?.trim().toLowerCase() ?? "";
}

const NORMAL_OUTPUTS: readonly OutputPort[] = ["out"];
const BRANCH_OUTPUTS: readonly OutputPort[] = ["true", "false"];
/** Explicit branch ports prevent label prose from changing execution. */
export function outputPorts(instance: DesignInstance): readonly OutputPort[] {
  return inferInstanceType(instance.id) === "branch"
    ? BRANCH_OUTPUTS
    : NORMAL_OUTPUTS;
}

/** Explain an invalid directed relationship. A null result permits this pair regardless of label prose. */
export function connectionIssue(
  from: DesignInstance,
  to: DesignInstance,
  outlet: OutputPort = "out",
): string | null {
  const source = inferInstanceType(from.id),
    target = inferInstanceType(to.id);
  if (!outputPorts(from).includes(outlet))
    return `${source} requires a valid ${outputPorts(from).join(" / ")} output port.`;
  const workflowTarget =
    (target === "branch" || target === "merge") &&
    source !== "message-queue" &&
    source !== "users";
  if (!workflowTarget && !TARGETS[source].includes(target))
    return `${source} cannot connect to ${target}. Choose a compatible destination.`;
  if (source === "database-rack" && target === source) {
    if (product(from) === "sqlite" || product(to) === "sqlite")
      return "SQLite cannot connect as a server replica.";
    if (product(from) && product(to) && product(from) !== product(to))
      return "Different database products cannot connect as replicas.";
  }
  return null;
}

/** Queue handoffs and same-store replication are one-way; interactive service calls return responses. */
export function hasResponse(from: DesignInstance, to: DesignInstance): boolean {
  const source = inferInstanceType(from.id),
    target = inferInstanceType(to.id);
  return (
    source !== "message-queue" &&
    target !== "message-queue" &&
    !(source === target && (source === "database-rack" || source === "cache"))
  );
}

/** Only machines with a meaningful scaling mechanism expose the replica stepper. Queues and buckets name logical services. */
export function replicaIssue(instance: DesignInstance): string | null {
  const type = inferInstanceType(instance.id);
  if (type === "database-rack" && product(instance) === "sqlite")
    return "SQLite does not support server replicas.";
  if (
    type === "compute-server" ||
    type === "media-worker" ||
    type === "database-rack" ||
    type === "cache"
  )
    return null;
  return `${type} is a logical service or client and does not support machine replicas.`;
}

/** A replica group must contain compatible machines, never a mixed architecture disguised as replicas. */
export function replicaGroupIssue(
  members: readonly DesignInstance[],
): string | null {
  if (members.length < 2) return null;
  const first = members[0];
  for (const member of members) {
    const issue = replicaIssue(member);
    if (issue) return issue;
    if (
      inferInstanceType(member.id) !== inferInstanceType(first.id) ||
      product(member) !== product(first)
    )
      return "Replica groups must use the same component type and provider.";
  }
  return null;
}
