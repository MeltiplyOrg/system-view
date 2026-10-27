import { project } from "./database";
import type { NodeLoad } from "./traffic";

const NS = "http://www.w3.org/2000/svg";

/** Expanded ground-plane frame bounds supplied by the scene's canonical margin helper. */
export interface StatusFrame {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  members: readonly string[];
}

/** Live meters never enter component snapshots or require geometry measurements on ticks. */
export class NodeStatusLayer {
  readonly element = document.createElementNS(NS, "g");
  private readonly meters: {
    frame: StatusFrame;
    root: SVGGElement;
    title: SVGTitleElement;
    label: SVGTextElement;
  }[] = [];

  constructor() {
    this.element.classList.add("node-status-layer");
    this.element.setAttribute("pointer-events", "none");
  }

  /** Rebuild positions only when world geometry changes; frame membership is cached for updates. */
  render(frames: readonly StatusFrame[], loads: readonly NodeLoad[]): void {
    this.element.replaceChildren();
    this.meters.length = 0;
    const eligible = new Set(loads.map((load) => load.id));
    for (const frame of frames) {
      if (!frame.members.some((id) => eligible.has(id))) continue;
      const { x, y, width, height } = frame.bounds;
      const length = Math.min(112, width * 0.42);
      // Follow the front (y=max) border, the other visible side of the footprint.
      // Both endpoints stay on the ground plane and clear the corner.
      const start = project(x + width - 12 - length, y + height, 0);
      const end = project(x + width - 12, y + height, 0);
      const root = document.createElementNS(NS, "g");
      root.dataset.statusFrame = frame.id;
      root.setAttribute("role", "meter");
      root.setAttribute("aria-label", `${frame.label} capacity utilization`);
      root.setAttribute("aria-valuemin", "0");
      root.setAttribute("aria-valuemax", "100");
      const title = document.createElementNS(NS, "title");
      const d = `M${start.join(" ")}L${end.join(" ")}`;
      for (const className of ["node-status-track", "node-status-fill"]) {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("class", className);
        path.setAttribute("d", d);
        root.append(path);
      }
      const label = document.createElementNS(NS, "text");
      label.classList.add("node-status-label");
      label.setAttribute("x", String(end[0] + 8));
      label.setAttribute("y", String(end[1] + 10));
      root.append(title, label);
      this.element.append(root);
      this.meters.push({ frame, root, title, label });
    }
    this.update(loads);
  }

  /** Worst-member pressure keeps a saturated replica visible instead of averaging it away. */
  update(loads: readonly NodeLoad[]): void {
    const byId = new Map(loads.map((load) => [load.id, load]));
    for (const meter of this.meters) {
      let utilization = 0;
      const descriptions: string[] = [];
      for (const id of meter.frame.members) {
        const load = byId.get(id);
        if (!load) continue;
        utilization = Math.max(utilization, load.utilization);
        descriptions.push(
          `${id}: ${load.acceptedRps} / ${load.capacityRps} admitted requests/s; ${load.incomingRps} incoming/s; ${load.queued} queued`,
        );
      }
      const percent = Math.round(utilization * 100);
      meter.root.dataset.utilization = String(utilization);
      meter.root.style.setProperty(
        "--node-health",
        String(Math.max(0, 1 - utilization) * 100) + "%",
      );
      meter.root.setAttribute("aria-valuenow", String(Math.min(100, percent)));
      meter.root.setAttribute(
        "aria-valuetext",
        `${percent}% load${utilization >= 1 ? ", saturated" : ", available capacity"}. ${descriptions.join(". ")}`,
      );
      meter.label.textContent = `${percent}%`;
      meter.title.textContent = `${meter.frame.label} · ${percent}% load\n${descriptions.join("\n")}`;
    }
  }
}
