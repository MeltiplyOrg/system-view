import {
  createDatabaseDefinitions,
  DATABASE_ANCHOR,
  DatabaseRack,
  project,
} from "./database";
import type { Design } from "./design";
import { createPlatforms } from "./platform";

const NS = "http://www.w3.org/2000/svg";

/** Zoom bounds chosen to keep the grid usable at both extreme scales. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

/**
 * Owns the full-viewport SVG scene.
 *
 * Responsibilities: shared rack definitions, the isometric grid, design
 * layers, fit behavior, wheel zoom, and pointer panning. It never renders UI
 * chrome; the overlay/sidebar state belongs to `main.ts`. The instance lives
 * for the page lifetime, so its event listeners are intentionally permanent.
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

  /** Current viewBox center in SVG user units. */
  private center: [number, number] = [0, 0];

  /** Multiplicative zoom, clamped to MIN_ZOOM…MAX_ZOOM. */
  private zoom = 1;

  /** Active pointer for panning, or null when idle. */
  private dragPointer: number | null = null;

  /** Last client-space pointer position while dragging. */
  private lastPointer: { x: number; y: number } | null = null;

  /**
   * @param svg Full-viewport SVG element. The caller should not append other
   *   defs or content; this class owns its child order.
   *
   * The constructor wires a non-passive wheel handler and the pointer-capture
   * lifecycle. A ResizeObserver re-derives the base viewBox without resetting
   * the user's zoom or pan. No cleanup is provided because the scene is a
   * page-lifetime singleton.
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
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.zoomBy(factor, event.clientX, event.clientY);
      },
      { passive: false },
    );

    svg.addEventListener("pointerdown", (event) => {
      // Primary button only: secondary clicks and context menus stay native.
      if (event.button !== 0) return;
      event.preventDefault();
      this.dragPointer = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      // Capture keeps the drag alive when the pointer leaves the SVG.
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("dragging");
    });

    svg.addEventListener("pointermove", (event) => {
      if (this.dragPointer !== event.pointerId || !this.lastPointer) return;
      const from = this.clientToUser(this.lastPointer.x, this.lastPointer.y),
        to = this.clientToUser(event.clientX, event.clientY);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!from || !to) return;
      // Move the world with the pointer by moving the viewBox center opposite.
      this.center[0] -= to.x - from.x;
      this.center[1] -= to.y - from.y;
      this.updateViewport();
    });

    // One idempotent stop path for pointerup, pointercancel, and lost capture.
    const stopDragging = (event: PointerEvent) => {
      if (this.dragPointer !== event.pointerId) return;
      this.dragPointer = null;
      this.lastPointer = null;
      svg.classList.remove("dragging");
      if (svg.hasPointerCapture(event.pointerId))
        svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", stopDragging);
    svg.addEventListener("pointercancel", stopDragging);
    svg.addEventListener("lostpointercapture", stopDragging);
  }

  /**
   * Replace the scene content atomically and refit the view.
   *
   * Paint order is platforms, links, then racks back-to-front. Isometric depth
   * is `x + y` (larger is nearer) with `z` as a tie-breaker. Bounds are taken
   * from this content only, never the regenerating grid, so fit stays stable.
   *
   * @param design - Already validated document. The defensive endpoint check
   *   protects against callers bypassing the parser.
   * @throws Error when a connection references a missing node.
   */
  render(design: Design): void {
    const layer = document.createElementNS(NS, "g");
    layer.append(createPlatforms(design.nodes));

    const byId = new Map(design.nodes.map((node) => [node.id, node]));
    for (const [index, link] of design.connections.entries()) {
      const from = byId.get(link.from),
        to = byId.get(link.to);
      if (!from || !to)
        throw new Error(`Connection ${link.id} references an unknown node.`);

      // Links attach just above the base. The quadratic control point at the
      // source Y / target X approximates an orthogonal cable while staying
      // smooth at iso angles; elevated nodes keep their own z endpoints.
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
      group.dataset.connectionId = link.id;
      group.style.setProperty("--cable-color", link.color);
      group.innerHTML = `<path class="wire-glow" d="${d}"/><path class="wire" d="${d}"/><path class="pulse" pathLength="100" style="--duration:3s;--delay:${-index * 0.6}s" d="${d}"/>`;
      const title = document.createElementNS(NS, "title");
      title.textContent = `${link.id}: ${from.label} → ${to.label}`;
      group.prepend(title);
      layer.append(group);
    }

    // Back to front; no depth sorting or geometry generation during animation.
    for (const node of design.nodes
      .slice()
      .sort(
        (a, b) =>
          a.position.x + a.position.y - (b.position.x + b.position.y) ||
          a.position.z - b.position.z,
      )) {
      const object = new DatabaseRack(node),
        p = project(node.position.x, node.position.y, node.position.z);
      object.element.setAttribute(
        "transform",
        `translate(${p[0] - DATABASE_ANCHOR[0]} ${p[1] - DATABASE_ANCHOR[1]})`,
      );
      layer.append(object.element);
    }

    this.content.replaceChildren(layer);
    const bounds = layer.getBBox(),
      pad = 55;

    // Padding leaves room for labels and cable bows without shrinking the
    // racks to a postage stamp. The 200-unit floor keeps an empty scene valid.
    this.contentBounds = {
      x: bounds.x - pad,
      y: bounds.y - pad,
      width: Math.max(200, bounds.width + 2 * pad),
      height: Math.max(200, bounds.height + 2 * pad),
    };
    this.fit();
  }

  /** Reset zoom and pan so the whole design is framed again. */
  fit(): void {
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
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
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

  /**
   * Match the base viewBox to the viewport aspect ratio.
   *
   * `preserveAspectRatio="meet"` would letterbox a mismatched viewBox and the
   * grid would stop at the bars, so the base rectangle is expanded to the
   * element's aspect. Current center and zoom are preserved, which makes this
   * safe to call from ResizeObserver as well as `fit`.
   */
  private resize(): void {
    const bounds = this.svg.getBoundingClientRect(),
      aspect =
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
