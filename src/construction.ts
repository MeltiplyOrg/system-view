import type { Design, GroundPoint, PlacedInstance, OutputPort } from "./design";
import { MAX_INSTANCES, MAX_CONNECTIONS, MAX_WORLD_COORDINATE } from "./design";
import { instanceFootprint, layoutDesign } from "./layout";
import { providersFor } from "./providers";
import { connectionIssue } from "./component-rules";

/** Fine construction grid: three build cells fit one 120-unit world grid cell. */
export const BUILD_GRID = 40;

/** A trusted catalogue entry, not a second document format. */
export interface BuildItem {
  id: string;
  type: PlacedInstance["type"];
  prefix: string;
  label: string;
  description: string;
  provider?: string;
}

/** Base products and every compatible registered skin share the normal renderer. */
export const BUILD_TYPES: readonly BuildItem[] = [
  {
    id: "users",
    prefix: "users",
    type: "users",
    label: "Users",
    description:
      "Generate individual requests. Set traffic in the Users detail HUD and wire to a frontend.",
  },
  {
    id: "compute",
    prefix: "compute",
    type: "compute-server",
    label: "Compute server",
    description: "Run services, APIs and application workloads.",
  },
  {
    id: "web",
    prefix: "web",
    type: "webpage",
    label: "Web frontend",
    description: "The browser-facing entry to your system.",
  },
  {
    id: "database",
    prefix: "db",
    type: "database-rack",
    label: "Database",
    description: "Persist application data and replicated state.",
  },
  {
    id: "cache",
    prefix: "cache",
    type: "cache",
    label: "Cache",
    description: "Keep frequently accessed data close to your services.",
  },
  {
    id: "cdn",
    prefix: "cdn",
    type: "cdn",
    label: "CDN edge",
    description: "Deliver cached assets from the edge to your clients.",
  },
  {
    id: "load-balancer",
    prefix: "lb",
    type: "load-balancer",
    label: "Load balancer",
    description: "Distribute each request to one backend in round-robin order.",
  },
  {
    id: "queue",
    prefix: "queue",
    type: "message-queue",
    label: "Message queue",
    description: "Buffer jobs until a processing worker can accept them.",
  },
  {
    id: "storage",
    prefix: "storage",
    type: "object-storage",
    label: "Object storage",
    description: "Keep original uploads and published media objects.",
  },
  {
    id: "worker",
    prefix: "worker",
    type: "media-worker",
    label: "Media worker",
    description: "Consume queued jobs and encode playable media.",
  },
  {
    id: "branch",
    prefix: "branch",
    type: "branch",
    label: "If / Else",
    description: "A compact wire junction with explicit true and false routes.",
  },
  {
    id: "merge",
    prefix: "merge",
    type: "merge",
    label: "Merge",
    description: "A compact wire junction for converging parallel routes.",
  },
];
export const BUILD_ITEMS: readonly BuildItem[] = BUILD_TYPES.flatMap((item) => [
  item,
  ...providersFor(item.type).map((provider) => ({
    ...item,
    id: `${item.id}-${provider.id}`,
    label: provider.label,
    provider: provider.id,
  })),
]);

/** Snap a finite ground coordinate, rejecting values the document cannot retain. */
export function snapPlacement(point: GroundPoint): GroundPoint {
  if (
    ![point.x, point.y].every(
      (value) =>
        Number.isFinite(value) && Math.abs(value) <= MAX_WORLD_COORDINATE,
    )
  )
    throw new Error("Placement is outside the buildable world.");
  return {
    x: Math.round(point.x / BUILD_GRID) * BUILD_GRID || 0,
    y: Math.round(point.y / BUILD_GRID) * BUILD_GRID || 0,
  };
}

/** Ground footprints, not screen-space tower overlap, determine whether a site is free. */
export function canPlace(
  item: BuildItem,
  point: GroundPoint,
  instances: readonly PlacedInstance[],
): boolean {
  const foot = instanceFootprint(item.type, item.provider);
  return instances.every((instance) => {
    const other = instanceFootprint(instance.type, instance.provider);
    return (
      Math.abs(point.x - instance.position.x) >=
        foot.halfWidth + other.halfWidth + 12 ||
      Math.abs(point.y - instance.position.y) >=
        foot.halfDepth + other.halfDepth + 12
    );
  });
}

