import type { Design } from "./design";
import { disconnectComponents } from "./construction";

/** One screen-space cut control shared by all wires; no per-wire listeners or idle clock. */
export class WireActions {
  private readonly button = document.createElement("button");
  private active: SVGGElement | null = null;
  private timer: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly svg: SVGSVGElement,
    private readonly read: () => Design,
    private readonly commit: (design: Design) => void,
  ) {
    this.button.className = "wire-cut";
    this.button.type = "button";
    this.button.hidden = true;
    this.button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="5" r="2.5"/><circle cx="5" cy="15" r="2.5"/><path d="m7 7 9 9M7 13 16 4"/></svg><span>Cut</span>`;
    host.append(this.button);
    svg.addEventListener("pointerover", (event) => {
      const wire = (event.target as Element).closest<SVGGElement>(
        ".connection",
      );
      if (!wire) return;
      this.show(wire, event.clientX, event.clientY);
    });
    svg.addEventListener("pointerout", (event) => {
      const next = event.relatedTarget as Element | null;
      if (
        next?.closest(".connection") === this.active ||
        this.button.contains(next)
      )
        return;
      this.deferHide();
    });
    svg.addEventListener("focusin", (event) => {
      const wire = (event.target as Element).closest<SVGGElement>(
        ".connection",
      );
      if (!wire) return;
      const path = wire.querySelector<SVGPathElement>(".wire")!;
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      if (!matrix) return;
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      this.show(wire, screen.x, screen.y);
    });
    svg.addEventListener("keydown", (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        (event.target as Element).closest(".connection")
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.button.focus();
      }
    });
    this.button.addEventListener("pointerenter", () => this.cancelHide());
    this.button.addEventListener("pointerleave", () => this.deferHide());
    this.button.addEventListener("blur", () => this.hide());
    this.button.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );
    this.button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.hide();
        this.svg.focus();
      }
    });
    this.button.addEventListener("click", () => {
      if (!this.active?.isConnected) return this.hide();
      const index = Number(this.active.dataset.connectionIndex);
      const next = disconnectComponents(this.read(), index);
      this.hide();
      this.commit(next);
      this.svg.focus();
    });
    svg.addEventListener("pointerdown", () => this.hide());
    svg.addEventListener("wheel", () => this.hide(), { passive: true });
    document.addEventListener("visibilitychange", () => this.hide());
  }

  /** Document/camera changes invalidate the control's connection identity and screen anchor. */
  hide(): void {
    this.cancelHide();
    this.active?.classList.remove("wire-hovered");
    this.active = null;
    this.button.hidden = true;
  }

  /** Open beside the pointer or focused route, clamped away from viewport edges. */
  private show(wire: SVGGElement, x: number, y: number): void {
    this.hide();
    this.active = wire;
    wire.classList.add("wire-hovered");
    const index = Number(wire.dataset.connectionIndex);
    const link = this.read().connections[index];
    if (!link) return this.hide();
    this.button.setAttribute(
      "aria-label",
      `Cut wire ${link.from} to ${link.to}${link.outlet ? ` (${link.outlet})` : ""}`,
    );
    this.button.style.left = `${Math.max(8, Math.min(window.innerWidth - 76, x + 10))}px`;
    this.button.style.top = `${Math.max(8, Math.min(window.innerHeight - 42, y - 40))}px`;
    this.button.hidden = false;
  }

  /** A short grace period lets the pointer cross from the cable to its detached button. */
  private deferHide(): void {
    this.cancelHide();
    if (document.activeElement === this.button) return;
    this.timer = window.setTimeout(() => this.hide(), 220);
  }

  /** Own at most one transient hide timeout and release it on every state change. */
  private cancelHide(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
