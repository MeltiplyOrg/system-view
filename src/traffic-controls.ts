import type { Design } from "./design";
import { TrafficModel, type NodeLoad } from "./traffic";

/** One page-lifetime traffic clock; no background catch-up and no per-node timers. */
export class TrafficControls {
  private readonly root = document.createElement("section");
  private readonly rate: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly summary: HTMLOutputElement;
  private model: TrafficModel;
  private running = false;
  private timer: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly read: () => Design,
    private readonly publish: (loads: readonly NodeLoad[]) => void,
  ) {
    this.model = new TrafficModel(read());
    this.root.className = "traffic-controls";
    this.root.setAttribute("aria-label", "Traffic capacity simulation");
    this.root.innerHTML = `<form class="traffic-form"><label for="traffic-rate">Traffic <span>requests/s</span></label><input id="traffic-rate" type="number" min="0" max="1000000" step="1" value="1000" required/><button id="traffic-toggle" class="btn" type="submit" aria-pressed="false">Run</button><button id="traffic-reset" class="btn" type="button">Reset</button></form><output id="traffic-summary" aria-live="off">idle · green = available capacity</output><details><summary>How status works</summary><p>Green → amber → red as demand approaches capacity. The number is demand ÷ capacity; over 100% means rejected work. Select a service to set its requests/s budget.</p><p>Illustrative rate model, not a vendor benchmark. One hop per 250 ms; excess is rejected, not queued. Balancers and branches split traffic; other nodes fan out. Conditions and merge synchronization are not executed. Cycles expire after 32 hops. Cable pulses illustrate direction, not individual requests.</p></details>`;
    host.append(this.root);
    this.rate = this.root.querySelector("#traffic-rate")!;
    this.toggle = this.root.querySelector("#traffic-toggle")!;
    this.summary = this.root.querySelector("#traffic-summary")!;
    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.rate.checkValidity()) return;
      this.running = !this.running;
      this.schedule();
    });
    this.root.querySelector("#traffic-reset")!.addEventListener("click", () => {
      this.running = false;
      this.sync(this.read());
    });
    document.addEventListener("visibilitychange", () => this.schedule());
  }

  /** Applied graph/capacity edits discard old in-flight rates, preserving the user's run/rate choice. */
  sync(design: Design): void {
    this.model = new TrafficModel(design);
    this.publish(this.model.snapshot());
    this.summary.textContent = "idle · green = available capacity";
    this.schedule();
  }

  /** Pause hidden pages without accumulating missed intervals or mutating the document. */
  private schedule(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.toggle.textContent = this.running ? "Pause" : "Run";
    this.toggle.setAttribute("aria-pressed", String(this.running));
    if (this.running && !document.hidden)
      this.timer = window.setInterval(() => this.tick(), 250);
    if (!this.running)
      this.summary.textContent =
        "paused · " +
        this.summary.textContent.replace(/^(paused · |idle · )/, "");
  }

  /** Advance the bounded rate pipeline and publish only meter data, never a world render. */
  private tick(): void {
    if (!this.rate.checkValidity()) return;
    const loads = this.model.step(this.rate.valueAsNumber);
    this.publish(loads);
    const overloaded = loads.filter((load) => load.rejectedRps > 0).length;
    this.summary.textContent = `${this.rate.valueAsNumber.toLocaleString()} req/s · ${overloaded} overloaded`;
  }
}