/** Freeze the current world before edits so deleting or regrouping never repacks neighbours. */
export function pinWorld(
  design: Design,
  instances: readonly PlacedInstance[],
): Design {
  const positions = new Map(
    instances.map((instance) => [instance.id, instance.position]),
  );
  return {
    ...design,
    instances: design.instances.map((instance) => {
      const point = positions.get(instance.id)!;
      return { ...instance, placement: { x: point.x, y: point.y } };
    }),
  };
}

/** Add one catalogue product at an explicit site; preserve the caller's document and stable IDs. */
export function placeComponent(
  design: Design,
  item: BuildItem,
  point: GroundPoint,
): Design {
  if (design.instances.length >= MAX_INSTANCES)
    throw new Error(`A world supports at most ${MAX_INSTANCES} components.`);
  const placement = snapPlacement(point);
  if (!canPlace(item, placement, layoutDesign(design).instances))
    throw new Error("Site occupied. Choose clear ground for this component.");
  const used = new Set(design.instances.map((instance) => instance.id));
  let suffix = 1;
  while (used.has(`${item.prefix}-${suffix}`)) suffix++;
  const id = `${item.prefix}-${suffix}`;
  return {
    ...design,
    instances: [
      ...design.instances,
      {
        id,
        label: `${item.label} ${suffix}`,
        placement,
        ...(item.provider ? { provider: item.provider } : {}),
      },
    ],
  };
}

/** Add a directed wire once; reverse wires are independent, duplicate pairs and self-links are errors. */
export function connectComponents(
  design: Design,
  from: string,
  to: string,
  relation = "",
  outlet: OutputPort = "out",
): Design {
  if (from === to)
    throw new Error("Choose a different component to finish the wire.");
  const ids = new Set(design.instances.map((instance) => instance.id));
  if (!ids.has(from) || !ids.has(to))
    throw new Error("Choose two components in this world.");
  const issue = connectionIssue(
    design.instances.find((item) => item.id === from)!,
    design.instances.find((item) => item.id === to)!,
    outlet,
  );
  if (issue) throw new Error(issue);
  if (
    design.connections.some(
      (link) =>
        link.from === from &&
        link.to === to &&
        (link.outlet ?? "out") === outlet,
    )
  )
    throw new Error(
      "These components are already connected in that direction.",
    );
  if (design.connections.length >= MAX_CONNECTIONS)
    throw new Error(`A world supports at most ${MAX_CONNECTIONS} wires.`);
  const label = relation.trim();
  if (label.length > 100)
    throw new Error("Wire labels must be at most 100 characters.");
  const used = new Set(
    design.connections.map((link) => link.id ?? `${link.from}->${link.to}`),
  );
  let suffix = 1;
  while (used.has(`wire-${suffix}`)) suffix++;
  return {
    ...design,
    connections: [
      ...design.connections,
      {
        id: `wire-${suffix}`,
        from,
        to,
        ...(outlet === "out" ? {} : { outlet }),
        ...(label
          ? { relation: label }
          : outlet !== "out"
            ? { relation: outlet.toUpperCase() }
            : {}),
      },
    ],
  };
}

/** Cut exactly one document wire, preserving parallel outlets, nodes, groups and their sites. */
export function disconnectComponents(design: Design, index: number): Design {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= design.connections.length
  )
    throw new Error("This wire no longer exists.");
  return {
    ...design,
    connections: design.connections.filter((_, position) => position !== index),
  };
}

/** Remove a component and its incident wires; dissolve groups reduced below two members. */
export function removeComponent(design: Design, id: string): Design {
  return {
    ...design,
    instances: design.instances.filter((instance) => instance.id !== id),
    connections: design.connections.filter(
      (link) => link.from !== id && link.to !== id,
    ),
    clusters: design.clusters.flatMap((cluster) => {
      if (!cluster.instances.includes(id)) return [cluster];
      const instances = cluster.instances.filter((member) => member !== id);
      return instances.length > 1 ? [{ ...cluster, instances }] : [];
    }),
    ...(design.groups
      ? {
          groups: design.groups.flatMap((group) => {
            const instances = group.instances.filter((member) => member !== id);
            return instances.length ? [{ ...group, instances }] : [];
          }),
        }
      : {}),
  };
}
