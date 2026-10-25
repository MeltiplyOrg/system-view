import { createDatabaseDefinitions, project } from "./database";
import type { Connection, Design, PlacedInstance } from "./design";
import { instanceFootprint, layoutDesign } from "./layout";
import type { Layout, PlacedCluster } from "./layout";
import { createPlatforms } from "./platform";
import {
  componentHeight,
  createComponent,
  createComponentMotion,
} from "./components";
import { ComponentRasterCache } from "./component-raster";
import { routeOrthogonal } from "./routing";
import type { RoutePoint, RouteRect } from "./routing";

const NS = "http://www.w3.org/2000/svg";

/**
 * Prefix for a single instance's synthetic border key.
 *
 * Border keys share one namespace with declared cluster ids. The prefix keeps
 * an instance border from ever colliding with a cluster id, and lets hover,
 * selection, and drag strip the id back out of the key.
 */
const INSTANCE_KEY = "instance:";

/** Prefix for a declared cluster's focus/border key. */
const CLUSTER_KEY = "cluster:";

/** One screen-space point from `project`, mutated as [x, y] pairs. */
type ScreenPoint = [number, number];

/**
 * Cross product of OA × OB; its sign gives the turn direction at O.
 *
 * Shared by the convex hull and the segment-intersection orient test below.
 */
