import { createDatabaseDefinitions, project } from "./database";
import type { Design } from "./design";
import { layoutDesign, RACK_HALF_DEPTH, RACK_HALF_WIDTH } from "./layout";
import type { Layout, PlacedCluster } from "./layout";
import { createPlatforms } from "./platform";
import { componentHeight, createComponent } from "./components";
import { ComponentRasterCache } from "./component-raster";
import { routeOrthogonal } from "./routing";
import type { RoutePoint, RouteRect } from "./routing";

const NS = "http://www.w3.org/2000/svg";

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
  if (((crossA > 0 && crossB < 0) || (crossA < 0 && crossB > 0)) &&
      ((crossC > 0 && crossD < 0) || (crossC < 0 && crossD > 0)))
    return true;
  return (
    (crossA === 0 && Math.min(c[0], d[0]) <= a[0] && a[0] <= Math.max(c[0], d[0]) &&
      Math.min(c[1], d[1]) <= a[1] && a[1] <= Math.max(c[1], d[1])) ||
    (crossB === 0 && Math.min(c[0], d[0]) <= b[0] && b[0] <= Math.max(c[0], d[0]) &&
      Math.min(c[1], d[1]) <= b[1] && b[1] <= Math.max(c[1], d[1])) ||
    (crossC === 0 && Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1])) ||
    (crossD === 0 && Math.min(a[0], b[0]) <= d[0] && d[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= d[1] && d[1] <= Math.max(a[1], b[1]))
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
  if (points.some((point) => pointInConvexPolygon(point, polygon)))
    return true;
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
 * Adjacent cluster frames stay at least 60 world units apart (the 420-unit
 * base pitch minus two 180-unit frame halves; overflow replica rows only
 * widen the gap), so a 30-unit stub stays in the gap and still leaves room
 * on both sides. The fixed outward leg also guarantees the cable meets the
 * border at a right angle instead of riding along it.
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
    const { x, y, z } = instance.position;
    for (const dx of [-RACK_HALF_WIDTH, RACK_HALF_WIDTH])
      for (const dy of [-RACK_HALF_DEPTH, RACK_HALF_DEPTH])
        for (const dz of [0, componentHeight(instance.type)])
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

/**
 * Point where a link meets a cluster boundary on its way to another node.
 *
 * Links keep addressing the specific member recorded in the document, but an
 * external link attaches to the replica set as a whole. The ray from that
 * member to the other endpoint chooses the facing frame edge, and the port is
 * that edge's midpoint so wires do not meet the border off-center. Links whose
 * two endpoints share a cluster bypass this helper and keep their rack-to-rack
 * endpoints.
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
  const left = cluster.bounds.x - CLUSTER_FRAME_MARGIN,
    right = cluster.bounds.x + cluster.bounds.width + CLUSTER_FRAME_MARGIN,
    top = cluster.bounds.y - CLUSTER_FRAME_MARGIN,
    bottom = cluster.bounds.y + cluster.bounds.height + CLUSTER_FRAME_MARGIN,
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
  // A valid external target makes the ray leave through this edge. The port
  // still centers on the edge when unvalidated groups overlap the target.
  const centerX = (left + right) / 2,
    centerY = (top + bottom) / 2;
  switch (edge) {
    case "left":
      return { x: left, y: centerY, edge };
    case "right":
      return { x: right, y: centerY, edge };
    case "top":
      return { x: centerX, y: top, edge };
    case "bottom":
      return { x: centerX, y: bottom, edge };
  }
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

/** World-space rectangle covered by a cluster's dashed frame. */
function clusterFrameRect(cluster: PlacedCluster): RouteRect {
  return {
    x: cluster.bounds.x - CLUSTER_FRAME_MARGIN,
    y: cluster.bounds.y - CLUSTER_FRAME_MARGIN,
    width: cluster.bounds.width + CLUSTER_FRAME_MARGIN * 2,
    height: cluster.bounds.height + CLUSTER_FRAME_MARGIN * 2,
  };
}

/** World-space rectangle covered by one instance's platform. */
function instanceRect(instance: {
  position: { x: number; y: number };
}): RouteRect {
  return {
    x: instance.position.x - RACK_HALF_WIDTH,
    y: instance.position.y - RACK_HALF_DEPTH,
    width: RACK_HALF_WIDTH * 2,
    height: RACK_HALF_DEPTH * 2,
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
 * Build one dashed floor frame per declared cluster.
 *
 * A frame is the cluster's world-space bounds expanded by
 * `CLUSTER_FRAME_MARGIN` and projected at z=0, so it lies flat on the grid and
 * follows the isometric axes. The expanded rectangle clears the shared plinth,
 * Frames highlight in yellow when their cluster is hovered; `data-cluster-id`
 * ties each frame to its cluster members and caption.
 */
function createClusterFrames(clusters: readonly PlacedCluster[]): SVGGElement {
  const group = document.createElementNS(NS, "g");
  group.classList.add("cluster-frames");
  for (const cluster of clusters) {
    const { x, y, width, height } = cluster.bounds,
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
    const frame = document.createElementNS(NS, "path");
    frame.classList.add("cluster-frame");
    frame.dataset.clusterId = cluster.id;
    frame.setAttribute(
      "d",
      `M${corners
        .map(([cornerX, cornerY]) =>
          [cornerX, cornerY].map((n) => n.toFixed(1)).join(" "),
        )
        .join("L")}Z`,
    );
    group.append(frame);
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
      element: SVGGElement;
      origin: readonly [number, number];
      label: string;
      type: string;
      /** Cached root visibility so pans only write style on state changes. */
      hidden: boolean;
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

  /** ID of the cluster currently hovered by the pointer, if any. */
  private hoveredClusterId: string | null = null;

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

    svg.addEventListener("pointerover", (event) => {
      const target = (event.target as Element | null)?.closest?.(
        "[data-cluster-id]",
      );
      this.setHoveredCluster(target?.getAttribute("data-cluster-id") ?? null);
    });

    svg.addEventListener("pointerout", (event) => {
      const related = (event.relatedTarget as Element | null)?.closest?.(
        "[data-cluster-id]",
      );
      this.setHoveredCluster(related?.getAttribute("data-cluster-id") ?? null);
    });

    svg.addEventListener("pointerleave", () => {
      this.setHoveredCluster(null);
    });
  }

  /**
   * Render geometry and reconcile keyed components without interrupting drops.
   *
   * Layout and colors are derived here rather than stored in the document.
   * Paint order is cluster frames, platforms, cluster captions, links, then
   * racks back-to-front. Isometric depth is `x + y` (larger is nearer) with
   * `z` as a tie-breaker. Bounds are taken from this content only, never the
   * regenerating grid, so fit stays stable.
   *
   * @param design - Already validated document. The defensive endpoint check
   *   protects against callers bypassing the parser.
   * @param animate - Preserve live components/camera and drop in new replicas.
   * @throws Error when a connection references a missing instance.
   */
  render(design: Design, animate = false): void {
    this.hoveredClusterId = null;
    const instanceCluster = new Map<string, string>();
    for (const [index, cluster] of design.clusters.entries()) {
      const clusterId = cluster.id ?? `cluster-${index + 1}`;
      for (const instanceId of cluster.instances) {
        instanceCluster.set(instanceId, clusterId);
      }
    }
    const layout = layoutDesign(design);

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
        top = project(x, y, z + componentHeight(instance.type)),
        key = `instance:${instance.id}`,
        bounds = {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
        };
      this.topPoints.set(key, top);
      const corners: ScreenPoint[] = [];
      for (const dx of [-RACK_HALF_WIDTH, RACK_HALF_WIDTH])
        for (const dy of [-RACK_HALF_DEPTH, RACK_HALF_DEPTH])
          for (const dz of [0, componentHeight(instance.type)]) {
            const [screenX, screenY] = project(x + dx, y + dy, z + dz);
            corners.push([screenX, screenY]);
            bounds.minX = Math.min(bounds.minX, screenX);
            bounds.maxX = Math.max(bounds.maxX, screenX);
            bounds.minY = Math.min(bounds.minY, screenY);
            bounds.maxY = Math.max(bounds.maxY, screenY);
          }
      this.targetBounds.set(key, bounds);
      this.silhouettes.set(instance.id, convexHull(corners));

      const clusterId = instanceCluster.get(instance.id);
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
      this.topPoints.set(`cluster:${clusterId}`, top);
    for (const [clusterId, bounds] of clusterBounds)
      this.targetBounds.set(`cluster:${clusterId}`, bounds);

    const layer = document.createElementNS(NS, "g");
    layer.append(
      createClusterFrames(layout.clusters),
      createPlatforms(layout.instances),
      createClusterLabels(layout.clusters),
    );

    const byId = new Map(
      layout.instances.map((instance) => [instance.id, instance]),
    );
    const clusterById = new Map(
      layout.clusters.map((cluster) => [cluster.id, cluster]),
    );
    // Links share one projected path when they land on the same cluster port,
    // not only when they repeat an endpoint pair. Keying the lane on the drawn
    // route therefore stacks every caption that would otherwise overprint.
    const labelLanes = new Map<string, number>();
    for (const [index, link] of design.connections.entries()) {
      const from = byId.get(link.from),
        to = byId.get(link.to);
      const connectionId = link.id ?? `${link.from}->${link.to}`;
      if (!from || !to)
        throw new Error(
          `Connection ${connectionId} references an unknown instance.`,
        );

      // Boundary-crossing links attach to the cluster frame, not the member
      // rack. Internal links keep both rack endpoints so replication stays
      // inside the group. The far endpoint's position sets the side of the
      // frame the cable approaches from.
      const fromCluster = instanceCluster.get(from.id),
        toCluster = instanceCluster.get(to.id),
        fromFrame =
          fromCluster === undefined || fromCluster === toCluster
            ? undefined
            : clusterById.get(fromCluster),
        toFrame =
          toCluster === undefined || toCluster === fromCluster
            ? undefined
            : clusterById.get(toCluster),
        fromPort = fromFrame
          ? clusterPort(fromFrame, from.position, to.position)
          : undefined,
        toPort = toFrame
          ? clusterPort(toFrame, to.position, from.position)
          : undefined,
        fromPoint = fromPort ?? from.position,
        toPoint = toPort ?? to.position;

      // Cables follow world X/Y axes with sharp projected corners. External
      // routes detour around cluster frames and unclustered platforms so a
      // cable is not hidden behind artwork for most of its length. Same-cluster
      // replication stays rack-to-rack, with the existing parallel lane for a
      // member skipped in the same row.
      const internal = fromCluster !== undefined && fromCluster === toCluster;
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
        const laneY = fromPoint.y + RACK_HALF_DEPTH * 2;
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
        // Clustered racks are covered by their frame; unclustered platform
        // footprints stay obstacles so a cable cannot disappear under a
        // standalone cache or database.
        const obstacles: RouteRect[] = [
          ...layout.clusters.map(clusterFrameRect),
          ...layout.instances
            .filter(
              (instance) =>
                !instanceCluster.has(instance.id) &&
                instance.id !== from.id &&
                instance.id !== to.id,
            )
            .map(instanceRect),
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
      // Ported endpoints are observable without re-deriving geometry in tests
      // and debugging; internal links only carry the shared cluster id above.
      if (fromFrame) group.dataset.fromCluster = fromFrame.id;
      if (toFrame) group.dataset.toCluster = toFrame.id;
      layer.append(group);
    }

    if (!animate) {
      this.renderedInstances.clear();
      this.content.replaceChildren();
    }
    // Only static geometry is replaced. Existing roots stay connected so CSS
    // animation timelines and painted component geometry survive rapid clicks.
    const previousGeometry = this.content.firstElementChild;
    if (previousGeometry) previousGeometry.replaceWith(layer);
    else this.content.append(layer);
    const liveIds = new Set(layout.instances.map((instance) => instance.id));
    for (const [id, record] of this.renderedInstances) {
      if (liveIds.has(id)) continue;
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
        (record.label !== instance.label || record.type !== instance.type)
      ) {
        record.root.remove();
        this.renderedInstances.delete(instance.id);
        record = undefined;
      }
      if (!record) {
        const element = createComponent(instance);
        const root = document.createElementNS(NS, "g");
        root.classList.add("instance-placement");
        if (animate && isNew) {
          const entry = document.createElementNS(NS, "g");
          entry.classList.add("instance-enter");
          entry.append(element);
          root.append(entry);
        } else root.append(element);
        record = {
          root,
          element,
          origin: position,
          label: instance.label,
          type: instance.type,
          hidden: false,
        };
        this.renderedInstances.set(instance.id, record);
      }
      record.root.setAttribute(
        "transform",
        `translate(${position[0] - record.origin[0]} ${position[1] - record.origin[1]})`,
      );
      const clusterId = instanceCluster.get(instance.id);
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
      else if (root.nextSibling !== next) this.content.moveBefore(root, next);
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
  }

  /** Highlight the frame of the hovered cluster. */
  private setHoveredCluster(clusterId: string | null): void {
    if (this.hoveredClusterId === clusterId) return;
    this.hoveredClusterId = clusterId;
    const frames =
      this.content.querySelectorAll<SVGPathElement>(".cluster-frame");
    for (const frame of frames) {
      frame.classList.toggle("hovered", frame.dataset.clusterId === clusterId);
    }
  }

  /**
   * Dim only the nodes whose artwork covers the focused target's wires.
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
    const dimmed = this.focusCoveredIds(key);
    this.svg.classList.toggle("focus-dim", dimmed.size > 0);
    for (const element of this.content.querySelectorAll<SVGGElement>(
      ".scene-instance",
    )) {
      const id = element.dataset.instanceId;
      if (id) element.classList.toggle("focus-dimmed", dimmed.has(id));
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
    const instanceId = key.startsWith("instance:") ? key.slice(9) : null,
      clusterId = key.startsWith("cluster:") ? key.slice(8) : null;
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
   * Subscribe to viewBox changes.
   *
   * Screen-space overlays (the pinned callout) use this to stay attached while
   * the camera animates, pans, or zooms. The scene never touches that markup.
   */
  onViewChange(listener: () => void): void {
    this.viewListeners.add(listener);
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
      const bounds = this.targetBounds.get(`instance:${id}`),
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
