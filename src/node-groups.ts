import {
  MAX_WORLD_COORDINATE,
  parseDesign,
  type Design,
  type GroundPoint,
} from "./design";

/** Expand selection to whole replica pools without treating mixed organizational groups as replicas. */
export function nodeGroupMembers(
  design: Design,
  ids: Iterable<string>,
): string[] {
  const selected = new Set(ids);
  for (const id of selected)
    if (!design.instances.some((node) => node.id === id))
      throw new Error(`Unknown group member: ${id}`);
  for (const cluster of design.clusters)
    if (cluster.instances.some((id) => selected.has(id)))
      for (const id of cluster.instances) selected.add(id);
  return design.instances
    .filter((node) => selected.has(node.id))
    .map((node) => node.id);
}

/** Create/update a named container and transfer selected members from their previous containers. Sites and wires never change. */
export function saveNodeGroup(
  design: Design,
  ids: Iterable<string>,
  label: string,
  groupId?: string,
): Design {
  if (groupId && !design.groups?.some((group) => group.id === groupId))
    throw new Error(`Unknown node group: ${groupId}`);
  const members = nodeGroupMembers(design, ids);
  if (members.length < (groupId ? 1 : 2))
    throw new Error(
      groupId
        ? "Select at least one node."
        : "Select at least two nodes to create a group.",
    );
  const groups = design.groups ?? [];
  let suffix = 1;
  while (groups.some((group) => group.id === `group-${suffix}`)) suffix++;
  const id = groupId ?? `group-${suffix}`;
  const selected = new Set(members);
  const next = groups.flatMap((group) => {
    if (group.id === id)
      return [{ ...group, label: label.trim(), instances: members }];
    const kept = group.instances.filter((member) => !selected.has(member));
    return kept.length ? [{ ...group, instances: kept }] : [];
  });
  if (!groupId) next.push({ id, label: label.trim(), instances: members });
  return parseDesign(JSON.stringify({ ...design, groups: next }));
}

/** Ungroup never deletes nodes, connections, replica pools or authored positions. */
export function ungroupNodes(design: Design, groupId: string): Design {
  if (!design.groups?.some((group) => group.id === groupId))
    throw new Error(`Unknown node group: ${groupId}`);
  return {
    ...design,
    groups: design.groups.filter((group) => group.id !== groupId),
  };
}

/** Translate pinned group sites by one shared, bounded delta; clamping preserves all relative spacing. */
export function moveNodeGroup(
  design: Design,
  groupId: string,
  delta: GroundPoint,
): Design {
  const group = design.groups?.find((group) => group.id === groupId);
  if (!group) throw new Error(`Unknown node group: ${groupId}`);
  if (![delta.x, delta.y].every(Number.isFinite))
    throw new Error("Group movement must be finite.");
  const members = new Set(group.instances);
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const node of design.instances) {
    if (!members.has(node.id)) continue;
    if (!node.placement)
      throw new Error("Pin node positions before moving a group.");
    minX = Math.max(minX, -MAX_WORLD_COORDINATE - node.placement.x);
    maxX = Math.min(maxX, MAX_WORLD_COORDINATE - node.placement.x);
    minY = Math.max(minY, -MAX_WORLD_COORDINATE - node.placement.y);
    maxY = Math.min(maxY, MAX_WORLD_COORDINATE - node.placement.y);
  }
  const x = Math.max(minX, Math.min(maxX, delta.x)),
    y = Math.max(minY, Math.min(maxY, delta.y));
  return {
    ...design,
    instances: design.instances.map((node) =>
      members.has(node.id)
        ? {
            ...node,
            placement: { x: node.placement!.x + x, y: node.placement!.y + y },
          }
        : node,
    ),
  };
}
