import type { Cluster, PlacedInstance, Design, DesignInstance } from "./design";

/** One logical group of separate platforms, packed into rows of five. */
interface LayoutGroup {
  id: string;
  label?: string;
  instanceIds: readonly string[];
  /** True for a user-declared cluster; false for an implicit single instance. */
  caption: boolean;
}

/** Axis-aligned player-space bounds for a placed cluster. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A cluster after automatic placement. */
export interface PlacedCluster {
  id: string;
  label: string;
  bounds: Bounds;
}

/** Render-ready output of the automatic layout pass. */
export interface Layout {
  instances: PlacedInstance[];
  clusters: PlacedCluster[];
}

/**
 * Normalized render color for one component type.
 *
 * The raster cache bakes the color into shared images, so every instance of a
 * type must use the same value no matter its document position or ID alias.
 *
 * @param type - Renderer type selected by the layout pass.
 * @returns Lowercase six-digit hex suitable for `--cable-color`.
 */
export function instanceColor(type: PlacedInstance["type"]): string {
  switch (type) {
    case "database-rack":
      return "#42d9e8";
    case "compute-server":
      return "#ff9d52";
    case "webpage":
      return "#b49aff";
    case "cache":
      return "#7ee787";
  }
}

/** Renderer prefixes; unknown IDs retain the original database visual. */
const INSTANCE_TYPES: Readonly<Record<string, PlacedInstance["type"]>> = {
  db: "database-rack",
  database: "database-rack",
  rack: "database-rack",
  compute: "compute-server",
  server: "compute-server",
  api: "compute-server",
  web: "webpage",
  webpage: "webpage",
  frontend: "webpage",
  cache: "cache",
};

/**
 * Infer the renderer type from an ID's leading word.
 *
 * Database, compute/server/api, web/webpage/frontend, and cache prefixes
 * select distinct visuals. Unknown prefixes retain the database fallback so
 * existing documents with arbitrary IDs keep their appearance.
 *
 * @param id - Validated instance ID.
 * @returns The type whose renderer should draw the instance.
 */
export function inferInstanceType(id: string): PlacedInstance["type"] {
  const prefix = /^[a-z]+/i.exec(id)?.[0].toLowerCase();
  return prefix && INSTANCE_TYPES[prefix]
    ? INSTANCE_TYPES[prefix]
    : "database-rack";
}

/**
 * World-space distance between instances in one cluster.
 *
 * The 176-unit step clears the 150-unit foot depth, so every instance keeps
 * its own platform. Replicas are independent hosts: sharing a plinth would
 * draw them co-located on one machine.
 */
const RACK_SPACING = 176;

/** Overflow rows step along negative X (behind), clearing the 288-unit foot. */
const ROW_SPACING = 332;
const REPLICAS_PER_ROW = 5;

/** World-space gap between cluster columns. */
const CLUSTER_GAP = 420;

/** Half-width and half-depth of the 288 × 150 rack foot. */
export const RACK_HALF_WIDTH = 144,
  RACK_HALF_DEPTH = 75;

/**
 * Build the persisted groups in canvas order.
 *
 * A declared cluster occupies the slot of its first member in `instances`,
 * rather than moving to the front of the scene. Promoting a database to a
 * replica set therefore keeps its links pointing forward instead of forcing
 * every client to reach back past the nodes that preceded it.
 *
 * Any instance not named by a cluster becomes its own single-instance group,
 * so unrelated racks do not share a platform merely because they were declared
 * next to each other. Clusters whose members are all missing from `instances`
 * are appended last: `layoutDesign` then reports the bad reference instead of
 * silently dropping the declaration.
 */
