import type { Design } from "./design";
import {
  DatabaseRack,
  createDatabaseDefinitions,
  DATABASE_ANCHOR,
  project,
} from "./database";
import { createPlatforms } from "./platform";

const NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
export class SystemScene {
  private readonly content = document.createElementNS(NS, "g");
  private readonly grid = document.createElementNS(NS, "path");
  private contentBounds = { x: -500, y: -350, width: 1000, height: 700 };
  private base = { width: 1000, height: 700 };
  private center: [number, number] = [0, 0];
  private zoom = 1;
  private dragPointer: number | null = null;
  private lastPointer: { x: number; y: number } | null = null;

  constructor(private readonly svg: SVGSVGElement) {
    this.grid.classList.add("space-grid");
    svg.append(createDatabaseDefinitions(), this.grid, this.content);
    new ResizeObserver(() => this.resize()).observe(svg);
    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.zoomBy(factor, event.clientX, event.clientY);
      },
      { passive: false },
    );
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.dragPointer = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("dragging");
    });
    svg.addEventListener("pointermove", (event) => {
      if (this.dragPointer !== event.pointerId || !this.lastPointer) return;
      const from = this.clientToUser(this.lastPointer.x, this.lastPointer.y),
        to = this.clientToUser(event.clientX, event.clientY);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (!from || !to) return;
      this.center[0] -= to.x - from.x;
      this.center[1] -= to.y - from.y;
      this.updateViewport();
    });
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

  render(design: Design): void {
    const layer = document.createElementNS(NS, "g");
    layer.append(createPlatforms(design.nodes));
    const byId = new Map(design.nodes.map((node) => [node.id, node]));
    for (const [index, link] of design.connections.entries()) {
      const from = byId.get(link.from)!,
        to = byId.get(link.to)!;
      // Links attach to the base in model space; elevated nodes retain their z.
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
    this.contentBounds = {
      x: bounds.x - pad,
      y: bounds.y - pad,
      width: Math.max(200, bounds.width + 2 * pad),
      height: Math.max(200, bounds.height + 2 * pad),
    };
    this.fit();
  }

  fit(): void {
    this.zoom = 1;
    this.center = [
      this.contentBounds.x + this.contentBounds.width / 2,
      this.contentBounds.y + this.contentBounds.height / 2,
    ];
    this.resize();
  }

  /** Scroll or the sidebar buttons; an optional client anchor keeps the cursor fixed. */
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

  /** Match the base viewBox to the viewport so the grid fills every edge. */
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

  private updateViewport(): void {
    const width = this.base.width / this.zoom,
      height = this.base.height / this.zoom,
      x = this.center[0] - width / 2,
      y = this.center[1] - height / 2;
    this.svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    this.drawGrid(x, y, width, height);
  }

  /** Grid lines are regenerated for the visible world region, so panning never runs out. */
  private drawGrid(x: number, y: number, width: number, height: number): void {
    const cosine = Math.cos(Math.PI / 6);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
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