function orient(o: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Convex hull of projected box corners — the silhouette a node paints.
 *
 * Andrew's monotone chain. All eight corners of a box project onto a hexagonal
 * silhouette; the hull drops the two interior ones, so wires passing through
 * the empty bounding-box corners (e.g. a detour lane above the platform) are
 * not treated as covered. Input may contain duplicates.
 *
 * @param points - Screen-space corner points, in any order.
 * @returns Hull vertices in clockwise order; fewer than three when degenerate.
 */
function convexHull(points: ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input: ScreenPoint[]): ScreenPoint[] => {
    const chain: ScreenPoint[] = [];
    for (const point of input) {
      while (
        chain.length >= 2 &&
        orient(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      )
        chain.pop();
      chain.push(point);
    }
    return chain;
  };
  const lower = half(sorted),
    upper = half(sorted.reverse());
  // The last point of each chain is the first of the other; drop both.
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Whether a point lies inside or on a convex polygon given clockwise.
 *
 * Every edge must keep the point on the same side (zero cross product counts
 * as inside so hull-edge touches still count as coverage).
 */
function pointInConvexPolygon(
  point: ScreenPoint,
  polygon: ScreenPoint[],
): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length],
      side = orient(a, b, point);
    if (side === 0) continue;
    const current = side > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

/**
 * Whether segment AB crosses segment CD, endpoints included.
 *
 * Standard orient-based test: straddling on both axes, or a collinear touch
 * within the overlapping span.
 */
function segmentsIntersect(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  d: ScreenPoint,
): boolean {
  const crossA = orient(c, d, a),
    crossB = orient(c, d, b),
    crossC = orient(a, b, c),
    crossD = orient(a, b, d);
  if (
    ((crossA > 0 && crossB < 0) || (crossA < 0 && crossB > 0)) &&
    ((crossC > 0 && crossD < 0) || (crossC < 0 && crossD > 0))
  )
    return true;
  return (
    (crossA === 0 &&
      Math.min(c[0], d[0]) <= a[0] &&
      a[0] <= Math.max(c[0], d[0]) &&
      Math.min(c[1], d[1]) <= a[1] &&
      a[1] <= Math.max(c[1], d[1])) ||
    (crossB === 0 &&
      Math.min(c[0], d[0]) <= b[0] &&
      b[0] <= Math.max(c[0], d[0]) &&
      Math.min(c[1], d[1]) <= b[1] &&
      b[1] <= Math.max(c[1], d[1])) ||
    (crossC === 0 &&
      Math.min(a[0], b[0]) <= c[0] &&
      c[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= c[1] &&
      c[1] <= Math.max(a[1], b[1])) ||
    (crossD === 0 &&
      Math.min(a[0], b[0]) <= d[0] &&
      d[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= d[1] &&
      d[1] <= Math.max(a[1], b[1]))
  );
}

/**
 * Whether a projected cable polyline touches a node silhouette.
 *
 * A wire endpoint inside the hull or any wire/hull edge crossing means the
 * node paints over that part of the cable (racks always paint after the link
 * layer), so the node hides it on screen regardless of world depth.
 */
function polylineIntersectsPolygon(
  points: ScreenPoint[],
  polygon: ScreenPoint[],
): boolean {
  if (points.length < 2 || polygon.length < 3) return false;
  if (points.some((point) => pointInConvexPolygon(point, polygon))) return true;
  for (let index = 0; index < points.length - 1; index++)
    for (let edge = 0; edge < polygon.length; edge++)
      if (
        segmentsIntersect(
          points[index],
          points[index + 1],
          polygon[edge],
          polygon[(edge + 1) % polygon.length],
        )
      )
        return true;
  return false;
}

/**
 * Trim the lead-in or lead-out a cable spends beneath its own endpoint.
 *
 * A cable starts and ends inside the endpoint rack's silhouette, so testing
 * the raw polyline would mark the endpoint itself as covering its own wire.
 * Leading points (`from`) or trailing points (`to`) inside that endpoint's
 * silhouette are dropped before the coverage test; the exposed stretch is
 * still tested normally, so a cable that re-enters the same rack later in its
 * route still counts as covered.
 */
function withoutEndpointUnder(
  points: ScreenPoint[],
  endpoint: "from" | "to",
  hull: ScreenPoint[],
): ScreenPoint[] {
  let start = 0,
    end = points.length;
  if (endpoint === "from")
    while (start < end && pointInConvexPolygon(points[start], hull)) start++;
  else while (end > start && pointInConvexPolygon(points[end - 1], hull)) end--;
  return points.slice(start, end);
}

/** Zoom bounds chosen to keep the grid usable at both extreme scales. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

/**
 * World-space overscan for instance culling.
 *
 * The entry drop starts 100 units above the final position, so the upward
 * margin must cover the whole animation or an entering rack could be hidden
 * mid-flight. The same margin on the other sides gives a small buffer around
 * the viewport so ordinary pans do not reveal roots one frame late.
 */
const INSTANCE_CULL_MARGIN = 120;

/**
 * Quiet period after the last manual navigation input before pulses resume.
 * The spring and pointer gestures clear the navigating state themselves, so
 * this timer only covers input without an end event (wheel) and safety rails.
 */
const NAVIGATION_IDLE_MS = 140;

/**
 * World-space gap between a cluster footprint and its dashed floor frame.
 *
 * The frame is drawn at z=0 while the plinth top is at z=7, so the outline
 * must clear the platform's side walls to remain visible. One rack-foot
 * quarter (36 units) reads as a distinct group boundary without crowding the
 * neighbouring cluster column.
 */
const CLUSTER_FRAME_MARGIN = 36;

/** Screen-space gap between a cluster frame's bottom corner and its caption. */
const CLUSTER_LABEL_GAP = 20;

/**
 * Distance a cable travels straight out of a cluster port before it may turn.
 *
 * Adjacent group frames stay at least 60 world units apart (the footprint
 * clearance minus the 36-unit frame margin on each side), so a 30-unit stub
 * stays in the gap and still leaves room on both sides. The fixed outward leg
 * also guarantees the cable meets the border at a right angle instead of
 * riding along it.
 */
const CLUSTER_PORT_STUB = 30;

/**
 * Gap between a cable's centerline and its relation caption, in SVG units.
 *
 * Horizontal text is offset along the segment normal toward screen-up, so the
 * caption clears the wire and its pulse at every isometric angle.
 */
const CABLE_LABEL_OFFSET = 10;

/** Extra rise per duplicate link sharing the same projected endpoints. */
const CABLE_LABEL_STACK = 11;

/**
 * Relations longer than this condense to `CABLE_LABEL_WIDTH` instead of
 * growing across neighboring components.
 */
const CABLE_LABEL_MAX_CHARS = 36;

/** Width in SVG units used when a relation caption needs condensing. */
const CABLE_LABEL_WIDTH = 180;

/**
 * Transform/opacity animations shared by detailed skin swaps in one render.
 *
 * Both the outgoing ghost and the incoming skin animate, so this is split
 * across twice the number of swapping instances. Complex skins are chunked
 * into at most this many parts. Bounding the count keeps a small cluster from
 * allocating hundreds of compositor-promoted groups on a weak device; larger
 * swaps switch to the whole-skin cross-fade instead.
 */
const SKIN_PART_ANIMATION_BUDGET = 96;

/** Upper bound for one skin regardless of the shared budget. */
const SKIN_PART_LIMIT = 32;

/**
 * Borders allowed one transform animation per render.
 *
 * A bottlenecked scene with many nodes snaps the rest into place rather than
 * paying for a layer per border. Provider swaps normally change only a few
 * frames, so the visible result is unchanged while the cost stays bounded.
 */
const SKIN_FRAME_ANIMATION_BUDGET = 32;

/** Normalize provider keys for change detection; the renderer is case-blind. */
const providerKey = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";

/** One chunk of a provider skin wrapped in an animatable group. */
interface SkinPartWrap {
  wrapper: SVGGElement;
  parts: Element[];
}

/**
 * Projected bounds of the design content.
 *
 * Rack instances are measured from their layout boxes rather than
 * `getBBox()`: `<use>` instances can report stale geometry before the shared
 * definitions are laid out, which would shrink the fitted view to a stamp.
 */
function contentExtent(layout: Layout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x: number, y: number, z: number): void => {
    const [screenX, screenY] = project(x, y, z);
    minX = Math.min(minX, screenX);
    maxX = Math.max(maxX, screenX);
    minY = Math.min(minY, screenY);
    maxY = Math.max(maxY, screenY);
  };

  for (const instance of layout.instances) {
    const { x, y, z } = instance.position,
      { halfWidth, halfDepth } = instanceFootprint(
        instance.type,
        instance.provider,
      );
    for (const dx of [-halfWidth, halfWidth])
      for (const dy of [-halfDepth, halfDepth])
        for (const dz of [0, componentHeight(instance.type, instance.provider)])
          add(x + dx, y + dy, z + dz);
  }
  for (const cluster of layout.clusters) {
    const { x, y, width, height } = cluster.bounds;
    for (const cornerX of [
      x - CLUSTER_FRAME_MARGIN,
      x + width + CLUSTER_FRAME_MARGIN,
    ])
      for (const cornerY of [
        y - CLUSTER_FRAME_MARGIN,
        y + height + CLUSTER_FRAME_MARGIN,
      ])
        add(cornerX, cornerY, 0);
  }

  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
}

/**
 * Point halfway along a projected polyline, lifted off the cable.
 *
 * Length is measured in projected space, so the caption stays centered on the
 * drawn route rather than drifting toward a corner when the world-space
 * segments have different lengths. The offset follows the local segment
 * normal toward screen-up (negative Y), which keeps horizontal text clear of
 * the wire. Returns null for a degenerate path; real connections always have
 * a positive projected length because their endpoints differ.
 *
 * @param points - Projected path vertices in draw order.
 * @param offset - Distance from the centerline in SVG user units.
 * @returns The caption anchor, or null when there is no drawable segment.
 */
export function cableLabelPoint(
  points: readonly (readonly [number, number])[],
  offset: number,
): readonly [number, number] | null {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
    lengths.push(length);
    total += length;
  }
  if (total === 0) return null;

  let remaining = total / 2;
  for (let index = 1; index < points.length; index++) {
    const length = lengths[index - 1];
    if (length === 0) continue;
    if (remaining > length) {
      remaining -= length;
      continue;
    }
    const start = points[index - 1],
      end = points[index],
      t = remaining / length,
      x = start[0] + (end[0] - start[0]) * t,
      y = start[1] + (end[1] - start[1]) * t;
    let normalX = -(end[1] - start[1]) / length,
      normalY = (end[0] - start[0]) / length;
    // Two normals exist; pick the one pointing up-screen. A horizontal cable
    // has no vertical normal and resolves to straight up.
    if (normalY > 0) {
      normalX = -normalX;
      normalY = -normalY;
    }
    return [x + normalX * offset, y + normalY * offset];
  }
  return null;
}

/** Frame edge a cluster port sits on; null for the degenerate fallback. */
export type ClusterEdge = "left" | "right" | "top" | "bottom" | null;

/** Port where a link meets a cluster frame. */
export interface ClusterPort {
  x: number;
  y: number;
  edge: ClusterEdge;
}

/** One resolved connection before its ports are distributed. */
interface LinkPlan {
  link: Connection;
  index: number;
  connectionId: string;
  from: PlacedInstance;
  to: PlacedInstance;
  fromCluster: string | undefined;
  toCluster: string | undefined;
  internal: boolean;
  fromFrame: PlacedCluster | undefined;
  toFrame: PlacedCluster | undefined;
  fromPort: ClusterPort | undefined;
  toPort: ClusterPort | undefined;
}

/** One endpoint competing for a slot on a frame side. */
interface PortUse {
  plan: LinkPlan;
  side: "from" | "to";
  edge: Exclude<ClusterEdge, null>;
  /** Far endpoint in world coordinates; its edge-axis position sets the slot. */
  other: { x: number; y: number };
}

/**
 * Place one of several ports along a frame edge.
 *
 * The edge is divided into equal segments and the port sits at the midpoint of
 * its segment. A group of ports is therefore evenly spaced and centered on the
 * side: one port centers, two sit at the quarter points, and every count keeps
 * the same middle. Callers pass a stable, deduplicated endpoint list; the
 * index is clamped to the valid range.
 *
 * @param cluster - Placed cluster or standalone frame supplying the boundary.
 * @param edge - Side chosen by `clusterPort`.
 * @param index - Zero-based slot among the ports on this side.
 * @param count - Number of ports sharing this side; values below one are one.
 * @returns The port point on that edge, in world units.
 */
export function clusterPortSlot(
  cluster: PlacedCluster,
  edge: Exclude<ClusterEdge, null>,
  index: number,
  count: number,
): ClusterPort {
  const frame = clusterFrameRect(cluster),
    left = frame.x,
    right = frame.x + frame.width,
    top = frame.y,
    bottom = frame.y + frame.height,
    slots = Math.max(1, Math.floor(count)),
    slot = Math.min(slots - 1, Math.max(0, Math.floor(index))),
    t = (slot + 0.5) / slots;
  switch (edge) {
    case "left":
      return { x: left, y: top + (bottom - top) * t, edge };
    case "right":
      return { x: right, y: top + (bottom - top) * t, edge };
    case "top":
      return { x: left + (right - left) * t, y: top, edge };
    case "bottom":
      return { x: left + (right - left) * t, y: bottom, edge };
  }
}

/**
 * Point where a link meets a cluster boundary on its way to another node.
 *
 * Links keep addressing the specific member recorded in the document, but an
 * external link attaches to the replica set as a whole. The ray from that
 * member to the other endpoint chooses the facing frame edge; a single link
 * uses that edge's midpoint. Callers with several links on one edge replace
 * this base port with `clusterPortSlot`. Links whose two endpoints share a
 * cluster bypass this helper and keep their rack-to-rack endpoints.
 *
 * @param cluster - Placed cluster whose expanded frame supplies the boundary.
 * @param member - The endpoint instance's world position.
 * @param target - The other endpoint's world position.
 * @returns The midpoint of the frame edge the ray leaves through and the edge
 *   it belongs to. A degenerate ray returns the member with no edge;
 *   unvalidated geometry that puts the member outside the frame on the far side
 *   also falls back to the member.
 */
export function clusterPort(
  cluster: PlacedCluster,
  member: { x: number; y: number },
  target: { x: number; y: number },
): ClusterPort {
  const frame = clusterFrameRect(cluster),
    left = frame.x,
    right = frame.x + frame.width,
    top = frame.y,
    bottom = frame.y + frame.height,
    dx = target.x - member.x,
    dy = target.y - member.y;
  let scale = Infinity;
  let edge: Exclude<ClusterEdge, null> | undefined;
  if (dx > 0) {
    scale = (right - member.x) / dx;
    edge = "right";
  } else if (dx < 0) {
    scale = (left - member.x) / dx;
    edge = "left";
  }
  if (dy > 0) {
    const next = (bottom - member.y) / dy;
    if (next < scale) {
      scale = next;
      edge = "bottom";
    }
  } else if (dy < 0) {
    const next = (top - member.y) / dy;
    if (next < scale) {
      scale = next;
      edge = "top";
    }
  }
  if (!edge || !Number.isFinite(scale) || scale < 0)
    return { x: member.x, y: member.y, edge: null };
  return clusterPortSlot(cluster, edge, 0, 1);
}

/**
 * Anchor a ported cable just outside the cluster frame.
 *
 * Routing starts and ends at these anchors, then the scene prepends/appends
 * the port itself. The fixed outward leg is what keeps the final approach
 * perpendicular to the border.
 */
function clusterPortStub(port: ClusterPort): RoutePoint {
  switch (port.edge) {
    case "left":
      return { x: port.x - CLUSTER_PORT_STUB, y: port.y };
    case "right":
      return { x: port.x + CLUSTER_PORT_STUB, y: port.y };
    case "top":
      return { x: port.x, y: port.y - CLUSTER_PORT_STUB };
    case "bottom":
      return { x: port.x, y: port.y + CLUSTER_PORT_STUB };
    default:
      return { x: port.x, y: port.y };
  }
}

/** World-space rectangle covered by a node's dashed frame. */
function clusterFrameRect(cluster: PlacedCluster): RouteRect {
  return {
    x: cluster.bounds.x - CLUSTER_FRAME_MARGIN,
    y: cluster.bounds.y - CLUSTER_FRAME_MARGIN,
    width: cluster.bounds.width + CLUSTER_FRAME_MARGIN * 2,
    height: cluster.bounds.height + CLUSTER_FRAME_MARGIN * 2,
  };
}

/**
 * Build the optional cluster captions as one non-interactive SVG group.
 *
 * Labels are centered beneath the projected footprint of their group. The
 * isometric footprint is a diamond, so the caption uses the projected
 * bounding-box center rather than a world-space Y offset; that keeps the text
 * visually attached to the platform at every cluster size. The label sits
 * below the dashed frame's bottom corner so the outline never crosses the
 * text. Text is assigned with `textContent`, so imported cluster names cannot
 * inject markup.
 */
function createClusterLabels(clusters: readonly PlacedCluster[]): SVGGElement {
  const group = document.createElementNS(NS, "g");
  group.classList.add("clusters");
  for (const cluster of clusters) {
    const { x, y, width, height } = cluster.bounds,
      corners = [
        project(x, y, 0),
        project(x + width, y, 0),
        project(x, y + height, 0),
        project(x + width, y + height, 0),
      ],
      left = Math.min(...corners.map(([cornerX]) => cornerX)),
      right = Math.max(...corners.map(([cornerX]) => cornerX)),
      bottom = Math.max(...corners.map(([, cornerY]) => cornerY));
    const label = document.createElementNS(NS, "text");
    label.classList.add("cluster-label");
    label.dataset.clusterId = cluster.id;
    label.setAttribute("x", ((left + right) / 2).toFixed(1));
    label.setAttribute(
      "y",
      (bottom + CLUSTER_FRAME_MARGIN + CLUSTER_LABEL_GAP).toFixed(1),
    );
    label.setAttribute("text-anchor", "middle");
    label.textContent = cluster.label;
    group.append(label);
  }
  return group;
}

/**
 * Build one dashed floor border per draggable node.
 *
 * A declared cluster is one group and gets one border around all its members.
 * Every unclustered instance is its own node and gets a border around its
 * world-space footprint. Borders expand by `CLUSTER_FRAME_MARGIN` and project
 * at z=0, so they lie flat on the grid and follow the isometric axes.
 *
 * Borders highlight in yellow when their node is hovered. `data-cluster-id`
 * carries the border key — the declared cluster id, or `instance:<id>` for a
 * standalone instance — tying each border to its node for hover, selection,
 * and the anchor handle.
 *
 * @param frames - Cluster and standalone-instance borders, clusters first so
 *   instance borders paint above the group outlines.
 * @returns Non-interactive group containing every border path.
 */
function createNodeFrames(frames: Iterable<PlacedCluster>): SVGGElement {
  const group = document.createElementNS(NS, "g");
  group.classList.add("node-frames");
  for (const frame of frames) {
    const { x, y, width, height } = frame.bounds,
      left = x - CLUSTER_FRAME_MARGIN,
      top = y - CLUSTER_FRAME_MARGIN,
      right = x + width + CLUSTER_FRAME_MARGIN,
      bottom = y + height + CLUSTER_FRAME_MARGIN,
      corners = [
        project(left, top, 0),
        project(right, top, 0),
        project(right, bottom, 0),
        project(left, bottom, 0),
      ];
    const border = document.createElementNS(NS, "path");
    border.classList.add("scene-frame");
    border.classList.add(
      frame.id.startsWith(INSTANCE_KEY) ? "instance-frame" : "cluster-frame",
    );
    border.dataset.clusterId = frame.id;
    border.setAttribute(
      "d",
      `M${corners
        .map(([cornerX, cornerY]) =>
          [cornerX, cornerY].map((n) => n.toFixed(1)).join(" "),
        )
        .join("L")}Z`,
    );
    group.append(border);
  }
  return group;
}

/**
 * Owns the full-viewport SVG scene.
 *
 * Responsibilities: shared rack definitions, the isometric grid, design
 * layers, fit behavior, wheel/pinch zoom, and pointer panning. It never
 * renders UI chrome; the overlay/sidebar state belongs to `main.ts`. The
 * instance lives for the page lifetime, so its event listeners are
 * intentionally permanent.
 */
export class SystemScene {
  /** Static geometry followed by keyed component roots in painter order. */
  private readonly content = document.createElementNS(NS, "g");

  /** Shared static artwork for every renderer type, keyed by geometry/palette. */
  private readonly componentRaster: ComponentRasterCache;

  /** Live component DOM survives replica edits, including in-flight CSS drops. */
  private readonly renderedInstances = new Map<
    string,
    {
      root: SVGGElement;
      /** Holder for the skin; skin swaps animate this, not the identity root. */
      slot: SVGGElement;
      element: SVGGElement;
      /** Projected position the element's own transform was built at. */
      origin: readonly [number, number];
      /** Projected position used by the last render, for ghost handoff. */
      placed: readonly [number, number];
      label: string;
      type: PlacedInstance["type"];
      provider?: string;
      /** Cached root visibility so pans only write style on state changes. */
      hidden: boolean;
    }
  >();

  /**
   * In-flight provider skin morph, keyed by instance id.
   *
   * The old skin is a clone parked beside the holder while the new skin
   * builds. Tracking it lets a second provider change (or deletion) cancel
   * the animations and remove the ghost instead of stacking crossfades.
   */
  private readonly skinMorphs = new Map<
    string,
    {
      ghost: SVGGElement;
      animations: Animation[];
      /** Incoming part holders, unwrapped when the build settles. */
      wraps: SkinPartWrap[];
      /** Incoming geometry root carrying the raster skip marker. */
      geometry: SVGGElement | null;
      /** Lazy live-detail layer for bulk swaps. */
      motion: (() => SVGGElement | null) | null;
    }
  >();

  /** Overscanned grid path, rebuilt only when its cached coverage runs out. */
  private readonly grid = document.createElementNS(NS, "path");
  private gridCoverage: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    step: number;
  } | null = null;

  /** Projected design bounds plus breathing room, set by `render`. */
  private contentBounds = { x: -500, y: -350, width: 1000, height: 700 };

  /** Aspect-matched base viewBox at zoom 1. */
  private base = { width: 1000, height: 700 };

  /**
   * Last client rectangle observed by the ResizeObserver, in CSS pixels.
   *
   * The root SVG is fixed to the full stage and its viewBox aspect is derived
   * from this same rectangle, so client↔user conversion is pure arithmetic.
   * Zero width/height means the stage has not been measured yet (or is
   * detached); conversions report that as invalid.
   */
  private viewport = { left: 0, top: 0, width: 0, height: 0 };

  /** Current viewBox center in SVG user units. */
  private center: [number, number] = [0, 0];

  /** Multiplicative zoom, clamped to MIN_ZOOM…MAX_ZOOM. */
  private zoom = 1;

  /** Active pointer for one-finger/mouse panning, or null when idle. */
  private dragPointer: number | null = null;

  /** Last client-space pointer position while dragging. */
  private lastPointer: { x: number; y: number } | null = null;

  /** Every pointer currently down, keyed by pointer id. */
  private readonly activePointers = new Map<number, { x: number; y: number }>();

  /** Previous two-finger span, or null outside a pinch gesture. */
  private pinch: {
    distance: number;
    midpoint: { x: number; y: number };
  } | null = null;

  /** Pending requestAnimationFrame id for coalesced pointer updates. */
  private pointerFrame: number | null = null;

  /**
   * Border id currently hovered by the pointer, if any.
   *
   * Border ids are the `data-cluster-id` values: a declared cluster's id, or
   * `instance:<id>` for a standalone instance.
   */
  private hoveredFrameId: string | null = null;

  /**
   * Dashed-border frame per draggable node.
   *
   * A declared cluster is one group, mapped by its cluster id; every
   * unclustered instance is its own node, mapped as `instance:<id>` with
   * bounds equal to its platform footprint (the drawn border expands by
   * `CLUSTER_FRAME_MARGIN`, and `clusterPort` does the same when picking a
   * border edge). Built fresh on every render, clusters first so instance
   * borders paint above the group outlines.
   *
   * Routing uses the same set: an external cable to a cluster member attaches
   * to the group border, and a cable to a standalone instance attaches to its
   * own border.
   */
  private readonly borderFrames = new Map<string, PlacedCluster>();

  /**
   * Last design passed to `render`.
   *
   * The anchor drag re-renders this document with placement offsets applied,
   * without the shell needing to know a drag is in flight.
   */
  private currentDesign: Design | null = null;

  /**
   * Manual placement offset per standalone instance, in world units.
   *
   * View-only state: the document never stores it, so the exported JSON keeps
   * the derived layout as its single source of truth. Applied after the layout
   * pass on every render; ids absent from the current layout are inert.
   */
  private readonly dragOffsets = new Map<string, { x: number; y: number }>();

  /**
   * Manual placement offset per declared cluster, in world units.
   *
   * A cluster is one draggable group, so its offset applies to every member.
   * That includes replicas added after the drag: they land in their derived
   * slot relative to the moved group instead of at the original layout
   * position. Handed off to/from `dragOffsets` when a replica edit promotes a
   * standalone instance into a cluster or collapses a cluster back to one.
   */
  private readonly clusterOffsets = new Map<string, { x: number; y: number }>();

  /** Cluster id per instance id, rebuilt on every render. */
  private readonly instanceCluster = new Map<string, string>();

  /** Grab handle for the hovered node, or null when not yet built. */
  private anchor: SVGGElement | null = null;

  /**
   * Border id the grab handle is currently hosted for.
   *
   * The handle is hosted on the SVG root (outside any instance group) so a
   * dimmed node can never fade it; `updateAnchorPosition` keeps it glued to
   * the node's middle across renders.
   */
  private anchorKey: string | null = null;

  /** Live anchor drag, or null when the handle is idle. */
  private anchorDrag: {
    pointerId: number;
    /** Pointer position in SVG user units at gesture start. */
    start: { x: number; y: number };
    /** Border id of the dragged node: a cluster id or `instance:<id>`. */
    key: string;
    /** Pre-drag offset copy for the dragged node. */
    base: { x: number; y: number };
  } | null = null;

  /** Focus key the dim set was last computed for, to re-apply after renders. */
  private focusKey: string | null = null;

  /**
   * Wall-clock start of the current focus, in milliseconds.
   *
   * A render replaces the frame layer, so the focused border's CSS animation
   * restarts from zero on every drag frame. The negative `animation-delay`
   * derived from this instant resumes each replacement mid-cycle, keeping the
   * dash marching continuously for the whole selection.
   */
  private focusStartedAt = 0;

  /** Projected top-center per hover target key, for the pinned callout. */
  private readonly topPoints = new Map<string, readonly [number, number]>();

  /** Projected world bounds per hover target key, for camera framing. */
  private readonly targetBounds = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number }
  >();

  /**
   * Screen-space silhouette per instance id, for focus dimming coverage.
   *
   * Convex hull of the projected box corners, rebuilt on every render. Racks
   * always paint after the link layer, so any wire touching this hull is
   * hidden by that node on screen.
   */
  private readonly silhouettes = new Map<string, ScreenPoint[]>();

  /** Projected cable polyline per connection, for the same coverage test. */
  private readonly wirePaths = new Map<
    string,
    { from: string; to: string; points: ScreenPoint[] }
  >();

  /** Pending requestAnimationFrame id for the camera move, if any. */
  private cameraFrame: number | null = null;

  /** Single idle timer while `.navigating` suppresses per-rack pulses. */
  private navigationTimer: number | null = null;

  /** One retargetable spring: X/Y in world units, zoom in logarithmic space. */
  private cameraMotion: {
    position: [number, number, number];
    target: [number, number, number];
    velocity: [number, number, number];
    time: number;
  } | null = null;

  /** ViewBox subscribers; the shell aligns screen-space overlays. */
  private readonly viewListeners = new Set<() => void>();

  /** Geometry subscribers; overlays re-anchor without moving their cards. */
  private readonly layoutListeners = new Set<() => void>();

  /**
   * @param svg Full-viewport SVG element. The caller should not append other
   *   defs or content; this class owns its child order.
   *
   * The constructor wires a non-passive wheel handler, pinch zoom, and the
   * pointer-capture lifecycle. A ResizeObserver re-derives the base viewBox
   * without resetting the user's zoom or pan. No cleanup is provided because
   * the scene is a page-lifetime singleton.
   */
  constructor(private readonly svg: SVGSVGElement) {
    this.grid.classList.add("space-grid");
    // Defs first, grid behind content; painter order is the only depth system.
    svg.append(createDatabaseDefinitions(), this.grid, this.content);
    this.componentRaster = new ComponentRasterCache(svg);
    new ResizeObserver(() => this.resize()).observe(svg);

    svg.addEventListener(
      "wheel",
      (event) => {
        // Exponential response keeps trackpad and mouse-wheel steps smooth.
        // preventDefault is required because the listener is non-passive;
        // the page itself must never scroll around this fixed canvas.
        event.preventDefault();
        this.stopCamera();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.zoomBy(factor, event.clientX, event.clientY);
      },
      { passive: false },
    );

    svg.addEventListener("pointerdown", (event) => {
      // Primary button only: secondary clicks and context menus stay native.
      if (event.button !== 0) return;
      event.preventDefault();
      // A new gesture owns the camera; never fight the user's drag.
      this.stopCamera();
      // Settle a pending pan before the new contact changes the gesture mode.
      this.flushPointerUpdate();
      this.activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      // Capture keeps each contact alive if it leaves the SVG.
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("dragging");

      if (this.activePointers.size === 1) {
        this.dragPointer = event.pointerId;
        this.lastPointer = { x: event.clientX, y: event.clientY };
      } else if (this.activePointers.size === 2) {
        // The second contact starts a pinch. Drop the one-finger pan baseline
        // so lifting a finger later cannot jump the view.
        this.dragPointer = null;
        this.lastPointer = null;
        this.pinch = this.pinchState();
      }
    });

    svg.addEventListener("pointermove", (event) => {
      if (!this.activePointers.has(event.pointerId)) return;
      this.activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      // Phones can emit several pointer moves per display frame. Applying each
      // one rewrites the viewBox and regenerates the grid repeatedly, so batch
      // them and read the latest positions once per frame.
      this.schedulePointerUpdate();
    });

    // One idempotent stop path for pointerup, pointercancel, and lost capture.
    const stopDragging = (event: PointerEvent) => {
      if (!this.activePointers.has(event.pointerId)) return;
      // Apply the last coalesced movement before the contact disappears; a
      // short pinch can otherwise end before its first animation frame.
      this.flushPointerUpdate();
      this.activePointers.delete(event.pointerId);
      if (svg.hasPointerCapture(event.pointerId))
        svg.releasePointerCapture(event.pointerId);

      if (this.activePointers.size === 0) {
        this.dragPointer = null;
        this.lastPointer = null;
        this.pinch = null;
        svg.classList.remove("dragging");
        this.endNavigation();
        return;
      }

      // Rebase the remaining contact so a pinch that becomes a one-finger pan
      // (or vice versa) starts from the current position instead of jumping.
      this.pinch = this.activePointers.size >= 2 ? this.pinchState() : null;
      if (this.activePointers.size === 1) {
        const [id, point] = this.activePointers.entries().next().value!;
        this.dragPointer = id;
        this.lastPointer = { ...point };
      }
    };
    svg.addEventListener("pointerup", stopDragging);
    svg.addEventListener("pointercancel", stopDragging);
    svg.addEventListener("lostpointercapture", stopDragging);

    // Hover drives two coupled readouts: the border highlight and the grab
    // handle. Both resolve the same border id, and both stand down when an
    // anchor drag owns the pointer (capture retargets events to the handle,
    // so hover churn mid-gesture cannot re-host or unhighlight).
    const hoverUpdate = (element: Element | null): void => {
      if (this.anchorDrag) return;
      const frameId = this.frameIdOf(element);
      this.setHoveredFrame(frameId);
      this.hostAnchor(frameId);
    };
    svg.addEventListener("pointerover", (event) => {
      hoverUpdate(event.target as Element | null);
    });
    svg.addEventListener("pointerout", (event) => {
      hoverUpdate(event.relatedTarget as Element | null);
    });
    // Re-resolve on free moves as well. A render can replace the frame layer
    // under a stationary pointer without firing a boundary event, and a pan
    // captures the pointer, which suppresses over/out churn until release.
    svg.addEventListener("pointermove", (event) => {
      if (this.activePointers.size > 0) return;
      hoverUpdate(event.target as Element | null);
    });
    svg.addEventListener("pointerleave", () => hoverUpdate(null));
  }

  /**
   * Render geometry and reconcile keyed components without interrupting drops.
   *
   * Layout and colors are derived here rather than stored in the document.
   * Paint order is node borders, platforms, cluster captions, links, then
   * racks back-to-front. Isometric depth is `x + y` (larger is nearer) with
   * `z` as a tie-breaker. Bounds are taken from this content only, never the
   * regenerating grid, so fit stays stable.
   *
   * @param design - Already validated document. The defensive endpoint check
   *   protects against callers bypassing the parser.
   * @param animate - Preserve live components/camera, drop in new replicas, and
   *   morph changed provider skins through a build reveal.
   * @throws Error when a connection references a missing instance.
   */
  render(design: Design, animate = false): void {
    const previousDesign = this.currentDesign,
      motion =
        animate && !matchMedia("(prefers-reduced-motion: reduce)").matches,
      previousProviders = new Map(
        (previousDesign?.instances ?? []).map((instance) => [
          instance.id,
          providerKey(instance.provider),
        ]),
      ),
      providerTransition =
        motion &&
        previousDesign !== null &&
        design.instances.some(
          (instance) =>
            previousProviders.has(instance.id) &&
            previousProviders.get(instance.id) !==
              providerKey(instance.provider),
        );

    // A new render owns the platform cross-fade; an older ghost must not
    // outlive it or be mistaken for the live platform layer.
    for (const ghost of this.content.querySelectorAll<SVGGElement>(
      ".platform-ghost",
    )) {
      for (const animation of ghost.getAnimations()) animation.cancel();
      ghost.remove();
    }
    this.currentDesign = design;
    this.hoveredFrameId = null;
    const previousCluster = new Map(this.instanceCluster);
    this.instanceCluster.clear();
    for (const [index, cluster] of design.clusters.entries()) {
      const clusterId = cluster.id ?? `cluster-${index + 1}`;
      for (const instanceId of cluster.instances) {
        this.instanceCluster.set(instanceId, clusterId);
      }
    }
    this.reconcileOffsets(previousCluster, design);
    const layout = layoutDesign(design);
    this.applyDragOffsets(layout);

    // Split the shared animation budget across every skin that will swap.
    // Chunking happens inside each skin, so the total layer count is bounded
    // even when a large cluster changes provider at once.
    let skinSwaps = 0;
    if (animate)
      for (const instance of layout.instances) {
        const record = this.renderedInstances.get(instance.id);
        if (
          record &&
          (record.type !== instance.type ||
            record.provider !== instance.provider)
        )
          skinSwaps += 1;
      }
    // Part-level builds are only legible when the objects are large on
    // screen. Small swaps get the full per-part detail; cluster-wide swaps
    // use a single whole-skin cross-fade so ten replicas cannot multiply
    // wrappers and paint work on a weak device.
    const detailed = skinSwaps > 0 && skinSwaps <= 3,
      partBudget = Math.max(
        3,
        Math.min(
          SKIN_PART_LIMIT,
          Math.floor(SKIN_PART_ANIMATION_BUDGET / (2 * Math.max(1, skinSwaps))),
        ),
      );

    // Every draggable node gets a border. A declared cluster is one group
    // border around all its members; each unclustered instance gets its own.
    // `borderFrames` insertion order puts clusters first so instance borders
    // paint above the group outlines.
    this.borderFrames.clear();
    for (const cluster of layout.clusters)
      this.borderFrames.set(cluster.id, cluster);
    for (const instance of layout.instances) {
      if (this.instanceCluster.has(instance.id)) continue;
      const { x, y } = instance.position,
        { halfWidth, halfDepth } = instanceFootprint(
          instance.type,
          instance.provider,
        );
      this.borderFrames.set(`${INSTANCE_KEY}${instance.id}`, {
        id: `${INSTANCE_KEY}${instance.id}`,
        label: instance.label,
        bounds: {
          x: x - halfWidth,
          y: y - halfDepth,
          width: halfWidth * 2,
          height: halfDepth * 2,
        },
      });
    }

    // Top points anchor the pinned callout above the highest member, and
    // target bounds drive the zoom-to-fit on selection.
    this.topPoints.clear();
    this.targetBounds.clear();
    this.silhouettes.clear();
    this.wirePaths.clear();
    const clusterTops = new Map<string, readonly [number, number]>();
    const clusterBounds = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (const instance of layout.instances) {
      const { x, y, z } = instance.position,
        { halfWidth, halfDepth } = instanceFootprint(
          instance.type,
          instance.provider,
        ),
        top = project(
          x,
          y,
          z + componentHeight(instance.type, instance.provider),
        ),
        key = `${INSTANCE_KEY}${instance.id}`,
        bounds = {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
        };
      this.topPoints.set(key, top);
      const corners: ScreenPoint[] = [];
      for (const dx of [-halfWidth, halfWidth])
        for (const dy of [-halfDepth, halfDepth])
          for (const dz of [
            0,
            componentHeight(instance.type, instance.provider),
          ]) {
            const [screenX, screenY] = project(x + dx, y + dy, z + dz);
            corners.push([screenX, screenY]);
            bounds.minX = Math.min(bounds.minX, screenX);
            bounds.maxX = Math.max(bounds.maxX, screenX);
            bounds.minY = Math.min(bounds.minY, screenY);
            bounds.maxY = Math.max(bounds.maxY, screenY);
          }
      this.targetBounds.set(key, bounds);
      this.silhouettes.set(instance.id, convexHull(corners));

      const clusterId = this.instanceCluster.get(instance.id);
      if (!clusterId) continue;
      const currentTop = clusterTops.get(clusterId);
      if (!currentTop || top[1] < currentTop[1])
        clusterTops.set(clusterId, top);
      const currentBounds = clusterBounds.get(clusterId);
      if (!currentBounds) clusterBounds.set(clusterId, { ...bounds });
      else {
        currentBounds.minX = Math.min(currentBounds.minX, bounds.minX);
        currentBounds.minY = Math.min(currentBounds.minY, bounds.minY);
        currentBounds.maxX = Math.max(currentBounds.maxX, bounds.maxX);
        currentBounds.maxY = Math.max(currentBounds.maxY, bounds.maxY);
      }
    }
    for (const [clusterId, top] of clusterTops)
      this.topPoints.set(`${CLUSTER_KEY}${clusterId}`, top);
    for (const [clusterId, bounds] of clusterBounds)
      this.targetBounds.set(`${CLUSTER_KEY}${clusterId}`, bounds);

    const layer = document.createElementNS(NS, "g");
    layer.append(
      createNodeFrames(this.borderFrames.values()),
      createPlatforms(layout.instances),
      createClusterLabels(layout.clusters),
    );

    const byId = new Map(
      layout.instances.map((instance) => [instance.id, instance]),
    );
    const linkPlans: LinkPlan[] = design.connections.map((link, index) => {
      const from = byId.get(link.from),
        to = byId.get(link.to),
        connectionId = link.id ?? `${link.from}->${link.to}`;
      if (!from || !to)
        throw new Error(
          `Connection ${connectionId} references an unknown instance.`,
        );
      const fromCluster = this.instanceCluster.get(from.id),
        toCluster = this.instanceCluster.get(to.id),
        internal = fromCluster !== undefined && fromCluster === toCluster,
        fromFrame = internal
          ? undefined
          : this.borderFrames.get(fromCluster ?? `${INSTANCE_KEY}${from.id}`),
        toFrame = internal
          ? undefined
          : this.borderFrames.get(toCluster ?? `${INSTANCE_KEY}${to.id}`);
      return {
        link,
        index,
        connectionId,
        from,
        to,
        fromCluster,
        toCluster,
        internal,
        fromFrame,
        toFrame,
        fromPort: fromFrame
          ? clusterPort(fromFrame, from.position, to.position)
          : undefined,
        toPort: toFrame
          ? clusterPort(toFrame, to.position, from.position)
          : undefined,
      };
    });

    // Fan multiple cables across a shared frame side. Group by frame object and
    // edge, order by the far endpoint's coordinate along that edge to avoid
    // crossings, then replace the centered base port with a slot midpoint.
    // Slot midpoints keep the fan equally spaced and centered on the side.
    const portUses = new Map<
      PlacedCluster,
      Map<Exclude<ClusterEdge, null>, PortUse[]>
    >();
    const addPortUse = (
      plan: LinkPlan,
      side: "from" | "to",
      frame: PlacedCluster | undefined,
      port: ClusterPort | undefined,
      other: { x: number; y: number },
    ): void => {
      if (!frame || !port?.edge) return;
      let edges = portUses.get(frame);
      if (!edges) {
        edges = new Map();
        portUses.set(frame, edges);
      }
      let uses = edges.get(port.edge);
      if (!uses) {
        uses = [];
        edges.set(port.edge, uses);
      }
      uses.push({ plan, side, edge: port.edge, other });
    };
    for (const plan of linkPlans) {
      addPortUse(plan, "from", plan.fromFrame, plan.fromPort, plan.to.position);
      addPortUse(plan, "to", plan.toFrame, plan.toPort, plan.from.position);
    }
    for (const [frame, edges] of portUses) {
      for (const [edge, uses] of edges) {
        const alongY = edge === "left" || edge === "right";
        uses.sort((a, b) => {
          const aAlong = alongY ? a.other.y : a.other.x,
            bAlong = alongY ? b.other.y : b.other.x;
          return (
            aAlong - bAlong ||
            a.plan.index - b.plan.index ||
            (a.side === b.side ? 0 : a.side === "from" ? -1 : 1)
          );
        });
        for (const [slot, use] of uses.entries()) {
          const port = clusterPortSlot(frame, edge, slot, uses.length);
          if (use.side === "from") use.plan.fromPort = port;
          else use.plan.toPort = port;
        }
      }
    }

    // Caption lanes still stack links whose drawn route coincides.
    const labelLanes = new Map<string, number>();
    for (const plan of linkPlans) {
      const {
        link,
        index,
        connectionId,
        from,
        to,
        fromCluster,
        toCluster,
        internal,
        fromFrame,
        toFrame,
      } = plan;
      const fromPort = plan.fromPort,
        toPort = plan.toPort,
        fromPoint = fromPort ?? from.position,
        toPoint = toPort ?? to.position;

      // Cables follow world X/Y axes with sharp projected corners. External
      // routes detour around node borders so a cable is not hidden behind
      // artwork for most of its length. Same-cluster replication stays
      // rack-to-rack, with the existing parallel lane for a member skipped in
      // the same row.
      let worldPath: RoutePoint[];
      if (internal) {
        const crossesInstance =
          fromPoint.y === toPoint.y &&
          layout.instances.some(
            (instance) =>
              instance.position.y === fromPoint.y &&
              instance.position.x > Math.min(fromPoint.x, toPoint.x) &&
              instance.position.x < Math.max(fromPoint.x, toPoint.x),
          );
        const laneDepth = Math.max(
          instanceFootprint(from.type, from.provider).halfDepth,
          instanceFootprint(to.type, to.provider).halfDepth,
        );
        const laneY = fromPoint.y + laneDepth * 2;
        worldPath = crossesInstance
          ? [
              fromPoint,
              { x: fromPoint.x, y: laneY },
              { x: toPoint.x, y: laneY },
              toPoint,
            ]
          : [fromPoint, { x: toPoint.x, y: fromPoint.y }, toPoint];
      } else {
        // Ported endpoints leave/enter on a fixed outward stub. Routing
        // between the stubs (rather than the ports) keeps the final leg
        // perpendicular to the border while the router works in open space.
        const fromAnchor = fromPort ? clusterPortStub(fromPort) : fromPoint,
          toAnchor = toPort ? clusterPortStub(toPort) : toPoint;
        // Cluster borders and standalone node borders are obstacles — the
        // link's own endpoints are excluded because their port stubs already
        // start outside the border. Member borders inside a cluster are not
        // obstacles: external cables approach the group border, not the rack.
        const obstacles: RouteRect[] = [
          ...layout.clusters.map(clusterFrameRect),
          ...layout.instances
            .filter(
              (instance) =>
                !this.instanceCluster.has(instance.id) &&
                instance.id !== from.id &&
                instance.id !== to.id,
            )
            .map((instance) =>
              clusterFrameRect(
                this.borderFrames.get(`${INSTANCE_KEY}${instance.id}`)!,
              ),
            ),
        ];
        const route = routeOrthogonal(fromAnchor, toAnchor, obstacles);
        worldPath = [
          ...(fromPort ? [fromPoint] : []),
          ...route,
          ...(toPort ? [toPoint] : []),
        ];
      }
      const projected = worldPath.map((point) =>
        project(point.x, point.y, from.position.z + 4),
      );
      this.wirePaths.set(connectionId, {
        from: link.from,
        to: link.to,
        points: projected.map((point) => [point[0], point[1]]),
      });
      const d = `M${projected[0].join(" ")}${projected
        .slice(1)
        .map((point) => `L${point.join(" ")}`)
        .join("")}`;

      const group = document.createElementNS(NS, "g");
      group.classList.add("connection");
      group.dataset.connectionId = connectionId;
      group.style.setProperty("--cable-color", from.color);
      group.innerHTML = `<path class="wire-glow" d="${d}"/><path class="wire" d="${d}"/><path class="pulse" pathLength="100" style="--duration:3s;--delay:${-index * 0.6}s" d="${d}"/>`;
      if (link.relation) {
        const lane = labelLanes.get(d) ?? 0;
        labelLanes.set(d, lane + 1);
        const point = cableLabelPoint(
          projected,
          CABLE_LABEL_OFFSET + lane * CABLE_LABEL_STACK,
        );
        if (point) {
          const label = document.createElementNS(NS, "text");
          label.classList.add("wire-label");
          label.dataset.connectionId = connectionId;
          label.setAttribute("x", point[0].toFixed(1));
          label.setAttribute("y", point[1].toFixed(1));
          label.setAttribute("text-anchor", "middle");
          // Match long instance labels: condense rather than clip so the
          // full relation stays available on the canvas.
          if (link.relation.length > CABLE_LABEL_MAX_CHARS) {
            label.setAttribute("textLength", String(CABLE_LABEL_WIDTH));
            label.setAttribute("lengthAdjust", "spacingAndGlyphs");
          }
          label.textContent = link.relation;
          group.append(label);
        }
      }
      if (fromCluster && fromCluster === toCluster) {
        group.dataset.clusterId = fromCluster;
      }
      // Ported endpoints on declared clusters are observable without
      // re-deriving geometry in tests and debugging; synthetic single-node
      // borders keep their diagnostics off so cluster link counting stays
      // about clusters. Internal links only carry the shared cluster id above.
      if (fromCluster && fromFrame) group.dataset.fromCluster = fromFrame.id;
      if (toCluster && toFrame) group.dataset.toCluster = toFrame.id;
      layer.append(group);
    }

    if (!animate) {
      for (const id of this.skinMorphs.keys()) this.endSkinMorph(id);
      this.renderedInstances.clear();
      this.content.replaceChildren();
    }
    // Only static geometry is replaced. Existing roots stay connected so CSS
    // animation timelines and painted component geometry survive rapid clicks.
    const previousGeometry = this.content
      .firstElementChild as SVGGElement | null;
    if (previousGeometry) {
      // Borders are recreated each render, so capture their old projected
      // rectangles first and let the fresh path start under an affine
      // transform. The dashed hit target then follows the drawn line.
      const previousFrames = new Map<string, string>();
      if (providerTransition)
        for (const path of previousGeometry.querySelectorAll<SVGPathElement>(
          ".scene-frame",
        )) {
          const key = path.dataset.clusterId;
          if (key) previousFrames.set(key, path.getAttribute("d") ?? "");
        }
      this.animateNodeFrames(previousFrames, layer, providerTransition);

      // A provider change can reshape the merged platform. Reuse the outgoing
      // group as a fading underlay and fade the incoming group in, which is two
      // animated groups instead of duplicating the whole platform markup.
      const previousPlatforms = providerTransition
        ? previousGeometry.querySelector<SVGGElement>(".platforms")
        : null;
      if (previousPlatforms) {
        previousPlatforms.classList.remove("platforms");
        previousPlatforms.classList.add("platform-ghost");
        previousGeometry.replaceWith(previousPlatforms);
        this.content.insertBefore(layer, previousPlatforms.nextSibling);
        layer
          .querySelector<SVGGElement>(".platforms")
          ?.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 460,
            easing: "ease-out",
          });
        const fade = previousPlatforms.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 460, easing: "ease-out", fill: "forwards" },
        );
        void fade.finished
          .catch(() => undefined)
          .then(() => previousPlatforms.remove());
      } else previousGeometry.replaceWith(layer);
    } else this.content.append(layer);
    const liveIds = new Set(layout.instances.map((instance) => instance.id));
    for (const [id, record] of this.renderedInstances) {
      if (liveIds.has(id)) continue;
      this.endSkinMorph(id);
      record.root.remove();
      this.renderedInstances.delete(id);
    }
    const orderedRoots: SVGGElement[] = [];
    for (const instance of layout.instances
      .slice()
      .sort(
        (a, b) =>
          a.position.x + a.position.y - (b.position.x + b.position.y) ||
          a.position.z - b.position.z,
      )) {
      const position = project(
        instance.position.x,
        instance.position.y,
        instance.position.z,
      );
      let record = this.renderedInstances.get(instance.id);
      const isNew = !record;
      if (
        record &&
        (record.label !== instance.label ||
          record.type !== instance.type ||
          record.provider !== instance.provider)
      ) {
        const skinChanged =
          record.type !== instance.type ||
          record.provider !== instance.provider;
        if (animate && skinChanged) {
          const element = createComponent(instance, { motion: detailed }),
            { origin, placed } = record;
          // Reset the placement root before the skin is measured. The new
          // element is built at the current projected point, and the ghost
          // carries its own old-position offset, so parts measure against
          // the destination instead of inheriting the previous frame's shift.
          record.root.setAttribute("transform", "translate(0 0)");
          record.origin = position;
          record.placed = position;
          this.startSkinMorph(
            instance.id,
            record.slot,
            record.element,
            element,
            {
              shift: {
                fromX: placed[0] - origin[0],
                fromY: placed[1] - origin[1],
                toX: position[0] - origin[0],
                toY: position[1] - origin[1],
              },
              maxParts: partBudget,
              detailed,
              motion: detailed ? null : () => createComponentMotion(instance),
            },
          );
          record.element = element;
          record.label = instance.label;
          record.type = instance.type;
          if (instance.provider === undefined) delete record.provider;
          else record.provider = instance.provider;
        } else {
          this.endSkinMorph(instance.id);
          record.root.remove();
          this.renderedInstances.delete(instance.id);
          record = undefined;
        }
      }
      if (!record) {
        const element = createComponent(instance);
        const root = document.createElementNS(NS, "g"),
          slot = document.createElementNS(NS, "g");
        root.classList.add("instance-placement");
        // The slot gives a skin swap a stable animation target without ever
        // touching the identity root or the projected `<g>` transform.
        if (animate && isNew) slot.classList.add("instance-enter");
        slot.append(element);
        root.append(slot);
        record = {
          root,
          slot,
          element,
          origin: position,
          placed: position,
          label: instance.label,
          type: instance.type,
          ...(instance.provider === undefined
            ? {}
            : { provider: instance.provider }),
          hidden: false,
        };
        this.renderedInstances.set(instance.id, record);
      }
      record.root.setAttribute(
        "transform",
        `translate(${position[0] - record.origin[0]} ${position[1] - record.origin[1]})`,
      );
      record.placed = position;
      const clusterId = this.instanceCluster.get(instance.id);
      if (clusterId) record.element.dataset.clusterId = clusterId;
      else delete record.element.dataset.clusterId;
      record.element.style.setProperty("--cable-color", instance.color);
      record.element
        .querySelector<SVGGElement>(".database-rack")
        ?.style.setProperty("--cable-color", instance.color);
      orderedRoots.push(record.root);
    }
    // State-preserving moves retain CSS animation progress even if a layout
    // change alters painter order. Newly created roots have no state to retain.
    let next: SVGGElement | null = null;
    for (let index = orderedRoots.length - 1; index >= 0; index--) {
      const root = orderedRoots[index];
      if (!root.isConnected) this.content.insertBefore(root, next);
      else if (root.nextSibling !== next) {
        // `moveBefore` preserves a live drop animation; older browsers fall
        // back to a regular move, which may restart that animation but keeps
        // the drag alive instead of throwing mid-gesture.
        if (typeof this.content.moveBefore === "function")
          this.content.moveBefore(root, next);
        else this.content.insertBefore(root, next);
      }
      next = root;
    }
    const extent = contentExtent(layout),
      pad = 55,
      // The hover callout is screen-space and hangs above the topmost rack,
      // so the fitted view keeps extra headroom above the drawing. The bottom
      // pad clears the projected cluster caption.
      topPad = pad + 90,
      bottomPad = pad + 40;

    // Padding leaves room for labels and cable bows without shrinking the
    // racks to a postage stamp. The 200-unit floor keeps an empty scene valid.
    this.contentBounds = {
      x: extent.minX - pad,
      y: extent.minY - topPad,
      width: Math.max(200, extent.maxX - extent.minX + 2 * pad),
      height: Math.max(200, extent.maxY - extent.minY + topPad + bottomPad),
    };
    if (!animate) this.fit();
    else {
      // Static geometry changes without a viewport write, so refresh root
      // visibility here. Non-animated renders get the same pass from fit().
      const width = this.base.width / this.zoom,
        height = this.base.height / this.zoom;
      this.cullInstances(
        this.center[0] - width / 2,
        this.center[1] - height / 2,
        this.center[0] + width / 2,
        this.center[1] + height / 2,
      );
    }
    this.componentRaster.sync();
    this.componentRaster.setScale(
      (this.viewport.width * this.zoom) / this.base.width,
    );
    // A manual move can change which nodes cover the focused target's wires;
    // re-derive the dim set so it tracks the dragged layout.
    if (this.focusKey) this.setFocus(this.focusKey);
    // The grab handle is hosted on the SVG root, outside the replaced frame
    // layer and reordered roots, so it survives this render and keeps pointer
    // capture. Re-seat it on the new geometry and restore the hover border
    // that the replaced frame layer lost.
    if (this.anchorKey) {
      this.updateAnchorPosition();
      this.setHoveredFrame(this.anchorKey);
    }
    // An animated render moves geometry without a camera write (node drag,
    // replica edit); let screen-space overlays re-anchor to the new bounds.
    // Non-animated renders fit the camera and already notify view listeners.
    if (animate) for (const listener of this.layoutListeners) listener();
  }

  /**
   * Cancel an in-flight skin morph and release its transient DOM.
   *
   * Restores the incoming skin's part holders (so the raster cache sees the
   * real structure), drops the outgoing ghost, and clears the raster skip
   * marker. Safe to call for an instance without a morph.
   *
   * @param id - Stable instance id owning the morph.
   */
  private endSkinMorph(id: string): void {
    const morph = this.skinMorphs.get(id);
    if (!morph) return;
    this.skinMorphs.delete(id);
    for (const animation of morph.animations) animation.cancel();
    morph.ghost.remove();
    this.restoreSkinParts(morph.wraps, morph.geometry);
  }

  /**
   * Rebuild a provider skin part by part.
   *
   * The incoming skin replaces the outgoing one synchronously, so no blank
   * frame is painted. Every top-level paint group of the incoming design —
   * and of the outgoing design in detailed mode — gets its own animation
   * holder: incoming parts rise from below and settle, outgoing parts lift
   * and fade, staggered from the bottom of the drawing upward. The outgoing
   * skin still glides between derived positions when a footprint change moves
   * the node. When many skins swap at once both sides cross-fade as whole
   * layers and the live detail is mounted afterwards, which keeps the
   * animation count low without leaving the node static.
   *
   * Nothing names a provider or renderer pair. Part lists come from the
   * rendered DOM, so any future skin participates automatically. A shared
   * animation budget chunks complex skins in detailed mode; larger swaps use
   * one whole-skin cross-fade. All motion uses only `transform` and `opacity`
   * — no path geometry, filters, or clip paths animate. Reduced motion swaps
   * the DOM without motion.
   *
   * @param id - Stable instance id.
   * @param slot - Holder whose single child is the skin.
   * @param outgoing - Element being replaced.
   * @param incoming - Newly rendered element.
   * @param options - Transition parameters: ghost glide, per-skin part cap,
   *   whether to build parts, and a lazy live-detail layer for bulk swaps.
   */
  private startSkinMorph(
    id: string,
    slot: SVGGElement,
    outgoing: SVGGElement,
    incoming: SVGGElement,
    options: {
      shift: { fromX: number; fromY: number; toX: number; toY: number };
      maxParts: number;
      detailed: boolean;
      motion: (() => SVGGElement | null) | null;
    },
  ): void {
    const { shift, maxParts, detailed, motion } = options;
    this.endSkinMorph(id);
    slot.classList.remove("instance-enter");
    for (const animation of slot.getAnimations()) animation.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      slot.replaceChildren(incoming);
      return;
    }

    // Part-level ghosts need real vectors; one cached bitmap cannot animate
    // as individual pieces. Bulk swaps keep the bitmap, which is far cheaper
    // to carry, and fade it as one layer.
    if (detailed) this.componentRaster.materializeVectors(outgoing);
    // Reuse the outgoing node instead of cloning it: it leaves the slot in
    // this same frame, and moving it avoids duplicating cached images or a
    // whole vector tree for every swapping replica.
    const ghost = document.createElementNS(NS, "g"),
      outgoingSkin = outgoing;
    ghost.classList.add("skin-ghost");
    outgoingSkin.classList.remove("scene-instance");
    outgoingSkin.removeAttribute("data-instance-id");
    outgoingSkin.removeAttribute("data-cluster-id");
    outgoingSkin.removeAttribute("role");
    outgoingSkin.removeAttribute("aria-label");
    outgoingSkin.setAttribute("aria-hidden", "true");
    for (const part of outgoingSkin.querySelectorAll(
      "[data-renderer-type],[data-renderer-provider],[data-skin-morph]",
    )) {
      part.removeAttribute("data-renderer-type");
      part.removeAttribute("data-renderer-provider");
      part.removeAttribute("data-skin-morph");
    }
    // Live detail on a departing skin would double compositor work for the
    // whole rebuild. The incoming skin carries the motion instead.
    outgoingSkin.querySelector(".component-motion")?.remove();
    ghost.append(outgoingSkin);
    slot.replaceChildren(incoming);
    slot.before(ghost);

    const geometry = incoming.querySelector<SVGGElement>(
      "[data-renderer-type]",
    );
    geometry?.setAttribute("data-skin-morph", "true");

    const ghostMotion = detailed
        ? this.wrapSkinParts(ghost, maxParts, "disperse")
        : { wraps: [], animations: [] },
      incomingMotion = detailed
        ? this.wrapSkinParts(incoming, maxParts, "assemble")
        : {
            wraps: [],
            animations: [
              // Bulk fallback: one opacity/rise per object. The outgoing
              // ghost still fades and the layout still glides, but no part
              // wrappers are created for a cluster-sized swap.
              slot.animate(
                [
                  { opacity: 0, transform: "translateY(14px)" },
                  { opacity: 1, transform: "translateY(0px)" },
                ],
                {
                  duration: 360,
                  easing: "cubic-bezier(0.22, 0.9, 0.24, 1)",
                  fill: "backwards",
                },
              ),
            ],
          };

    // Fade-mode ghosts carry opacity in the glide; part-mode ghosts only
    // glide while their parts fade independently.
    const ghostGlide = ghost.animate(
      [
        {
          opacity: 1,
          transform: `translate(${shift.fromX}px,${shift.fromY}px)`,
        },
        {
          opacity: detailed ? 1 : 0,
          transform: `translate(${shift.toX}px,${shift.toY}px)`,
        },
      ],
      {
        duration: detailed ? 520 : 420,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        fill: "forwards",
      },
    );
    const animations = [
      ghostGlide,
      ...ghostMotion.animations,
      ...incomingMotion.animations,
    ];
    const state = {
      ghost,
      animations,
      wraps: incomingMotion.wraps,
      geometry,
      motion,
    };
    this.skinMorphs.set(id, state);
    void Promise.allSettled(
      animations.map((animation) => animation.finished),
    ).then(() => {
      // A newer morph (or deletion) owns the slot now; keep its state.
      if (this.skinMorphs.get(id) !== state) return;
      this.skinMorphs.delete(id);
      ghost.remove();
      if (state.motion && state.geometry) {
        const live = state.motion();
        if (live)
          state.geometry.insertBefore(
            live,
            state.geometry.querySelector(".component-label"),
          );
      }
      this.restoreSkinParts(state.wraps, state.geometry);
      // The final vectors can now be measured and shared again.
      this.componentRaster.sync();
    });
  }

  /**
   * Wrap a rendered skin's paint groups in animatable holders.
   *
   * Only top-level paint groups are wrapped, so painter order and per-part
   * geometry stay untouched. Contiguous static children are chunked when a
   * skin exceeds its part allowance; the motion layer, static overlay, and
   * label remain whole because they cross paint boundaries. Each animated
   * side uses the same budget, which keeps the total animation count
   * independent of provider complexity.
   *
   * Measurements are geometry bounds taken after every wrapper exists: no
   * document layout is forced per part. Directions are normalized within the
   * skin, and the travel distance is scaled by camera zoom so the motion
   * reads the same at overview and close-up.
   *
   * @param root - `.scene-instance` wrapper being assembled or dispersed.
   * @param maxParts - Maximum holders for this skin.
   * @param direction - Assemble upward, or disperse upward while fading.
   * @returns Holders to unwrap and their running animations.
   */
  private wrapSkinParts(
    root: SVGGElement,
    maxParts: number,
    direction: "assemble" | "disperse",
  ): { wraps: SkinPartWrap[]; animations: Animation[] } {
    const base = root.querySelector<SVGGElement>(".component-static-base"),
      reserved = [
        root.querySelector<SVGGElement>(".component-motion"),
        root.querySelector<SVGGElement>(".component-static-overlay"),
        root.querySelector<SVGGElement>(".component-label"),
      ].filter((part): part is SVGGElement => part !== null),
      staticParts = base ? [...base.children] : [],
      staticBudget = Math.max(1, maxParts - reserved.length),
      chunkSize = Math.max(1, Math.ceil(staticParts.length / staticBudget)),
      groups: Element[][] = [];

    for (let index = 0; index < staticParts.length; index += chunkSize)
      groups.push(staticParts.slice(index, index + chunkSize));
    for (const part of reserved) groups.push([part]);

    const wraps: SkinPartWrap[] = [];
    for (const group of groups) {
      const first = group[0];
      if (!first?.parentNode) continue;
      const wrapper = document.createElementNS(NS, "g");
      wrapper.classList.add("skin-part");
      first.before(wrapper);
      wrapper.append(...group);
      wraps.push({ wrapper, parts: group });
    }

    // Geometry bounds, not viewport rects: measuring ten skins must not force
    // ten document layouts. All wrappers share the root's ancestor transform,
    // so their `getBBox()` values are directly comparable and carry no camera
    // scale. One try/catch per part keeps a detached/display:none group inert.
    const measured: { wrap: SkinPartWrap; box: DOMRect }[] = [];
    for (const wrap of wraps)
      try {
        const box = wrap.wrapper.getBBox();
        if (box.width > 0.01 || box.height > 0.01) measured.push({ wrap, box });
      } catch {
        // Detached or unrenderable holder: leave it out of the animation.
      }
    const active = new Map(measured.map(({ wrap }) => [wrap, true]));
    for (const wrap of wraps)
      if (!active.has(wrap)) wrap.wrapper.replaceWith(...wrap.parts);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const { box } of measured) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
    const centerX = (minX + maxX) / 2,
      centerY = (minY + maxY) / 2,
      halfWidth = Math.max(1, (maxX - minX) / 2),
      halfHeight = Math.max(1, (maxY - minY) / 2),
      pixelsPerUnit = Math.max(
        0.05,
        (this.viewport.width * this.zoom) / Math.max(1, this.base.width),
      ),
      outward = Math.min(40, 12 / pixelsPerUnit),
      lift = Math.min(48, 16 / pixelsPerUnit);
    const animations: Animation[] = [],
      // Up to 340ms of stagger: further parts wait long enough to read as a
      // sequence, while a single complex skin still settles under a second.
      step = Math.min(24, 340 / Math.max(1, measured.length));
    measured.sort((a, b) => b.box.y + b.box.height - (a.box.y + a.box.height));
    for (const [index, { wrap, box }] of measured.entries()) {
      const nx = Math.max(
          -1,
          Math.min(1, (box.x + box.width / 2 - centerX) / halfWidth),
        ),
        ny = Math.max(
          -1,
          Math.min(1, (box.y + box.height / 2 - centerY) / halfHeight),
        ),
        offsetX = nx * outward,
        offsetY = ny * outward,
        delay = index * step;
      animations.push(
        direction === "assemble"
          ? wrap.wrapper.animate(
              [
                {
                  opacity: 0,
                  transform: `translate(${offsetX}px, ${offsetY + lift}px)`,
                },
                { opacity: 1, offset: 0.45 },
                { opacity: 1, transform: "translate(0px, 0px)" },
              ],
              {
                duration: 440,
                delay,
                easing: "cubic-bezier(0.22, 0.9, 0.24, 1)",
                fill: "backwards",
              },
            )
          : wrap.wrapper.animate(
              [
                { opacity: 1, transform: "translate(0px, 0px)" },
                {
                  opacity: 0,
                  transform: `translate(${offsetX}px, ${offsetY - lift}px)`,
                },
              ],
              {
                duration: 400,
                delay,
                easing: "cubic-bezier(0.4, 0, 0.6, 1)",
                fill: "forwards",
              },
            ),
      );
    }
    return {
      wraps: measured.map(({ wrap }) => wrap),
      animations,
    };
  }

  /**
   * Restore animated part holders to plain paint groups.
   *
   * Idempotent: holders already replaced are skipped. Called when a build
   * settles and when a newer render cancels it, so the raster cache always
   * observes the same DOM shape it expects from a static skin.
   *
   * @param wraps - Holders created by `wrapSkinParts`.
   * @param geometry - Geometry root carrying the skip marker.
   */
  private restoreSkinParts(
    wraps: readonly SkinPartWrap[],
    geometry: SVGGElement | null,
  ): void {
    for (const { wrapper, parts } of wraps)
      if (wrapper.isConnected) wrapper.replaceWith(...parts);
    geometry?.removeAttribute("data-skin-morph");
  }

  /**
   * Animate borders from their previous projected rectangle to the new one.
   *
   * A border is an axis-aligned world rectangle projected isometrically, so
   * every bounds change is affine. The fresh path keeps its final `d` and
   * starts under the inverse matrix: only `transform` runs, and hit testing
   * follows the drawn line because the pointer target moves with it. Frames
   * past the budget snap instead of allocating more compositor layers.
   *
   * @param previous - Previous `d` per border key.
   * @param layer - Fresh node-frame layer.
   * @param animate - False for reduced motion or an initial render.
   */
  private animateNodeFrames(
    previous: ReadonlyMap<string, string>,
    layer: SVGGElement,
    animate: boolean,
  ): void {
    if (!animate) return;
    let count = 0;
    for (const path of layer.querySelectorAll<SVGPathElement>(".scene-frame")) {
      if (count >= SKIN_FRAME_ANIMATION_BUDGET) break;
      const key = path.dataset.clusterId,
        before = key ? previous.get(key) : undefined,
        after = path.getAttribute("d");
      if (!before || !after || before === after) continue;
      const oldCorners = this.frameCorners(before),
        newCorners = this.frameCorners(after);
      if (!oldCorners || !newCorners) continue;
      const matrix = this.frameMatrix(newCorners, oldCorners);
      if (!matrix) continue;
      count += 1;
      path.animate(
        [
          { transform: `matrix(${matrix.join(", ")})` },
          { transform: "matrix(1, 0, 0, 1, 0, 0)" },
        ],
        { duration: 480, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
      );
    }
  }

  /**
   * Read the four corners of a projected border polygon.
   *
   * @param d - `M … L … L … L … Z` path data produced by `createNodeFrames`.
   * @returns Four screen points, or null when the path shape is unexpected.
   */
  private frameCorners(d: string): ScreenPoint[] | null {
    const values = d.match(/-?\d+(?:\.\d+)?/g);
    if (!values || values.length < 8) return null;
    return [0, 2, 4, 6].map((index) => {
      const point: ScreenPoint = [
        Number(values[index]),
        Number(values[index + 1]),
      ];
      return point;
    });
  }

  /**
   * Build the affine matrix that maps one parallelogram onto another.
   *
   * Both borders are projected rectangles, so three corresponding corners
   * determine the transform. Returning the matrix instead of interpolating
   * path data keeps the animation on the compositor-friendly transform path.
   *
   * @param from - Three source points (the incoming border).
   * @param to - Three matching target points (the previous border).
   * @returns CSS `matrix(a, b, c, d, e, f)`, or null for a degenerate source.
   */
  private frameMatrix(
    from: readonly ScreenPoint[],
    to: readonly ScreenPoint[],
  ): number[] | null {
    const [px, py] = from[0],
      ux = from[1][0] - px,
      uy = from[1][1] - py,
      vx = from[2][0] - px,
      vy = from[2][1] - py,
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-6) return null;
    const [qx, qy] = to[0],
      uX = to[1][0] - qx,
      uY = to[1][1] - qy,
      vX = to[2][0] - qx,
      vY = to[2][1] - qy,
      a = (uX * vy - vX * uy) / det,
      c = (vX * ux - uX * vx) / det,
      b = (uY * vy - vY * uy) / det,
      d = (vY * ux - uY * vx) / det,
      e = qx - (a * px + c * py),
      f = qy - (b * px + d * py);
    return [a, b, c, d, e, f];
  }

  /**
   * Resolve the hovered element's border id.
   *
   * A rack inside a declared cluster resolves to the cluster: the cluster is
   * one draggable group, so the whole group highlights and moves together. A
   * standalone instance resolves to its own `instance:<id>` border. Borders
   * and clustered racks carry `data-cluster-id`; the grab handle itself
   * resolves to its hosted border so entering the badge never detaches it.
   *
   * @param target - Event target (or related target) under the pointer.
   * @returns The border id, or null when the pointer is over nothing framed.
   */
  private frameIdOf(target: Element | null): string | null {
    if (target?.closest?.(".drag-anchor")) return this.anchorKey;
    const framed = target?.closest?.("[data-cluster-id]");
    if (framed) return framed.getAttribute("data-cluster-id");
    const instance = target
      ?.closest?.(".scene-instance")
      ?.getAttribute("data-instance-id");
    return instance ? `${INSTANCE_KEY}${instance}` : null;
  }

  /** Highlight the border of the hovered instance or declared cluster. */
  private setHoveredFrame(frameId: string | null): void {
    if (this.hoveredFrameId === frameId) return;
    this.hoveredFrameId = frameId;
    const frames =
      this.content.querySelectorAll<SVGPathElement>(".scene-frame");
    for (const frame of frames) {
      frame.classList.toggle("hovered", frame.dataset.clusterId === frameId);
    }
  }

  /**
   * Dim covered nodes and highlight the focused border.
   *
   * The focused frame uses the hover highlight color and marches its dash
   * until the key is cleared. Dimming applies only to nodes whose artwork
   * covers one of the focused target's cables.
   *
   * Racks always paint after the link layer, so any node whose projected
   * silhouette overlaps a cable hides that stretch of wire. When a target is
   * focused, exactly those covering nodes fade to a translucent silhouette
   * (`.focus-dimmed`) — including members of the focused cluster, so a
   * replica burying its own group's cable dims with the rest. Only the
   * directly selected single instance is exempt: its own cables emerge from
   * beneath it, and dimming the selection itself would read as a bug.
   *
   * Instance roots and this coverage data are rebuilt by `render`; call this
   * again after a re-render if the selection survived it.
   *
   * @param key - `instance:<id>` or `cluster:<id>` key from `focus()`, or
   *   null to restore the undimmed scene.
   */
  setFocus(key: string | null): void {
    if (key !== this.focusKey) this.focusStartedAt = performance.now();
    this.focusKey = key;
    const dimmed = this.focusCoveredIds(key),
      // Frame keys drop the `cluster:` prefix; instance frames already use
      // the full `instance:<id>` key.
      frameKey = key?.startsWith(CLUSTER_KEY)
        ? key.slice(CLUSTER_KEY.length)
        : key;
    this.svg.classList.toggle("focus-dim", dimmed.size > 0);
    for (const element of this.content.querySelectorAll<SVGGElement>(
      ".scene-instance",
    )) {
      const id = element.dataset.instanceId;
      if (id) element.classList.toggle("focus-dimmed", dimmed.has(id));
    }
    // The selected border keeps its highlight and marches; clearing the key
    // removes both, so the animation only runs while the focus is held. A
    // newly focused path (including one rebuilt by a render) starts from the
    // current phase instead of restarting the trace.
    for (const frame of this.content.querySelectorAll<SVGPathElement>(
      ".scene-frame",
    )) {
      const focused = frame.dataset.clusterId === frameKey;
      if (focused && !frame.classList.contains("focused"))
        frame.style.animationDelay = `${this.focusStartedAt - performance.now()}ms`;
      frame.classList.toggle("focused", focused);
    }
  }

  /**
   * Instance ids to dim while `key` is focused.
   *
   * Collects the focused members (one instance, or every member of a
   * cluster), keeps the wires attached to any of them, and returns every
   * instance whose silhouette one of those wires touches. Cluster members
   * compete on equal terms — only the focused single instance is skipped.
   * Wires are matched by endpoint instance id, which also covers
   * cluster-ported links: their `from`/`to` stay the member even though the
   * cable leaves the frame. A wire's own endpoint stretch is trimmed so the
   * endpoint is never dimmed merely for the cable emerging from it.
   *
   * @param key - Focus key from `focus()`, or null for an empty set.
   * @returns Instance ids that cover a focused wire and should dim.
   */
  private focusCoveredIds(key: string | null): Set<string> {
    const covered = new Set<string>();
    if (!key) return covered;
    const instanceId = key.startsWith(INSTANCE_KEY)
        ? key.slice(INSTANCE_KEY.length)
        : null,
      clusterId = key.startsWith(CLUSTER_KEY)
        ? key.slice(CLUSTER_KEY.length)
        : null;
    const members = new Set<string>();
    for (const element of this.content.querySelectorAll<SVGGElement>(
      ".scene-instance",
    )) {
      const id = element.dataset.instanceId;
      if (!id) continue;
      if (
        (instanceId !== null && id === instanceId) ||
        (clusterId !== null && element.dataset.clusterId === clusterId)
      )
        members.add(id);
    }
    if (members.size === 0) return covered;
    const relevant = [...this.wirePaths.values()].filter(
      (wire) => members.has(wire.from) || members.has(wire.to),
    );
    for (const [id, hull] of this.silhouettes) {
      if (id === instanceId) continue;
      for (const wire of relevant) {
        // The endpoint's own lead-in/lead-out is trimmed so a rack is not
        // dimmed just because its cable starts underneath it.
        const points =
          wire.from === id
            ? withoutEndpointUnder(wire.points, "from", hull)
            : wire.to === id
              ? withoutEndpointUnder(wire.points, "to", hull)
              : wire.points;
        if (polylineIntersectsPolygon(points, hull)) {
          covered.add(id);
          break;
        }
      }
    }
    return covered;
  }

  /**
   * Forget all manual placement offsets.
   *
   * Called when a different design is applied: offsets belong to one scene's
   * instance and cluster ids and must not leak into another document, whose
   * ids can repeat with different meaning. Replica edits keep the arrangement,
   * so they do not call this. The next `render` draws the derived layout
   * again.
   */
  clearOffsets(): void {
    this.dragOffsets.clear();
    this.clusterOffsets.clear();
  }

  /**
   * Hand manual offsets over when a replica edit changes what owns them.
   *
   * Dragging stores one offset per logical node: a cluster id for a group, or
   * an instance id for a standalone instance. `resizeReplicas` can promote a
   * standalone instance into a new cluster or collapse a cluster back to one
   * instance. Without this hand-off the promoted member would snap back to
   * the derived layout (and the new replica would appear at the original
   * slot), or the survivor would snap back after reducing to one.
   *
   * Runs after `instanceCluster` is rebuilt for the new design and before
   * `applyDragOffsets`. An existing group offset is kept, so adding a replica
   * to a moved cluster places it in its derived slot relative to the group.
   *
   * @param previousCluster - Instance-to-cluster map from the previous render.
   * @param design - New document, used to distinguish a surviving instance
   *   from one that was removed.
   */
  private reconcileOffsets(
    previousCluster: ReadonlyMap<string, string>,
    design: Design,
  ): void {
    const liveClusters = new Set(this.instanceCluster.values());
    // Standalone -> cluster: hand the instance's offset to the new group so
    // every member, including replicas added in the same edit, starts there.
    for (const clusterId of liveClusters) {
      if (this.clusterOffsets.has(clusterId)) continue;
      for (const [instanceId, owner] of this.instanceCluster) {
        if (owner !== clusterId) continue;
        const offset = this.dragOffsets.get(instanceId);
        if (!offset) continue;
        this.clusterOffsets.set(clusterId, { ...offset });
        break;
      }
    }
    // A grouped instance is positioned by its group offset; a per-instance
    // entry would be stale and could fight the group after a later collapse.
    for (const instanceId of this.instanceCluster.keys())
      this.dragOffsets.delete(instanceId);
    // Cluster -> standalone: the surviving member inherits the group offset
    // so reducing to one replica does not jump back to the derived layout.
    const liveInstances = new Set(
      design.instances.map((instance) => instance.id),
    );
    for (const [instanceId, clusterId] of previousCluster) {
      if (
        this.instanceCluster.has(instanceId) ||
        !liveInstances.has(instanceId)
      )
        continue;
      const offset = this.clusterOffsets.get(clusterId);
      if (offset) this.dragOffsets.set(instanceId, { ...offset });
    }
    // A removed cluster's offset must not leak into a future cluster that
    // happens to reuse the derived id.
    for (const clusterId of this.clusterOffsets.keys())
      if (!liveClusters.has(clusterId)) this.clusterOffsets.delete(clusterId);
  }

  /**
   * Shift placed instances by their manual drag offsets.
   *
   * Runs after the layout pass and before any geometry is derived, so
   * platforms, wires, routes, silhouettes, and target bounds all see the
   * moved positions. A cluster offset moves every member uniformly, which
   * also places replicas added after the drag in the correct slot relative
   * to the group; a standalone offset moves only its instance. Cluster bounds
   * are rebuilt from the member footprints so a dragged group keeps its
   * dashed frame and caption around the moved racks; for untouched clusters
   * that reconstruction equals the layout pass's own formula. Skipped
   * entirely while no offsets exist, keeping undragged scenes on the pure
   * derived path.
   *
   * @param layout - Layout output to mutate in place.
   */
  private applyDragOffsets(layout: Layout): void {
    if (this.dragOffsets.size === 0 && this.clusterOffsets.size === 0) return;
    for (const instance of layout.instances) {
      const clusterId = this.instanceCluster.get(instance.id),
        offset = clusterId
          ? this.clusterOffsets.get(clusterId)
          : this.dragOffsets.get(instance.id);
      if (!offset) continue;
      instance.position.x += offset.x;
      instance.position.y += offset.y;
    }
    const boxes = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (const instance of layout.instances) {
      const clusterId = this.instanceCluster.get(instance.id);
      if (!clusterId) continue;
      const { x, y } = instance.position,
        { halfWidth, halfDepth } = instanceFootprint(
          instance.type,
          instance.provider,
        ),
        left = x - halfWidth,
        right = x + halfWidth,
        top = y - halfDepth,
        bottom = y + halfDepth;
      const box = boxes.get(clusterId);
      if (!box)
        boxes.set(clusterId, {
          minX: left,
          minY: top,
          maxX: right,
          maxY: bottom,
        });
      else {
        box.minX = Math.min(box.minX, left);
        box.maxX = Math.max(box.maxX, right);
        box.minY = Math.min(box.minY, top);
        box.maxY = Math.max(box.maxY, bottom);
      }
    }
    for (const cluster of layout.clusters) {
      const box = boxes.get(cluster.id);
      if (!box) continue;
      cluster.bounds = {
        x: box.minX,
        y: box.minY,
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
      };
    }
  }

  /**
   * Show the grab handle for a node, or detach it.
   *
   * The handle is a single reused element hosted directly on the SVG root,
   * after the scene content, so replacing the frame layer or reordering
   * instance roots can never detach it or interrupt pointer capture.
   * `updateAnchorPosition` keeps it glued to the node's middle. Because it
   * lives outside the instance groups, a focus-dimmed node can never fade it,
   * and painter reordering can never bury it.
   *
   * @param frameId - Border id of the hovered node (`instance:<id>` for a
   *   standalone instance, the cluster id for a declared cluster), or null
   *   to detach.
   */
  private hostAnchor(frameId: string | null): void {
    if (this.anchorKey === frameId) return;
    this.anchorKey = frameId;
    if (!frameId) {
      this.anchor?.remove();
      return;
    }
    if (!this.anchor) this.anchor = this.buildAnchor();
    this.svg.append(this.anchor);
    this.updateAnchorPosition();
  }

  /**
   * Pin the grab handle to the middle of its node.
   *
   * The middle is the center of the node's screen-space bounding box (racks
   * included for clusters, artwork height included for single instances), so
   * the badge lands on open ground between rows for wide clusters and at
   * mid-height beside a single rack. Reads the bounds derived by the latest
   * render; a node that no longer exists detaches the handle, which is how
   * applying a new design cleans up a stale hover.
   */
  private updateAnchorPosition(): void {
    if (!this.anchor || !this.anchorKey) return;
    const bounds = this.targetBounds.get(
      this.anchorKey.startsWith(INSTANCE_KEY)
        ? this.anchorKey
        : `${CLUSTER_KEY}${this.anchorKey}`,
    );
    if (!bounds) {
      this.anchorKey = null;
      this.anchor.remove();
      return;
    }
    this.anchor.setAttribute(
      "transform",
      `translate(${((bounds.minX + bounds.maxX) / 2).toFixed(1)} ${(
        (bounds.minY + bounds.maxY) /
        2
      ).toFixed(1)})`,
    );
  }

  /**
   * Build the anchor grab handle with its drag gesture wired.
   *
   * The badge and anchor glyph are pure static markup; the invisible hit
   * circle roughly triples the grab area beyond the visible badge. Pointerdown
   * stops propagation so the scene's pan/select path never sees the gesture
   * (the SVG would otherwise capture the pointer and retarget every later
   * event away from the handle), and the handle takes its own capture so
   * the drag survives leaving the SVG. Movement is converted from client
   * pixels to SVG user units, then inverted through the ground-plane
   * projection so the node follows the cursor exactly; the whole scene
   * re-renders per move, which keeps wires re-routed around the dragged
   * node and cluster frames wrapped around moved members.
   *
   * @returns The handle element; listeners are attached once at creation.
   */
  private buildAnchor(): SVGGElement {
    const anchor = document.createElementNS(NS, "g");
    anchor.classList.add("drag-anchor");
    anchor.setAttribute("role", "button");
    anchor.setAttribute("aria-label", "Drag to reposition the node");
    anchor.innerHTML = `<circle class="anchor-badge" r="13"/><g class="anchor-glyph"><circle cx="0" cy="-5.4" r="2"/><path d="M0 -3.4V6.6M-4.4 -1.6H4.4M-6 2.4Q-6 7 0 7Q6 7 6 2.4"/><path d="M-7.6 1L-6 3.4L-4.4 1M7.6 1L6 3.4L4.4 1"/></g><circle class="anchor-hit" r="22"/>`;

    anchor.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !this.currentDesign || !this.anchorKey) return;
      event.preventDefault();
      event.stopPropagation();
      const start = this.clientToUser(event.clientX, event.clientY);
      if (!start) return;
      // The hovered node is one draggable unit: an instance moves alone, a
      // declared cluster moves every member together, keeping the group's
      // internal layout intact. Store the offset on the unit, not on each
      // member, so replicas added later inherit the group's position.
      const key = this.anchorKey,
        isInstance = key.startsWith(INSTANCE_KEY),
        ids = isInstance
          ? [key.slice(INSTANCE_KEY.length)]
          : [...this.instanceCluster]
              .filter(([, cluster]) => cluster === key)
              .map(([instance]) => instance);
      if (ids.length === 0) return;
      const base = isInstance
        ? (this.dragOffsets.get(ids[0]) ?? { x: 0, y: 0 })
        : (this.clusterOffsets.get(key) ?? { x: 0, y: 0 });
      this.anchorDrag = {
        pointerId: event.pointerId,
        start,
        key,
        base: { ...base },
      };
      anchor.setPointerCapture(event.pointerId);
      anchor.classList.add("dragging");
    });

    anchor.addEventListener("pointermove", (event) => {
      const drag = this.anchorDrag;
      if (!drag || drag.pointerId !== event.pointerId || !this.currentDesign)
        return;
      const now = this.clientToUser(event.clientX, event.clientY);
      if (!now) return;
      // Ground-plane inverse of `project`: screen right is +x/−y and screen
      // down is +x/+y in world space, so solving the 2×2 system makes the
      // node track the cursor one-to-one.
      const cos = Math.cos(Math.PI / 6),
        across = (now.x - drag.start.x) / (2 * cos),
        down = now.y - drag.start.y,
        offset = {
          x: drag.base.x + across + down,
          y: drag.base.y + down - across,
        };
      if (drag.key.startsWith(INSTANCE_KEY))
        this.dragOffsets.set(drag.key.slice(INSTANCE_KEY.length), offset);
      else this.clusterOffsets.set(drag.key, offset);
      this.render(this.currentDesign, true);
    });

    const endDrag = (event: PointerEvent): void => {
      const drag = this.anchorDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.anchorDrag = null;
      anchor.classList.remove("dragging");
      if (anchor.hasPointerCapture(event.pointerId))
        anchor.releasePointerCapture(event.pointerId);
    };
    anchor.addEventListener("pointerup", endDrag);
    anchor.addEventListener("pointercancel", endDrag);
    // Capture can disappear if the browser revokes it; end the gesture so
    // hover resolution and the next drag are not stuck behind `anchorDrag`.
    anchor.addEventListener("lostpointercapture", endDrag);
    return anchor;
  }

  /**
   * Subscribe to viewBox changes.
   *
   * Screen-space overlays (the pinned callout) use this to stay attached while
   * the camera animates, pans, or zooms. The scene never touches that markup.
   */
  onViewChange(listener: () => void): void {
    this.viewListeners.add(listener);
  }

  /**
   * Subscribe to geometry changes that leave the camera in place.
   *
   * Dragging a node or editing replicas re-renders the scene without a
   * viewBox write. Screen-space overlays use this to re-anchor a leader line
   * while keeping their card fixed.
   */
  onLayoutChange(listener: () => void): void {
    this.layoutListeners.add(listener);
  }

  /**
   * Smoothly frame a rendered target inside a client-space area.
   *
   * Selection frames the target in 40% of the free area beside the detail
   * panel, leaving room for context and the pinned callout instead of filling
   * the viewport tightly. Center and zoom interpolate together. Reduced-motion users jump
   * straight to the final frame; any pan, zoom, or fit cancels the move.
   *
   * @param key - `instance:<id>` or `cluster:<id>` key from the last render.
   * @param area - Client-space rectangle the target should fit inside.
   */
  focus(
    key: string,
    area: { x: number; y: number; width: number; height: number },
  ): void {
    const target = this.targetBounds.get(key);
    if (!target) return;
    const stage = this.viewport;
    if (!stage.width || !stage.height) return;

    const worldWidth = target.maxX - target.minX,
      worldHeight = target.maxY - target.minY;
    if (worldWidth <= 0 || worldHeight <= 0) return;

    // Client pixels per user unit is `stage.width * zoom / base.width`, so the
    // fit zoom is the smaller of the width and height solutions.
    const padding = 0.4,
      zoom = Math.max(
        MIN_ZOOM,
        Math.min(
          (area.width * padding * this.base.width) / (worldWidth * stage.width),
          (area.height * padding * this.base.height) /
            (worldHeight * stage.height),
          MAX_ZOOM,
        ),
      ),
      width = this.base.width / zoom,
      height = this.base.height / zoom,
      center: [number, number] = [
        (target.minX + target.maxX) / 2 -
          ((area.x + area.width / 2 - stage.left) / stage.width - 0.5) * width,
        (target.minY + target.maxY) / 2 -
          ((area.y + area.height / 2 - stage.top) / stage.height - 0.5) *
            height,
      ];
    this.animateCamera(center, zoom);
  }

  /**
   * Client-space point at the top center of a rendered target.
   *
   * The pinned callout uses this instead of `getBoundingClientRect()` on the
   * rack group: `<use>` instances can report stale geometry in Chromium, while
   * the projected layout point is always correct.
   */
  targetTopPoint(key: string): { x: number; y: number } | null {
    const point = this.topPoints.get(key),
      stage = this.viewport;
    // Cached stage rect keeps the per-frame callout update free of layout
    // reads; an unmeasured stage reports null like an invalid CTM would.
    if (!point || !stage.width || !stage.height) return null;
    const width = this.base.width / this.zoom,
      height = this.base.height / this.zoom;
    return {
      x:
        stage.left +
        ((point[0] - (this.center[0] - width / 2)) / width) * stage.width,
      y:
        stage.top +
        ((point[1] - (this.center[1] - height / 2)) / height) * stage.height,
    };
  }

  /**
   * Follow the latest destination with a critically damped spring.
   *
   * Retargeting preserves position and velocity instead of restarting ease-in.
   * Log-space zoom keeps proportional scale changes even. The exact spring
   * solution is stable across variable frame times and allocates nothing per frame.
   */
  private animateCamera(target: [number, number], zoom: number): void {
    const logZoom = Math.log(zoom);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.stopCamera();
      this.center = target;
      this.zoom = zoom;
      this.updateViewport();
      // No spring will settle, so release pulse suppression here.
      this.endNavigation();
      return;
    }

    if (this.cameraMotion) {
      this.cameraMotion.target[0] = target[0];
      this.cameraMotion.target[1] = target[1];
      this.cameraMotion.target[2] = logZoom;
      return;
    }
    // Per-rack pulse motion is suppressed while the camera glides. The spring
    // owns the class until it settles; the idle timer's checks then no-op.
    this.markNavigating();
    const motion = {
      position: [this.center[0], this.center[1], Math.log(this.zoom)] as [
        number,
        number,
        number,
      ],
      target: [target[0], target[1], logZoom] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
      time: performance.now(),
    };
    this.cameraMotion = motion;
    // 18/s gives a prompt glide without overshooting a stationary destination.
    const frequency = 18;
    const step = (now: number) => {
      const dt = Math.max(0, (now - motion.time) / 1000);
      motion.time = now;
      const decay = Math.exp(-frequency * dt);
      const worldTolerance =
        (this.base.width / this.zoom / this.viewport.width) * 0.05;
      let settled = true;
      for (let axis = 0; axis < 3; axis++) {
        const error = motion.position[axis] - motion.target[axis];
        const impulse = motion.velocity[axis] + frequency * error;
        motion.position[axis] =
          motion.target[axis] + (error + impulse * dt) * decay;
        motion.velocity[axis] =
          (motion.velocity[axis] - frequency * impulse * dt) * decay;
        const tolerance = axis === 2 ? 0.00001 : worldTolerance;
        if (
          Math.abs(motion.position[axis] - motion.target[axis]) > tolerance ||
          Math.abs(motion.velocity[axis]) > tolerance * frequency
        )
          settled = false;
      }
      if (settled) {
        this.center[0] = motion.target[0];
        this.center[1] = motion.target[1];
        this.zoom = Math.exp(motion.target[2]);
        this.cameraMotion = null;
      } else {
        this.center[0] = motion.position[0];
        this.center[1] = motion.position[1];
        this.zoom = Math.exp(motion.position[2]);
      }
      this.updateViewport();
      this.cameraFrame = settled ? null : requestAnimationFrame(step);
      if (settled) this.endNavigation();
    };
    this.cameraFrame = requestAnimationFrame(step);
  }

  /** Cancel an in-flight camera move so a gesture or fit takes over. */
  private stopCamera(): void {
    this.cameraMotion = null;
    if (this.cameraFrame !== null) cancelAnimationFrame(this.cameraFrame);
    this.cameraFrame = null;
  }

  /**
   * Enter the navigating state that pauses per-rack pulse animations.
   *
   * Cheap for per-frame gesture callers: while a timer already exists this is
   * only a class add. An existing timer is extended only for wheel input,
   * which has no end event; continuous panning/pinching reuses the active
   * timer and lets its guard observe the live pointers.
   *
   * @param extendIdle - Restart the quiet period (wheel debounce).
   */
  private markNavigating(extendIdle = false): void {
    this.svg.classList.add("navigating");
    if (this.navigationTimer !== null) {
      if (!extendIdle) return;
      clearTimeout(this.navigationTimer);
    }
    this.navigationTimer = window.setTimeout(() => {
      this.navigationTimer = null;
      // The spring and pointer gestures clear the class when they end.
      if (this.cameraFrame !== null || this.activePointers.size > 0) return;
      this.svg.classList.remove("navigating");
    }, NAVIGATION_IDLE_MS);
  }

  /**
   * Leave the navigating state once nothing is moving the camera.
   *
   * Called when the spring settles or the last contact lifts, so pulses
   * resume as soon as navigation stops instead of waiting out the wheel
   * debounce. A still-active source keeps ownership of the class.
   */
  private endNavigation(): void {
    if (this.navigationTimer !== null) {
      clearTimeout(this.navigationTimer);
      this.navigationTimer = null;
    }
    if (this.cameraFrame !== null || this.activePointers.size > 0) return;
    this.svg.classList.remove("navigating");
  }

  /** Reset zoom and pan so the whole design is framed again. */
  fit(): void {
    this.stopCamera();
    this.zoom = 1;
    this.center = [
      this.contentBounds.x + this.contentBounds.width / 2,
      this.contentBounds.y + this.contentBounds.height / 2,
    ];
    this.resize();
    // Fit is an instant jump, not a sustained navigation; never leave pulses
    // suppressed by a cancelled spring.
    this.endNavigation();
  }

  /**
   * Zoom by a multiplicative factor, optionally keeping a client point fixed.
   *
   * @param factor - >1 zooms in, <1 zooms out. Result is clamped.
   * @param clientX - Cursor client X; omit for center-anchored zoom.
   * @param clientY - Cursor client Y; omit for center-anchored zoom.
   *
   * Anchor math: if `r = oldZoom / newZoom`, then the new center must be
   * `anchor - (anchor - oldCenter) * r` so the anchor's world point remains
   * under the same screen pixel.
   */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    // Mark before the clamp: wheel input at the zoom limit still counts as
    // navigation, and a cancelled spring must never leave pulses suppressed.
    // Wheel and zoom buttons have no end event, so they debounce the state.
    this.markNavigating(true);
    const next = this.clampZoom(factor);
    if (next === this.zoom) return;

    const anchor =
      clientX === undefined || clientY === undefined
        ? null
        : this.clientToUser(clientX, clientY);
    if (anchor) {
      const ratio = this.zoom / next;
      this.center[0] = anchor.x - (anchor.x - this.center[0]) * ratio;
      this.center[1] = anchor.y - (anchor.y - this.center[1]) * ratio;
    }
    this.zoom = next;
    this.updateViewport();
  }

  /** Clamp a multiplicative zoom factor to the supported range. */
  private clampZoom(factor: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  /** Apply the latest pointer positions in one viewport update. */
  private applyPointerUpdate(): void {
    if (this.activePointers.size >= 2) {
      if (!this.pinch) return;
      const next = this.pinchState();
      if (!next) return;
      this.applyPinch(this.pinch, next);
      this.pinch = next;
      return;
    }

    if (this.dragPointer === null || !this.lastPointer) return;
    const point = this.activePointers.get(this.dragPointer);
    if (!point) return;
    this.panBetween(this.lastPointer, point);
    this.lastPointer = { ...point };
  }

  /** Queue a pointer update for the next paint, if none is pending. */
  private schedulePointerUpdate(): void {
    if (this.pointerFrame !== null) return;
    this.pointerFrame = requestAnimationFrame(() => {
      this.pointerFrame = null;
      this.applyPointerUpdate();
    });
  }

  /**
   * Apply a queued pointer update immediately.
   *
   * Pointer-up must not drop the final move of a short gesture. Cancelling the
   * frame here, before the contact is removed, keeps the final pan/zoom and the
   * gesture-state transition atomic.
   */
  private flushPointerUpdate(): void {
    if (this.pointerFrame === null) return;
    cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = null;
    this.applyPointerUpdate();
  }

  /**
   * Apply a two-finger zoom and midpoint pan in one viewport write.
   *
   * Anchoring the zoom at the previous midpoint and then shifting by the
   * midpoint delta keeps the world point under the fingers fixed. Doing both
   * operations here avoids the intermediate viewport/grid write that a
   * `zoomBy` followed by `panBetween` would perform on every frame.
   */
  private applyPinch(
    previous: { distance: number; midpoint: { x: number; y: number } },
    next: { distance: number; midpoint: { x: number; y: number } },
  ): void {
    const scale =
      previous.distance > 0 && next.distance > 0
        ? next.distance / previous.distance
        : 1;
    const nextZoom = this.clampZoom(scale);
    const dx = next.midpoint.x - previous.midpoint.x;
    const dy = next.midpoint.y - previous.midpoint.y;
    if (nextZoom === this.zoom && dx === 0 && dy === 0) return;
    this.markNavigating();

    if (nextZoom !== this.zoom) {
      const anchor = this.clientToUser(
        previous.midpoint.x,
        previous.midpoint.y,
      );
      if (anchor) {
        const ratio = this.zoom / nextZoom;
        this.center[0] = anchor.x - (anchor.x - this.center[0]) * ratio;
        this.center[1] = anchor.y - (anchor.y - this.center[1]) * ratio;
      }
      this.zoom = nextZoom;
    }

    // Base and viewport aspects match after `resize`, so one scale converts
    // both axes. Guard zero-sized layouts during startup and teardown.
    if (this.viewport.width > 0) {
      const unitsPerPixel = this.base.width / this.zoom / this.viewport.width;
      this.center[0] -= dx * unitsPerPixel;
      this.center[1] -= dy * unitsPerPixel;
    }
    this.updateViewport();
  }

  /**
   * Move the view so the world point under `from` follows it to `to`.
   *
   * Both points are client-space pixels from the same pointer event. The
   * conversion uses the cached stage mapping, so this works while pinching
   * (after the zoom anchor has already been applied) and while panning.
   */
  private panBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const a = this.clientToUser(from.x, from.y),
      b = this.clientToUser(to.x, to.y);
    if (!a || !b) return;
    // Stationary contacts can still emit moves; only moving the view counts.
    if (a.x === b.x && a.y === b.y) return;
    this.markNavigating();
    // Move the world with the fingers by moving the viewBox center opposite.
    this.center[0] -= b.x - a.x;
    this.center[1] -= b.y - a.y;
    this.updateViewport();
  }

  /**
   * Current span and midpoint of the first two active contacts.
   *
   * Returns null until two pointers are down. Map insertion order keeps the
   * first two contacts stable for the whole gesture, so adding a third finger
   * cannot make the pinch target jump between contacts.
   */
  private pinchState(): {
    distance: number;
    midpoint: { x: number; y: number };
  } | null {
    const [first, second] = this.activePointers.values();
    if (!first || !second) return null;
    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
    };
  }

  /**
   * Match the base viewBox to the viewport aspect ratio.
   *
   * `preserveAspectRatio="meet"` would letterbox a mismatched viewBox and the
   * grid would stop at the bars, so the base rectangle is expanded to the
   * element's aspect. Current center and zoom are preserved, which makes this
   * safe to call from ResizeObserver as well as `fit`.
   */
  private resize(): void {
    // Once per layout change is the only place that needs the client rect.
    // The stage SVG is fixed and full-viewport, so pan/zoom can reuse it.
    const bounds = this.svg.getBoundingClientRect();
    this.viewport = {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    const aspect =
      bounds.width && bounds.height ? bounds.width / bounds.height : 4 / 3;
    let width = this.contentBounds.width,
      height = this.contentBounds.height;
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
    this.base = { width, height };
    this.updateViewport();
  }

  /**
   * Write the viewBox, refresh grid coverage, and select scale-appropriate detail.
   *
   * This is the single writer for both values, keeping zoom, pan, resize, and
   * grid coverage consistent. Called during drag, so it must stay cheap.
   */
  private updateViewport(): void {
    const width = this.base.width / this.zoom,
      height = this.base.height / this.zoom,
      x = this.center[0] - width / 2,
      y = this.center[1] - height / 2;
    this.svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    // Hysteresis avoids detail flicker while zoom hovers near the cutoff.
    const rackPixels =
      (componentHeight("database-rack") * this.viewport.width) / width;
    this.svg.classList.toggle(
      "rack-overview",
      rackPixels < (this.svg.classList.contains("rack-overview") ? 160 : 130),
    );
    this.drawGrid(x, y, width, height);
    this.cullInstances(x, y, x + width, y + height);
    this.componentRaster.setScale(this.viewport.width / width);
    for (const listener of this.viewListeners) listener();
  }

  /**
   * Hide instance roots whose projected bounds fall outside the view.
   *
   * Bounds come from the layout pass (`targetBounds`), never `getBBox()` or
   * `getBoundingClientRect()`, so culling adds no forced layout to the camera
   * path. Hiding the outer root with `visibility` keeps the component subtree
   * and its CSS animation timeline alive: panning back shows the same state,
   * and an in-flight entry drop is never replayed or restarted.
   */
  private cullInstances(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const left = minX - INSTANCE_CULL_MARGIN,
      top = minY - INSTANCE_CULL_MARGIN,
      right = maxX + INSTANCE_CULL_MARGIN,
      bottom = maxY + INSTANCE_CULL_MARGIN;
    for (const [id, record] of this.renderedInstances) {
      const bounds = this.targetBounds.get(`${INSTANCE_KEY}${id}`),
        // Missing bounds only happens before the first layout; stay visible.
        hidden =
          bounds !== undefined &&
          (bounds.maxX < left ||
            bounds.minX > right ||
            bounds.maxY < top ||
            bounds.minY > bottom);
      if (record.hidden === hidden) continue;
      record.hidden = hidden;
      record.root.style.visibility = hidden ? "hidden" : "visible";
    }
  }

  /**
   * Cache an overscanned world-space grid around the view.
   *
   * Camera frames reuse the same path while inside its coverage. Quantized
   * endpoints keep lines stable when the cache is rebuilt. Adaptive spacing
   * caps the overscanned geometry around 320 lines per axis at very low zoom.
   *
   * @param x - ViewBox x in SVG user units.
   * @param y - ViewBox y in SVG user units.
   * @param width - ViewBox width in SVG user units.
   * @param height - ViewBox height in SVG user units.
   */
  private drawGrid(x: number, y: number, width: number, height: number): void {
    const cosine = Math.cos(Math.PI / 6);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    // Inverse of project(x, y, 0): x = sy + sx / (2C), y = sy - sx / (2C).
    for (const [screenX, screenY] of [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x + width, y + height],
    ]) {
      const worldX = screenY + screenX / (2 * cosine),
        worldY = screenY - screenX / (2 * cosine);
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      minY = Math.min(minY, worldY);
      maxY = Math.max(maxY, worldY);
    }

    // Adaptive level of detail: never emit unbounded geometry when zoomed out.
    let step = 120;
    const spanX = maxX - minX,
      spanY = maxY - minY;
    while ((Math.max(spanX, spanY) * 1.5) / step > 320) step *= 2;
    const cached = this.gridCoverage;
    if (
      cached &&
      cached.step === step &&
      minX >= cached.minX &&
      maxX <= cached.maxX &&
      minY >= cached.minY &&
      maxY <= cached.maxY
    )
      return;
    const startX = Math.floor((minX - spanX * 0.25) / step) * step,
      startY = Math.floor((minY - spanY * 0.25) / step) * step,
      endX = Math.ceil((maxX + spanX * 0.25) / step) * step,
      endY = Math.ceil((maxY + spanY * 0.25) / step) * step;
    this.gridCoverage = {
      minX: startX,
      maxX: endX,
      minY: startY,
      maxY: endY,
      step,
    };
    const at = (wx: number, wy: number) =>
      project(wx, wy, 0)
        .map((n) => n.toFixed(1))
        .join(" ");
    let d = "";
    for (let gx = startX; gx <= endX; gx += step)
      d += `M${at(gx, startY)}L${at(gx, endY)}`;
    for (let gy = startY; gy <= endY; gy += step)
      d += `M${at(startX, gy)}L${at(endX, gy)}`;
    this.grid.setAttribute("d", d);
  }

  /**
   * Convert client pixels to SVG user units using the cached stage rectangle.
   *
   * The root SVG is a fixed full-stage element whose viewBox aspect matches
   * its client rectangle after `resize`, so the mapping is the viewBox origin
   * plus a uniform scale. Computing it arithmetically avoids a synchronous
   * `getScreenCTM()`/layout read on every pan, pinch, and wheel frame.
   * Returns null until the stage has a measured, non-zero size.
   */
  private clientToUser(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const stage = this.viewport;
    if (!stage.width || !stage.height) return null;
    const width = this.base.width / this.zoom,
      height = this.base.height / this.zoom;
    return {
      x:
        this.center[0] -
        width / 2 +
        ((clientX - stage.left) / stage.width) * width,
      y:
        this.center[1] -
        height / 2 +
        ((clientY - stage.top) / stage.height) * height,
    };
  }
}