function layoutGroups(design: Design): LayoutGroup[] {
  const clusterOf = new Map<string, number>();
  for (const [index, cluster] of design.clusters.entries()) {
    for (const instanceId of cluster.instances) {
      // First membership wins. `parseDesign` rejects overlaps, and keeping the
      // earliest slot makes unvalidated input deterministic.
      if (!clusterOf.has(instanceId)) clusterOf.set(instanceId, index);
    }
  }

  const groups: LayoutGroup[] = [];
  const emitted = new Set<number>();
  const addCluster = (index: number): void => {
    if (emitted.has(index)) return;
    emitted.add(index);
    const cluster = design.clusters[index];
    groups.push({
      id: cluster.id ?? `cluster-${index + 1}`,
      ...(cluster.label === undefined ? {} : { label: cluster.label }),
      instanceIds: cluster.instances,
      caption: true,
    });
  };

  for (const instance of design.instances) {
    const index = clusterOf.get(instance.id);
    if (index !== undefined) addCluster(index);
    else
      groups.push({
        id: `instance:${instance.id}`,
        instanceIds: [instance.id],
        caption: false,
      });
  }

  for (let index = 0; index < design.clusters.length; index++) addCluster(index);
  return groups;
}

/**
 * Derive all render-only fields from a validated design.
 *
 * Layout is deterministic: each row holds at most five members along Y at
 * 176-unit intervals. Overflow rows step backwards along negative X. Groups
 * reserve their complete footprint so a back row cannot overlap its neighbor.
 * The original row stays anchored when its group gains a back row. A cluster
 * is emitted at its first declared member's slot, so promoting an instance
 * never reorders the surrounding scene.
 * Existing positions are never read, which makes the imported document the
 * single source of truth.
 *
 * Colors are normalized per renderer type so replicas share rasterized
 * geometry; changing declaration order or cluster membership never recolors an
 * instance.
 *
 * @param design - Validated document; cluster members must reference instances.
 * @returns Placed instances and cluster bounds for captions.
 * @throws Error if a cluster references a missing instance, which indicates the
 *   caller bypassed `parseDesign`.
 */
export function layoutDesign(design: Design): Layout {
  const indexed = new Map(
    design.instances.map((instance): [string, DesignInstance] => [
      instance.id,
      instance,
    ]),
  );
  const placed: PlacedInstance[] = [];
  const clusters: PlacedCluster[] = [];
  let nextX = 0;

  for (const [groupIndex, group] of layoutGroups(design).entries()) {
    const rows = Math.ceil(group.instanceIds.length / REPLICAS_PER_ROW);
    const backWidth = Math.max(0, rows - 1) * ROW_SPACING;
    const x = nextX + (groupIndex === 0 ? 0 : backWidth);
    nextX = x + CLUSTER_GAP;
    const members = group.instanceIds.map((id) => {
      const entry = indexed.get(id);
      if (!entry)
        throw new Error(
          `Layout cluster ${group.id} references unknown instance ${id}.`,
        );
      return entry;
    });

    for (const [memberIndex, instance] of members.entries()) {
      const type = inferInstanceType(instance.id);
      placed.push({
        id: instance.id,
        type,
        label: instance.label ?? instance.id,
        position: {
          x: x - Math.floor(memberIndex / REPLICAS_PER_ROW) * ROW_SPACING,
          y: (memberIndex % REPLICAS_PER_ROW) * RACK_SPACING,
          z: 0,
        },
        color: instanceColor(type),
      });
    }

    // Only declared clusters receive a caption; an unclustered rack is a
    // one-instance layout group without a visible group name.
    if (group.caption) {
      const height =
        RACK_HALF_DEPTH * 2 +
        (Math.min(members.length, REPLICAS_PER_ROW) - 1) * RACK_SPACING;
      clusters.push({
        id: group.id,
        label: group.label ?? group.id,
        bounds: {
          x: x - backWidth - RACK_HALF_WIDTH,
          y: -RACK_HALF_DEPTH,
          width: RACK_HALF_WIDTH * 2 + backWidth,
          height,
        },
      });
    }
  }

  return { instances: placed, clusters };
}
