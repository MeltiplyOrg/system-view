import type { PlacedInstance, Design, DesignInstance } from "./design";
import { findProvider } from "./providers";
import type { ProviderFootprint } from "./providers";

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
 * Normalized render color for one component type or provider skin.
 *
 * The default palette assigns one accent per renderer type. A known provider
 * overrides it with the product's accent, which intentionally splits raster
 * sharing: each provider palette is baked into its own cached images.
 *
 * @param type - Renderer type selected by the layout pass.
 * @param provider - Optional provider key from the document.
 * @returns Lowercase six-digit hex suitable for `--cable-color`.
 */
export function instanceColor(
  type: PlacedInstance["type"],
  provider?: string,
): string {
  const theme = findProvider(provider, type);
  if (theme) return theme.color;
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

/** Half-width and half-depth of the 288 × 150 rack foot. */
export const RACK_HALF_WIDTH = 144,
  RACK_HALF_DEPTH = 75;

/**
 * Clearance between replica platforms along a cluster column.
 *
 * The historic 332-unit pitch was the 288-unit rack foot plus 44 units of
 * air. Deriving clearance from the actual footprint keeps a small provider
 * base (the Redis cache is 168 square) just as tight: a fixed 332-unit step
 * left 164 units of empty space beside every Redis replica, which made ten
 * replicas look scattered across the stage.
 */
const REPLICA_COLUMN_GAP = 44;

/**
 * Clearance between replica platforms along a cluster row.
 *
 * The historic 176-unit pitch was the 150-unit rack foot plus 26 units. A
 * provider footprint deeper than a rack therefore grows the step instead of
 * collapsing the gap between platforms.
 */
const REPLICA_ROW_GAP = 26;

/** Members per column before an overflow column starts behind it. */
const REPLICAS_PER_ROW = 5;

/**
 * Historic center-to-center pitch between adjacent groups.
 *
 * It includes a rack foot on each side, so the drawn frames (footprint plus
 * 36-unit margin) sit 60 world units apart. Group placement uses the derived
 * edge clearance below, which preserves that pitch for racks and tightens it
 * for smaller provider platforms.
 */
const CLUSTER_GAP = 420;

/** Empty space between adjacent group footprints; frames sit 60 units apart. */
const CLUSTER_CLEARANCE = CLUSTER_GAP - RACK_HALF_WIDTH * 2;

/** Half extents of one instance's ground footprint in world units. */
export type InstanceFootprint = ProviderFootprint;

/**
 * Ground footprint under one instance.
 *
 * Positions and cluster spacing still use the rack grid; this footprint only
 * changes the platform contour, the dashed node border, target bounds, and
 * routing clearance around that node. A provider declares overrides on its
 * theme, so adding one keeps platform geometry next to its palette and logo.
 *
 * @param type - Renderer type selected by the layout pass.
 * @param provider - Optional provider key from the document.
 * @returns Half extents in world units.
 */
export function instanceFootprint(
  type: PlacedInstance["type"],
  provider?: string,
): InstanceFootprint {
  const theme = findProvider(provider, type);
  return (
    theme?.footprints?.[type] ?? {
      halfWidth: RACK_HALF_WIDTH,
      halfDepth: RACK_HALF_DEPTH,
    }
  );
}

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

  for (let index = 0; index < design.clusters.length; index++)
    addCluster(index);
  return groups;
}

/**
 * Derive all render-only fields from a validated design.
 *
 * Layout is deterministic. Each column holds at most five members along Y,
 * overflow columns step backwards along negative X, and both steps are
 * derived from the cluster's largest footprint plus a fixed air gap. Groups
 * are packed from their real content edges: a back column extends away from
 * the next group, so only that next group's back width is reserved. A
 * multi-replica cluster therefore never adds phantom space to its own sides.
 * A cluster is emitted at its first declared member's slot, so promoting an
 * instance never reorders the surrounding scene. Existing positions are never
 * read, which makes the imported document the single source of truth.
 *
 * Colors are normalized per renderer type and provider skin so replicas share
 * rasterized geometry; changing declaration order or cluster membership never
 * recolors an instance.
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

  // Resolve members and extents before placing anything: the next group's
  // back-row width and the shared replica pitch both depend on footprints.
  const plans = layoutGroups(design).map((group) => {
    const members = group.instanceIds.map((id) => {
      const entry = indexed.get(id);
      if (!entry)
        throw new Error(
          `Layout cluster ${group.id} references unknown instance ${id}.`,
        );
      const type = inferInstanceType(entry.id);
      return {
        entry,
        type,
        footprint: instanceFootprint(type, entry.provider),
      };
    });
    const halfWidth = Math.max(
        0,
        ...members.map(({ footprint }) => footprint.halfWidth),
      ),
      halfDepth = Math.max(
        0,
        ...members.map(({ footprint }) => footprint.halfDepth),
      ),
      rows = Math.ceil(members.length / REPLICAS_PER_ROW),
      columnStep = halfWidth * 2 + REPLICA_COLUMN_GAP,
      rowStep = halfDepth * 2 + REPLICA_ROW_GAP;
    return {
      group,
      members,
      halfWidth,
      columnStep,
      rowStep,
      backWidth: Math.max(0, rows - 1) * columnStep,
    };
  });

  let previousX = 0,
    previousHalfWidth = 0;
  for (const [groupIndex, plan] of plans.entries()) {
    const x =
      groupIndex === 0
        ? 0
        : previousX +
          previousHalfWidth +
          CLUSTER_CLEARANCE +
          plan.backWidth +
          plan.halfWidth;
    previousX = x;
    previousHalfWidth = plan.halfWidth;

    let clusterBounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    } | null = null;
    for (const [
      memberIndex,
      { entry, type, footprint },
    ] of plan.members.entries()) {
      const px =
          x - Math.floor(memberIndex / REPLICAS_PER_ROW) * plan.columnStep,
        py = (memberIndex % REPLICAS_PER_ROW) * plan.rowStep;
      placed.push({
        id: entry.id,
        type,
        label: entry.label ?? entry.id,
        position: { x: px, y: py, z: 0 },
        color: instanceColor(type, entry.provider),
        ...(entry.provider === undefined ? {} : { provider: entry.provider }),
      });
      if (!plan.group.caption) continue;
      // The frame wraps the real footprints, which lets a provider with a
      // square platform keep a square group border.
      const left = px - footprint.halfWidth,
        right = px + footprint.halfWidth,
        top = py - footprint.halfDepth,
        bottom = py + footprint.halfDepth;
      if (!clusterBounds)
        clusterBounds = { minX: left, minY: top, maxX: right, maxY: bottom };
      else {
        clusterBounds.minX = Math.min(clusterBounds.minX, left);
        clusterBounds.minY = Math.min(clusterBounds.minY, top);
        clusterBounds.maxX = Math.max(clusterBounds.maxX, right);
        clusterBounds.maxY = Math.max(clusterBounds.maxY, bottom);
      }
    }

    // Only declared clusters receive a caption; an unclustered rack is a
    // one-instance layout group without a visible group name.
    if (clusterBounds) {
      clusters.push({
        id: plan.group.id,
        label: plan.group.label ?? plan.group.id,
        bounds: {
          x: clusterBounds.minX,
          y: clusterBounds.minY,
          width: clusterBounds.maxX - clusterBounds.minX,
          height: clusterBounds.maxY - clusterBounds.minY,
        },
      });
    }
  }

  return { instances: placed, clusters };
}
