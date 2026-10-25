import type { Design } from "./design";

/**
 * Resize the logical target containing instanceId to 1–10 members without
 * mutating the applied document. Keep the first member as the stable endpoint;
 * removed members' external links move there, while self/duplicate links drop.
 * New members share presentation, not invented network connections. Explicit
 * cluster IDs preserve other selections when a cluster declaration disappears.
 */
export function resizeReplicas(
  design: Design,
  instanceId: string,
  count: number,
): Design {
  if (!Number.isInteger(count) || count < 1 || count > 10)
    throw new Error("Replica count must be an integer from 1 to 10.");
  const original = design.instances.find(
    (instance) => instance.id === instanceId,
  );
  if (!original) throw new Error(`Unknown instance: ${instanceId}`);
  const clusters = design.clusters.map((cluster, index) => ({
    ...cluster,
    id: cluster.id ?? `cluster-${index + 1}`,
  }));
  const cluster = clusters.find((item) => item.instances.includes(instanceId));
  const members = cluster?.instances ?? [instanceId];
  if (members.length === count) return design;
  const primary = design.instances.find(
    (instance) => instance.id === members[0],
  )!;
  const kept = members.slice(0, count);
  const removed = new Set(members.slice(count));
  const instances = design.instances.filter(
    (instance) => !removed.has(instance.id),
  );
  const used = new Set(instances.map((instance) => instance.id));
  for (let suffix = 2; kept.length < count; suffix++) {
    const id = `${primary.id.slice(0, 80)}-replica-${suffix}`;
    if (used.has(id)) continue;
    used.add(id);
    instances.push({ ...primary, id });
    kept.push(id);
  }
  const seen = new Set<string>();
  const connections = design.connections.flatMap((link) => {
    const from = removed.has(link.from) ? primary.id : link.from;
    const to = removed.has(link.to) ? primary.id : link.to;
    const key = JSON.stringify([from, to, link.relation]);
    if (from === to || seen.has(key)) return [];
    seen.add(key);
    return [{ ...link, from, to }];
  });
  if (count === 1) {
    if (cluster) {
      const index = instances.findIndex(
        (instance) => instance.id === primary.id,
      );
      instances[index] = {
        ...primary,
        ...(cluster.label ? { label: cluster.label } : {}),
        ...(cluster.description ? { description: cluster.description } : {}),
      };
      clusters.splice(clusters.indexOf(cluster), 1);
    }
  } else if (cluster) {
    cluster.instances = kept;
  } else {
    const ids = new Set(clusters.map((item) => item.id));
    let suffix = 1;
    while (ids.has(`replicas-${suffix}`)) suffix++;
    clusters.push({
      id: `replicas-${suffix}`,
      label: primary.label ?? primary.id,
      ...(primary.description ? { description: primary.description } : {}),
      instances: kept,
    });
  }
  return { ...design, instances, connections, clusters };
}
