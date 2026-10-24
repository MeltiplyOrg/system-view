import type { Design } from "./design";
import {
  DatabaseRack,
  createDatabaseDefinitions,
  DATABASE_ANCHOR,
  project,
} from "./database";
import { createPlatforms } from "./platform";

const NS = "http://www.w3.org/2000/svg";
export class SystemScene {
  private readonly content = document.createElementNS(NS, "g");
  private fitted = [0, 0, 1000, 700];
  private zoom = 1;
  constructor(private readonly svg: SVGSVGElement) {
    svg.append(createDatabaseDefinitions(), this.content);
  }

  render(design: Design): void {
    const layer = document.createElementNS(NS, "g");
    const positions = design.nodes.map((n) => n.position);
    // Cap grid density, not scene coordinates, for large imported layouts.
    const minX = Math.min(0, ...positions.map((p) => p.x)) - 240,
      maxX = Math.max(0, ...positions.map((p) => p.x)) + 240;
    const minY = Math.min(0, ...positions.map((p) => p.y)) - 180,
      maxY = Math.max(0, ...positions.map((p) => p.y)) + 180;
    const step = Math.max(
      120,
      Math.ceil(Math.max(maxX - minX, maxY - minY) / 40 / 120) * 120,
    );
    let grid = "";
    for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) {
      const a = project(x, minY, 0),
        b = project(x, maxY, 0);
      grid += `M${a.join(" ")}L${b.join(" ")}`;
    }
    for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) {
      const a = project(minX, y, 0),
        b = project(maxX, y, 0);
      grid += `M${a.join(" ")}L${b.join(" ")}`;
    }
    layer.innerHTML = `<path class="space-grid" d="${grid}"/>`;
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
    this.fitted = [
      bounds.x - pad,
      bounds.y - pad,
      Math.max(200, bounds.width + 2 * pad),
      Math.max(200, bounds.height + 2 * pad),
    ];
    this.fit();
  }

  fit(): void {
    this.zoom = 1;
    this.updateViewport();
  }
  zoomBy(factor: number): void {
    this.zoom = Math.max(0.5, Math.min(3, this.zoom * factor));
    this.updateViewport();
  }
  private updateViewport(): void {
    const [x, y, w, h] = this.fitted,
      width = w / this.zoom,
      height = h / this.zoom;
    this.svg.setAttribute(
      "viewBox",
      `${x + (w - width) / 2} ${y + (h - height) / 2} ${width} ${height}`,
    );
  }
}
