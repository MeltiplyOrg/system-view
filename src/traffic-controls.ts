import type { Design } from "./design";
import { inferInstanceType } from "./layout";
import {
  TrafficModel,
  DEFAULT_CRASH_LIMITS,
  type CrashLimits,
  type SimulationSnapshot,
} from "./traffic";

/** One real-time simulation clock with a fixed 300ms per-hop duration. */
export class TrafficControls {
  private readonly root = document.createElement("section");
  private readonly toggle: HTMLButtonElement;
  private readonly stepButton: HTMLButtonElement;
  private readonly summary: HTMLOutputElement;
  private model: TrafficModel;
  private limits: CrashLimits = { ...DEFAULT_CRASH_LIMITS };
  private running = false;
  private frame: number | null = null;
  private previous = 0;

  constructor(
    host: HTMLElement,
    private readonly read: () => Design,
    private readonly publish: (state: SimulationSnapshot) => void,
  ) {
    this.model = new TrafficModel(read(), this.limits);
    this.root.className = "traffic-controls";
    this.root.setAttribute("aria-label", "Request simulation");
    this.root.innerHTML = `<div class="traffic-form"><span>Requests<br><small>solid out · ring back</small></span><button id="traffic-toggle" class="btn" type="button" aria-pressed="false">Run</button><button id="traffic-step" class="btn" type="button" title="Advance 10ms of simulated time">Step</button><button id="traffic-reset" class="btn" type="button">Reset</button></div>
      <output id="traffic-summary" aria-live="off"></output>
      <div class="traffic-clock"><span id="traffic-time">sim 0.00s</span><span>fixed 300ms per hop</span></div>
      <dl class="traffic-metrics" aria-label="System metrics"><div><dt>p95</dt><dd id="traffic-p95">—</dd></div><div><dt>p99</dt><dd id="traffic-p99">—</dd></div><div><dt>errors</dt><dd id="traffic-error-rate">—</dd></div><div><dt>queued</dt><dd id="traffic-queued">0</dd></div></dl>
      <div class="traffic-health-row"><span id="traffic-health" role="status">awaiting responses</span><span id="traffic-samples">30s · 0 samples</span></div>
      <details><summary>Crash limits</summary><form id="traffic-limits"><div class="traffic-limit-fields"><label>p95 (ms)<input id="traffic-p95-limit" type="number" min="0.001" step="any" required value="${this.limits.p95Ms}"></label><label>p99 (ms)<input id="traffic-p99-limit" type="number" min="0.001" step="any" required value="${this.limits.p99Ms}"></label><label>errors (%)<input id="traffic-error-limit" type="number" min="0" max="100" step="any" required value="${this.limits.errorRate * 100}"></label></div><button class="btn" type="submit">Apply limits &amp; reset</button></form><p>p95/p99 measure simulated milliseconds: 300ms per network hop plus processing and FIFO waiting. Step advances 10ms. Metrics use completed root calls in the last 30 simulated seconds; — means no samples. Crossing any limit crashes the system until Reset.</p></details>
      <details><summary>How requests travel</summary><p>Wire Users → Frontend → Backend → Database. Set requests/s on Users. Solid dots go out; matching rings return. Nodes wait FIFO at 100% load and reply after all synchronous dependencies finish. Queue handoffs/replication are one-way. Async deliveries are counted separately from root SLO samples. The 32-hop and 512-call safety limits produce errors, not infinite work.</p></details>`;
    host.append(this.root);
    this.toggle = this.root.querySelector("#traffic-toggle")!;
    this.stepButton = this.root.querySelector("#traffic-step")!;
    this.summary = this.root.querySelector("#traffic-summary")!;
    this.toggle.addEventListener("click", () => {
      this.running = !this.running;
      if (this.running) this.model.begin();
      this.schedule();
    });
    this.stepButton.addEventListener("click", () => {
      this.running = false;
      this.model.step(0.01);
      this.schedule();
    });
    this.root.querySelector("#traffic-reset")!.addEventListener("click", () => {
      this.running = false;
      this.sync(this.read());
    });
    this.root
      .querySelector("#traffic-limits")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const number = (id: string) =>
          this.root.querySelector<HTMLInputElement>(id)!.valueAsNumber;
        this.limits = {
          p95Ms: number("#traffic-p95-limit"),
          p99Ms: number("#traffic-p99-limit"),
          errorRate: number("#traffic-error-limit") / 100,
        };
        this.running = false;
        this.sync(this.read());
      });
    document.addEventListener("visibilitychange", () => this.schedule());
  }

  /** Graph/source edits discard obsolete work while retaining session limits and the chosen run state. */
  sync(design: Design): void {
    this.model = new TrafficModel(design, this.limits);
    this.schedule();
  }

  /** Own a single animation frame only while running, visible and configured with an active Users source. */
  private schedule(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.previous = 0;
    if (
      this.running &&
      !this.model.snapshot().crash &&
      !document.hidden &&
      this.read().instances.some(
        (node) =>
          inferInstanceType(node.id) === "users" && (node.trafficRps ?? 1) > 0,
      )
    )
      this.frame = requestAnimationFrame((now) => this.tick(now));
    this.render();
  }

  /** Sample wall time at 30Hz, then advance the real-time simulation; long stalls never catch up. */
  private tick(now: number): void {
    this.frame = requestAnimationFrame((time) => this.tick(time));
    if (!this.previous) {
      this.previous = now;
      return;
    }
    const elapsed = (now - this.previous) / 1000;
    if (elapsed < 1 / 30) return;
    this.previous = now;
    this.model.step(Math.min(0.1, elapsed));
    this.render();
  }

  /** Skip unchanged text so the shell's overlay observer never measures on idle metric frames. */
  private text(selector: string, text: string): void {
    const element = this.root.querySelector(selector)!;
    if (element.textContent !== text) element.textContent = text;
  }

  /** Publish node queues, true root-call metrics and a latched crash; cancel the next frame on failure. */
  private render(): void {
    const state = this.model.snapshot();
    if (state.crash) {
      this.running = false;
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.previous = 0;
    }
    this.publish(state);
    const sources = this.read().instances.filter(
      (node) => inferInstanceType(node.id) === "users",
    );
    const text = sources.length
      ? `${sources.reduce((sum, node) => sum + (node.trafficRps ?? 1), 0)} req/s · ${state.generated} sent · ${state.completed} delivered · ${state.rejected} rejected${state.limited ? ` · ${state.limited} limit drops` : ""}`
      : "Add Users and wire it to a frontend to generate requests.";
    if (this.summary.textContent !== text) this.summary.textContent = text;
    const { metrics, crash } = state;
    this.text("#traffic-time", `sim ${state.time.toFixed(2)}s`);
    this.text(
      "#traffic-p95",
      metrics.p95Ms === null ? "—" : `${metrics.p95Ms.toFixed(0)}ms`,
    );
    this.text(
      "#traffic-p99",
      metrics.p99Ms === null ? "—" : `${metrics.p99Ms.toFixed(0)}ms`,
    );
    this.text(
      "#traffic-error-rate",
      metrics.errorRate === null
        ? "—"
        : `${(metrics.errorRate * 100).toFixed(1)}%`,
    );
    this.text(
      "#traffic-queued",
      String(state.loads.reduce((total, load) => total + load.queued, 0)),
    );
    this.text("#traffic-samples", `30s · ${metrics.samples} samples`);
    const names = { p95Ms: "p95", p99Ms: "p99", errorRate: "error rate" };
    this.text(
      "#traffic-health",
      crash
        ? `system crashed · ${crash.breaches.map((key) => `${names[key]} > ${key === "errorRate" ? `${this.limits[key] * 100}%` : `${this.limits[key]}ms`}`).join(" · ")} · reset to restart`
        : metrics.samples
          ? "system healthy"
          : "awaiting responses",
    );
    if (this.root.dataset.crashed !== String(!!crash))
      this.root.dataset.crashed = String(!!crash);
    if (this.toggle.disabled !== !!crash) this.toggle.disabled = !!crash;
    if (this.stepButton.disabled !== !!crash)
      this.stepButton.disabled = !!crash;
    this.text("#traffic-toggle", this.running ? "Pause" : "Run");
    if (this.toggle.getAttribute("aria-pressed") !== String(this.running))
      this.toggle.setAttribute("aria-pressed", String(this.running));
  }
}
