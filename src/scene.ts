import {
  createDatabaseDefinitions,
  DATABASE_ANCHOR,
  DATABASE_HEIGHT,
  DatabaseRack,
  project,
} from "./database";
import type { Design } from "./design";
import { layoutDesign, RACK_HALF_DEPTH, RACK_HALF_WIDTH } from "./layout";
import type { Layout, PlacedCluster } from "./layout";
import { createPlatforms } from "./platform";

const NS = "http://www.w3.org/2000/svg";

/** Zoom bounds chosen to keep the grid usable at both extreme scales. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

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
        for (const dz of [0, DATABASE_HEIGHT]) add(x + dx, y + dy, z + dz);
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
  /** Design content group replaced atomically on each render. */
  private readonly content = document.createElementNS(NS, "g");

  /** Single path regenerated for the currently visible world region. */
  private readonly grid = document.createElementNS(NS, "path");

  /** Projected design bounds plus breathing room, set by `render`. */
  private contentBounds = { x: -500, y: -350, width: 1000, height: 700 };

  /** Aspect-matched base viewBox at zoom 1. */
  private base = { width: 1000, height: 700 };

  /** Last CSS-pixel size observed by the ResizeObserver. */
  private viewport = { width: 1, height: 1 };

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

  /** Pending requestAnimationFrame id for the camera move, if any. */
  private cameraFrame: number | null = null;

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
   * Replace the scene content atomically and refit the view.
   *
   * Layout and colors are derived here rather than stored in the document.
   * Paint order is cluster frames, platforms, cluster captions, links, then
   * racks back-to-front. Isometric depth is `x + y` (larger is nearer) with
   * `z` as a tie-breaker. Bounds are taken from this content only, never the
   * regenerating grid, so fit stays stable.
   *
   * @param design - Already validated document. The defensive endpoint check
   *   protects against callers bypassing the parser.
   * @throws Error when a connection references a missing instance.
   */
  render(design: Design): void {
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
    const clusterTops = new Map<string, readonly [number, number]>();
    const clusterBounds = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (const instance of layout.instances) {
      const { x, y, z } = instance.position,
        top = project(x, y, z + DATABASE_HEIGHT),
        key = `instance:${instance.id}`,
        bounds = {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
        };
      this.topPoints.set(key, top);
      for (const dx of [-RACK_HALF_WIDTH, RACK_HALF_WIDTH])
        for (const dy of [-RACK_HALF_DEPTH, RACK_HALF_DEPTH])
          for (const dz of [0, DATABASE_HEIGHT]) {
            const [screenX, screenY] = project(x + dx, y + dy, z + dz);
            bounds.minX = Math.min(bounds.minX, screenX);
            bounds.maxX = Math.max(bounds.maxX, screenX);
            bounds.minY = Math.min(bounds.minY, screenY);
            bounds.maxY = Math.max(bounds.maxY, screenY);
          }
      this.targetBounds.set(key, bounds);

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
    for (const [index, link] of design.connections.entries()) {
      const from = byId.get(link.from),
        to = byId.get(link.to);
      const connectionId = link.id ?? `${link.from}->${link.to}`;
      if (!from || !to)
        throw new Error(
          `Connection ${connectionId} references an unknown instance.`,
        );

      // Links attach just above the base. The quadratic control point at the
      // source Y / target X approximates an orthogonal cable while staying
      // smooth at iso angles; elevated instances keep their own z endpoints.
      const a = project(from.position.x, from.position.y, from.position.z + 4);
      const b = project(to.position.x, to.position.y, to.position.z + 4);
      const middle = project(
        to.position.x,
        from.position.y,
        Math.min(from.position.z, to.position.z) + 4,
      );
      const d = `M${a.join(" ")}Q${middle.join(" ")} ${b.join(" ")}`;

      const group = document.createElementNS(NS, "g");
      group.classList.add("connection");
      group.dataset.connectionId = connectionId;
      group.style.setProperty("--cable-color", from.color);
      group.innerHTML = `<path class="wire-glow" d="${d}"/><path class="wire" d="${d}"/><path class="pulse" pathLength="100" style="--duration:3s;--delay:${-index * 0.6}s" d="${d}"/>`;
      const fromCluster = instanceCluster.get(from.id),
        toCluster = instanceCluster.get(to.id);
      if (fromCluster && fromCluster === toCluster) {
        group.dataset.clusterId = fromCluster;
      }
      layer.append(group);
    }

    // Back to front; no depth sorting or geometry generation during animation.
    for (const instance of layout.instances
      .slice()
      .sort(
        (a, b) =>
          a.position.x + a.position.y - (b.position.x + b.position.y) ||
          a.position.z - b.position.z,
      )) {
      const object = new DatabaseRack(instance),
        p = project(
          instance.position.x,
          instance.position.y,
          instance.position.z,
        );
      object.element.setAttribute(
        "transform",
        `translate(${p[0] - DATABASE_ANCHOR[0]} ${p[1] - DATABASE_ANCHOR[1]})`,
      );
      const clusterId = instanceCluster.get(instance.id);
      if (clusterId) {
        object.element.dataset.clusterId = clusterId;
      }
      layer.append(object.element);
    }

    this.content.replaceChildren(layer);
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
    this.fit();
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
   * Selection uses this to fill the free area beside the detail panel: the
   * zoom is solved so the target's projected bounds fit with a small margin,
   * then center and zoom are interpolated together. Reduced-motion users jump
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
    const box = this.svg.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const worldWidth = target.maxX - target.minX,
      worldHeight = target.maxY - target.minY;
    if (worldWidth <= 0 || worldHeight <= 0) return;

    // Client pixels per user unit is `box.width * zoom / base.width`, so the
    // fit zoom is the smaller of the width and height solutions.
    const padding = 0.86,
      zoom = Math.max(
        MIN_ZOOM,
        Math.min(
          (area.width * padding * this.base.width) / (worldWidth * box.width),
          (area.height * padding * this.base.height) /
            (worldHeight * box.height),
          MAX_ZOOM,
        ),
      ),
      width = this.base.width / zoom,
      height = this.base.height / zoom,
      center: [number, number] = [
        (target.minX + target.maxX) / 2 -
          ((area.x + area.width / 2 - box.left) / box.width - 0.5) * width,
        (target.minY + target.maxY) / 2 -
          ((area.y + area.height / 2 - box.top) / box.height - 0.5) * height,
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
    const point = this.topPoints.get(key);
    if (!point) return null;
    const bounds = this.svg.getBoundingClientRect(),
      width = this.base.width / this.zoom,
      height = this.base.height / this.zoom;
    return {
      x:
        bounds.left +
        ((point[0] - (this.center[0] - width / 2)) / width) * bounds.width,
      y:
        bounds.top +
        ((point[1] - (this.center[1] - height / 2)) / height) * bounds.height,
    };
  }

  /**
   * Interpolate center and zoom together, or jump under reduced motion.
   *
   * Zoom is interpolated geometrically (`from * ratio ** t`) so the perceived
   * zoom rate stays even instead of accelerating near the end.
   */
  private animateCamera(target: [number, number], zoom: number): void {
    this.stopCamera();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.center = target;
      this.zoom = zoom;
      this.updateViewport();
      return;
    }

    const from: [number, number] = [this.center[0], this.center[1]],
      fromZoom = this.zoom,
      ratio = zoom / fromZoom,
      duration = 620,
      start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.center[0] = from[0] + (target[0] - from[0]) * eased;
      this.center[1] = from[1] + (target[1] - from[1]) * eased;
      this.zoom = fromZoom * ratio ** eased;
      this.updateViewport();
      this.cameraFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    this.cameraFrame = requestAnimationFrame(step);
  }

  /** Cancel an in-flight camera move so a gesture or fit takes over. */
  private stopCamera(): void {
    if (this.cameraFrame === null) return;
    cancelAnimationFrame(this.cameraFrame);
    this.cameraFrame = null;
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
   * conversion uses the current CTM, so this works while pinching (after the
   * zoom anchor has already been applied) and while panning.
   */
  private panBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const a = this.clientToUser(from.x, from.y),
      b = this.clientToUser(to.x, to.y);
    if (!a || !b) return;
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
    const bounds = this.svg.getBoundingClientRect();
    this.viewport = { width: bounds.width, height: bounds.height };
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
   * Write the current viewBox and repaint the grid.
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
    this.drawGrid(x, y, width, height);
    for (const listener of this.viewListeners) listener();
  }

  /**
   * Regenerate grid lines for the visible world region.
   *
   * Inverts the isometric projection at z=0 to find the world-space bounding
   * box of the viewBox, then emits only lines inside it. This makes the grid
   * effectively infinite without a large prebuilt path. Line count is capped
   * around 320 per axis by doubling the world step at very low zoom.
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
    while (Math.max(maxX - minX, maxY - minY) / step > 320) step *= 2;
    const startX = Math.floor(minX / step) * step,
      startY = Math.floor(minY / step) * step;
    const at = (wx: number, wy: number) =>
      project(wx, wy, 0)
        .map((n) => n.toFixed(1))
        .join(" ");
    let d = "";
    for (let gx = startX; gx <= maxX; gx += step)
      d += `M${at(gx, minY)}L${at(gx, maxY)}`;
    for (let gy = startY; gy <= maxY; gy += step)
      d += `M${at(minX, gy)}L${at(maxX, gy)}`;
    this.grid.setAttribute("d", d);
  }

  /**
   * Convert client pixels to SVG user units using the inverse screen CTM.
   *
   * Using the CTM accounts for CSS sizing, viewBox scaling, and markers, so
   * zoom anchoring and pan deltas remain correct at any layout. Returns null
   * before the element has a rendered matrix (for example, during teardown).
   */
  private clientToUser(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return null;
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const projected = point.matrixTransform(matrix.inverse());
    return { x: projected.x, y: projected.y };
  }
}
