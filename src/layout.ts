import type { Cluster, DatabaseNode, Design, DesignNode } from "./design";

/** One group of racks that shares a platform and column. */
interface LayoutGroup {
  id: string;
  label?: string;
  nodeIds: readonly string[];
  /** True for a user-declared cluster; false for an implicit one-node group. */
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
  nodes: DatabaseNode[];
  clusters: PlacedCluster[];
}

/**
 * Curated first colors, ordered to stay distinct next to one another.
 *
 * The first three preserve the palette used by the original example. Beyond
 * this list, `nodeColor` generates additional colors with a golden-angle hue
 * rotation, so even the maximum 64 nodes do not repeat within the palette.
 */
const PALETTE = [
  "#ff9d52",
  "#42d9e8",
  "#b49aff",
  "#7ee787",
  "#ff7b9c",
  "#f2d94e",
  "#6ea8ff",
  "#2dd4bf",
  "#ff6b6b",
  "#a3e635",
] as const;

/**
 * Convert an HSL triplet to a six-digit hex color.
 *
 * Colors ultimately become CSS custom properties, so the output is restricted
 * to the same format the old imported color field accepted. Hue is wrapped;
 * saturation and lightness are percentages in 0–100.
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360,
    s = saturation / 100,
    l = lightness / 100,
    chroma = (1 - Math.abs(2 * l - 1)) * s,
    sector = h / 60,
    second = chroma * (1 - Math.abs((sector % 2) - 1));
  let red = 0,
    green = 0,
    blue = 0;
  if (sector < 1) [red, green] = [chroma, second];
  else if (sector < 2) [red, green] = [second, chroma];
  else if (sector < 3) [green, blue] = [chroma, second];
  else if (sector < 4) [green, blue] = [second, chroma];
  else if (sector < 5) [red, blue] = [second, chroma];
  else [red, blue] = [chroma, second];

  const offset = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Every color handed to a node; 64 is the document node limit. */
const COLORS = [
  ...PALETTE,
  ...Array.from({ length: 64 - PALETTE.length }, (_, index) =>
    hslToHex(17 + index * 137.508, 68, 62),
  ),
];

/**
 * Pick a deterministic, visually distinct color for a node index.
 *
 * @param index - Position in the document's `nodes` array, 0–63.
 * @returns Lowercase six-digit hex suitable for `--cable-color`.
 */
export function nodeColor(index: number): string {
  return COLORS[index % COLORS.length];
}

/** Prefixes that identify a database rack from its ID. */
const NODE_TYPES: Readonly<Record<string, DatabaseNode["type"]>> = {
  db: "database-rack",
  database: "database-rack",
  rack: "database-rack",
};

/**
 * Infer the renderer type from an ID's leading word.
 *
 * IDs such as `db-01`, `database_primary`, and `rack.main` resolve through the
 * registry. Unknown prefixes fall back to the only renderer implemented today
 * so arbitrary user IDs remain valid; adding a renderer means adding its
 * prefixes here and widening `DatabaseNode["type"]`.
 *
 * @param id - Validated node ID.
 * @returns The type whose renderer should draw the node.
 */
export function inferNodeType(id: string): DatabaseNode["type"] {
  const prefix = /^[a-z]+/i.exec(id)?.[0].toLowerCase();
  return prefix && NODE_TYPES[prefix] ? NODE_TYPES[prefix] : "database-rack";
}

/** World-space distance between racks in one cluster. */
const RACK_SPACING = 128;

/** World-space gap between cluster columns. */
const CLUSTER_GAP = 420;

/** Half-width and half-depth of the 288 × 150 rack foot. */
const RACK_HALF_WIDTH = 144,
  RACK_HALF_DEPTH = 75;

/** Internal lookup entry pairing a persisted node with its color index. */
interface IndexedNode {
  node: DesignNode;
  index: number;
}

/**
 * Build the persisted groups in canvas order.
 *
 * Declared clusters come first in document order. Any node not named by a
 * cluster becomes its own single-node group, so unrelated racks do not share a
 * platform merely because they were declared next to each other.
 */
function layoutGroups(design: Design): LayoutGroup[] {
  const groups: LayoutGroup[] = design.clusters.map(
    (cluster: Cluster, index) => ({
      id: cluster.id ?? `cluster-${index + 1}`,
      ...(cluster.label === undefined ? {} : { label: cluster.label }),
      nodeIds: cluster.nodes,
      caption: true,
    }),
  );
  const clustered = new Set(
    design.clusters.flatMap((cluster) => cluster.nodes),
  );
  for (const node of design.nodes) {
    if (clustered.has(node.id)) continue;
    groups.push({
      id: `node:${node.id}`,
      nodeIds: [node.id],
      caption: false,
    });
  }
  return groups;
}

/**
 * Derive all render-only fields from a validated design.
 *
 * Layout is deterministic: clusters occupy successive X columns, members stack
 * along Y at 128-unit intervals, and unclustered nodes form their own columns.
 * The 128-unit spacing overlaps the 150-unit-deep feet, so cluster members
 * share one platform while the 420-unit column gap keeps groups separate.
 * Existing positions are never read, which makes the imported document the
 * single source of truth.
 *
 * Colors are assigned from the document node order, not cluster order, so
 * moving a node between clusters does not shuffle unrelated colors.
 *
 * @param design - Validated document; cluster members must reference nodes.
 * @returns Placed nodes and cluster bounds for captions.
 * @throws Error if a cluster references a missing node, which indicates the
 *   caller bypassed `parseDesign`.
 */
export function layoutDesign(design: Design): Layout {
  const indexed = new Map<string, IndexedNode>(
    design.nodes.map((node, index) => [node.id, { node, index }]),
  );
  const placed: DatabaseNode[] = [];
  const clusters: PlacedCluster[] = [];

  for (const [groupIndex, group] of layoutGroups(design).entries()) {
    const x = groupIndex * CLUSTER_GAP;
    const members = group.nodeIds.map((id) => {
      const entry = indexed.get(id);
      if (!entry)
        throw new Error(
          `Layout cluster ${group.id} references unknown node ${id}.`,
        );
      return entry;
    });

    for (const [memberIndex, entry] of members.entries()) {
      placed.push({
        id: entry.node.id,
        type: inferNodeType(entry.node.id),
        label: entry.node.label ?? entry.node.id,
        position: { x, y: memberIndex * RACK_SPACING, z: 0 },
        color: nodeColor(entry.index),
      });
    }

    // Only declared clusters receive a caption; an unclustered rack is a
    // one-node layout group without a visible group name.
    if (group.caption) {
      const height = RACK_HALF_DEPTH * 2 + (members.length - 1) * RACK_SPACING;
      clusters.push({
        id: group.id,
        label: group.label ?? group.id,
        bounds: {
          x: x - RACK_HALF_WIDTH,
          y: -RACK_HALF_DEPTH,
          width: RACK_HALF_WIDTH * 2,
          height,
        },
      });
    }
  }

  return { nodes: placed, clusters };
}
