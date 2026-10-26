import type { Design } from "./design";
import type { SystemScene } from "./scene";
import {
  FlowSimulation,
  MAX_FLOW_DATA,
  MAX_FLOW_RUNS,
  type FlowData,
  type FlowStep,
} from "./flow-simulation";
import { inferInstanceType } from "./layout";

/** The document owner supplies topology; this panel owns transient visual execution only. */
interface FlowPanelOptions {
  enter(): void;
  loadExample(): void;
  locate(id: string): void;
}
const PRESETS: Readonly<Record<string, FlowData>> = {
  video: {
    action: "upload",
    mediaType: "video",
    assetId: "demo-media",
    sizeMB: 40,
  },
  image: {
    action: "upload",
    mediaType: "image",
    assetId: "demo-image",
    sizeMB: 2,
  },
  playback: {
    action: "play",
    mediaType: "video",
    assetId: "demo-media",
    path: "/media/demo-media",
  },
};

/** One 5 Hz clock while work can advance; no background catch-up and no per-request SVG actors. */
export class FlowPanel {
  private readonly root = document.createElement("section");
  private readonly body: HTMLElement;
  private readonly entry: HTMLSelectElement;
  private readonly input: HTMLTextAreaElement;
  private readonly request: HTMLSelectElement;
  private readonly trace: HTMLElement;
  private readonly rows = new Map<number, HTMLButtonElement>();
  private readonly status: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly dataIn: HTMLElement;
  private readonly dataOut: HTMLElement;
  private readonly inspectTitle: HTMLElement;
  private engine: FlowSimulation;
  private design: Design;
  private selectedRun: number | undefined;
  private selectedStep: number | undefined;
  private shownRun: number | undefined;
  private previousInput: unknown;
  private previousOutput: unknown;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = true;

  constructor(
    stage: HTMLElement,
    private readonly svg: SVGSVGElement,
    scene: SystemScene,
    design: Design,
    private readonly options: FlowPanelOptions,
  ) {
    this.design = design;
    this.engine = new FlowSimulation(design);
    this.root.className = "flow-panel";
    this.root.setAttribute("aria-label", "Visual request simulator");
    this.root.innerHTML = `<header class="flow-header"><button id="simulate-toggle" type="button" aria-expanded="false" aria-controls="flow-body">▷ Simulate</button><span id="flow-status">Visual sandbox</span></header>
      <div id="flow-body" class="flow-body" hidden>
        <p class="flow-note">Execute your nodes and wires locally. No external apps, real files or cloud calls.</p>
        <button id="flow-media-example" class="btn" type="button">Load media app example</button>
        <div class="flow-fields"><label>Entry node<select id="flow-entry"></select></label><label>Request preset<select id="flow-preset"><option value="video">Upload video</option><option value="image">Upload image</option><option value="playback">Playback request</option></select></label></div>
        <label>Request data (JSON)<textarea id="flow-input" spellcheck="false" maxlength="${MAX_FLOW_DATA}" rows="5"></textarea></label>
        <div class="flow-actions"><button id="flow-run" class="btn btn-primary" type="button">Run request</button><button id="flow-burst" class="btn" type="button">Burst ×10</button><button id="flow-pause" class="btn" type="button">Resume</button><button id="flow-step" class="btn" type="button">Step 0.5s</button><button id="flow-reset" class="btn" type="button">Reset run</button><label>Speed<select id="flow-speed"><option value="1">1×</option><option value="4">4×</option><option value="16">16×</option></select></label></div>
        <p id="flow-message" class="flow-message" role="status">Choose an entry node and run a request.</p>
        <div id="flow-summary" class="flow-summary"></div>
        <label>Inspect request<select id="flow-request"><option value="">No requests yet</option></select></label>
        <p id="flow-run-detail" class="flow-message"></p>
        <ol id="flow-trace" class="flow-trace" aria-label="Request execution trace"></ol>
        <details class="flow-data" open><summary id="flow-inspect-title">Node input / output</summary><div><button id="flow-locate" class="btn" type="button" disabled>Locate node</button><h3>Input</h3><pre id="flow-data-in">Run a request to inspect data.</pre><h3>Output</h3><pre id="flow-data-out">No output yet.</pre></div></details>
      </div>`;
    stage.append(this.root);
    this.body = this.query("#flow-body");
    this.entry = this.query("#flow-entry");
    this.input = this.query("#flow-input");
    this.request = this.query("#flow-request");
    this.trace = this.query("#flow-trace");
    this.status = this.query("#flow-status");
    this.summary = this.query("#flow-summary");
    this.dataIn = this.query("#flow-data-in");
    this.dataOut = this.query("#flow-data-out");
    this.inspectTitle = this.query("#flow-inspect-title");
    this.input.value = JSON.stringify(PRESETS.video, null, 2);
    this.query("#simulate-toggle").addEventListener("click", () => {
      const open = this.body.hidden;
      if (open) this.options.enter();
      this.body.hidden = !open;
      this.query("#simulate-toggle").setAttribute(
        "aria-expanded",
        String(open),
      );
      this.query("#simulate-toggle").focus({ preventScroll: true });
      this.render();
    });
    this.root.addEventListener("keydown", (event) => {
      if (
        event.key !== "Escape" ||
        event.target instanceof HTMLSelectElement ||
        this.body.hidden
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      this.collapse();
      this.query("#simulate-toggle").focus({ preventScroll: true });
    });
    this.query<HTMLSelectElement>("#flow-preset").addEventListener(
      "change",
      (event) => {
        this.input.value = JSON.stringify(
          PRESETS[(event.target as HTMLSelectElement).value],
          null,
          2,
        );
      },
    );
    this.query("#flow-media-example").addEventListener("click", () => {
      if (
        this.design.instances.length &&
        !window.confirm(
          "Load the media app? Export your current design first to keep it.",
        )
      )
        return;
      this.options.loadExample();
    });
    this.query("#flow-run").addEventListener("click", () => this.start(1));
    this.query("#flow-burst").addEventListener("click", () => this.start(10));
    this.query("#flow-pause").addEventListener("click", () => {
      this.paused = !this.paused;
      this.stopClock();
      this.render();
    });
    this.query("#flow-step").addEventListener("click", () => {
      this.paused = true;
      this.stopClock();
      this.engine.advance(500);
      this.render();
    });
    this.query("#flow-reset").addEventListener("click", () =>
      this.reset(this.design),
    );
    this.query("#flow-speed").addEventListener("change", () => this.render());
    this.request.addEventListener("change", () => {
      this.selectedRun = Number(this.request.value);
      this.selectedStep = undefined;
      this.render();
    });
    this.query("#flow-locate").addEventListener("click", () => {
      const run = this.engine.runs.find((item) => item.id === this.selectedRun);
      const step =
        run?.steps.find((item) => item.id === this.selectedStep) ??
        run?.steps.at(-1);
      if (step) this.options.locate(step.instanceId ?? step.nodeId);
    });
    document.addEventListener("visibilitychange", () => {
      this.stopClock();
      if (!document.hidden) this.render();
    });
    scene.onLayoutChange(() => this.paintWorld());
    this.sync(design);
  }

  /** Required descendants belong to this fixed template. */
  private query<T extends HTMLElement>(selector: string): T {
    const node = this.root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing flow control: ${selector}`);
    return node;
  }

  /** Collapse never pauses a run or changes the world camera. */
  collapse(): void {
    this.body.hidden = true;
    this.query("#simulate-toggle").setAttribute("aria-expanded", "false");
  }

  /** Applying/importing another document is a new simulation; transient request data is not portable topology. */
  reset(design: Design): void {
    this.stopClock();
    this.paused = true;
    this.engine = new FlowSimulation(design);
    this.selectedRun = undefined;
    this.selectedStep = undefined;
    this.shownRun = undefined;
    this.rows.clear();
    this.trace.replaceChildren();
    this.request.replaceChildren(new Option("No requests yet", ""));
    this.previousInput = undefined;
    this.previousOutput = undefined;
    this.dataIn.textContent = "Run a request to inspect data.";
    this.dataOut.textContent = "No output yet.";
    this.say("Simulation reset. The design is unchanged.");
    this.sync(design);
  }

  /** Graph edits retain in-flight work and wake stalled queues/branches after connections or worker capacity change. */
  sync(design: Design): void {
    const changed = design !== this.design;
    this.design = design;
    this.engine.updateDesign(design);
    if (changed || !this.entry.options.length) {
      const previous = this.entry.value;
      const nodes = [...design.instances].sort(
        (a, b) =>
          Number(inferInstanceType(b.id) === "webpage") -
          Number(inferInstanceType(a.id) === "webpage"),
      );
      this.entry.replaceChildren(
        ...nodes.map((node) => new Option(node.label ?? node.id, node.id)),
      );
      if (nodes.some((node) => node.id === previous))
        this.entry.value = previous;
    }
    this.query<HTMLButtonElement>("#flow-run").disabled =
      !design.instances.length;
    this.query<HTMLButtonElement>("#flow-burst").disabled =
      !design.instances.length;
    this.render();
  }

  /** Selecting a world node inspects its latest visit in the selected request without altering execution. */
  inspectNode(id: string): void {
    const run = this.engine.runs.find((item) => item.id === this.selectedRun);
    if (!run) return;
    for (let index = run.steps.length - 1; index >= 0; index--) {
      const step = run.steps[index];
      if (step.nodeId === id || step.instanceId === id) {
        this.selectedStep = step.id;
        this.render();
        break;
      }
    }
  }

  /** One public execution command owns validation, errors and activation for both buttons. */
  private start(count: number): void {
    try {
      const input = JSON.parse(this.input.value) as FlowData;
      this.selectedRun = this.engine.start(this.entry.value, input, count);
      this.selectedStep = undefined;
      this.paused = false;
      this.say(`Started ${count} simulated request${count === 1 ? "" : "s"}.`);
      this.render();
    } catch (error) {
      this.say(
        error instanceof Error
          ? error.message
          : "Could not start this request.",
        true,
      );
    }
  }

  /** Only state-changing actions announce; progress counters are not a live-region firehose. */
  private say(text: string, error = false): void {
    const message = this.query("#flow-message");
    message.textContent = text;
    message.classList.toggle("error", error);
  }
  private stopClock(): void {
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
  }

  /** Fixed work per tick, with no catch-up burst when a hidden tab resumes. */
  private wake(): void {
    if (
      this.timer !== null ||
      this.paused ||
      document.hidden ||
      !this.engine.hasWork
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.paused || document.hidden) return;
      this.engine.advance(
        200 * Number(this.query<HTMLSelectElement>("#flow-speed").value),
      );
      this.render();
    }, 200);
  }

  /** Reconcile compact trace rows, not the world renderer or detailed models, as simulation time advances. */
  private render(): void {
    const stats = this.engine.stats;
    this.status.textContent = !stats.requests
      ? "Visual sandbox"
      : this.paused
        ? "Paused"
        : this.engine.hasWork
          ? "Running"
          : stats.complete + stats.failed === stats.requests
            ? "Finished"
            : "Waiting for wiring";
    this.summary.textContent = `${stats.complete}/${stats.requests} complete · ${stats.queued} queued · ${stats.running} executing · ${stats.failed} failed · cache ${stats.cacheHits} hit / ${stats.cacheMisses} miss · ${(this.engine.elapsed / 1000).toFixed(1)}s`;
    this.query("#flow-pause").textContent = this.paused ? "Resume" : "Pause";
    this.query<HTMLButtonElement>("#flow-pause").disabled = !stats.requests;
    this.query<HTMLButtonElement>("#flow-step").disabled = !stats.requests;
    const full = stats.requests >= MAX_FLOW_RUNS;
    this.query<HTMLButtonElement>("#flow-run").disabled =
      full || !this.design.instances.length;
    this.query<HTMLButtonElement>("#flow-burst").disabled =
      stats.requests + 10 > MAX_FLOW_RUNS || !this.design.instances.length;
    if (!this.body.hidden) {
      if (this.request.options[0]?.value === "" && stats.requests)
        this.request.replaceChildren();
      for (const run of this.engine.runs) {
        let option = this.request.querySelector<HTMLOptionElement>(
          `option[value="${run.id}"]`,
        );
        if (!option) {
          option = new Option("", String(run.id));
          this.request.add(option);
        }
        const text = `Request #${run.id} · ${run.status}`;
        if (option.textContent !== text) option.textContent = text;
      }
      this.request.value =
        this.selectedRun === undefined ? "" : String(this.selectedRun);
      const run = this.engine.runs.find((item) => item.id === this.selectedRun);
      const focusedStep = this.selectedStep ?? run?.steps.at(-1)?.id;
      if (this.shownRun !== this.selectedRun) {
        this.rows.clear();
        this.trace.replaceChildren();
        this.shownRun = this.selectedRun;
      }
      for (const step of run?.steps ?? []) {
        let row = this.rows.get(step.id);
        if (!row) {
          const item = document.createElement("li");
          row = document.createElement("button");
          row.type = "button";
          row.addEventListener("click", () => {
            this.selectedStep = step.id;
            this.query<HTMLDetailsElement>(".flow-data").open = true;
            this.render();
            this.query(".flow-data").scrollIntoView({ block: "nearest" });
          });
          item.append(row);
          this.trace.append(item);
          this.rows.set(step.id, row);
        }
        row.dataset.state = step.state;
        row.setAttribute("aria-pressed", String(step.id === focusedStep));
        const name =
          this.design.instances.find((node) => node.id === step.nodeId)
            ?.label ?? step.nodeId;
        const text = `${name} · ${step.state}${step.state === "running" ? ` ${Math.round(step.progress * 100)}%` : ""}${step.outlet ? ` → ${step.outlet.toUpperCase()}` : ""}`;
        if (row.textContent !== text) row.textContent = text;
        row.title = step.issue || step.instanceId || step.nodeId;
      }
      const selected =
        run?.steps.find((step) => step.id === this.selectedStep) ??
        run?.steps.at(-1);
      this.query<HTMLButtonElement>("#flow-locate").disabled = !selected;
      this.inspect(selected);
      const detail =
        run?.error ??
        (run?.status === "waiting"
          ? (run.steps.find(
              (step) => step.state === "waiting" || step.state === "blocked",
            )?.issue ?? "")
          : "");
      const runDetail = this.query("#flow-run-detail");
      if (runDetail.textContent !== detail) runDetail.textContent = detail;
    }
    this.paintWorld();
    this.wake();
  }

  /** Serialize only when the selected immutable input/output object changes, never every clock tick. */
  private inspect(step: FlowStep | undefined): void {
    if (!step) return;
    this.inspectTitle.textContent = `${step.nodeId} · ${step.state}${step.issue ? ` · ${step.issue}` : ""}`;
    if (this.previousInput !== step.input) {
      this.dataIn.textContent = JSON.stringify(step.input, null, 2);
      this.previousInput = step.input;
    }
    if (this.previousOutput !== step.output) {
      this.dataOut.textContent = step.output
        ? JSON.stringify(step.output, null, 2)
        : "No output yet.";
      this.previousOutput = step.output;
    }
  }

  /** Status attributes and traced cables reuse existing cached scene roots; there is no diagram rebuild per request. */
  private paintWorld(): void {
    const all = this.engine.activity(),
      selected = this.engine.activity(this.selectedRun);
    const enabled = this.engine.runs.length > 0;
    this.svg.classList.toggle("flow-on", enabled);
    const running =
      this.engine.runs.find((run) => run.id === this.selectedRun)?.status ===
      "running";
    this.svg.classList.toggle(
      "flow-running",
      enabled && running && !this.paused && !document.hidden,
    );
    for (const node of this.svg.querySelectorAll<SVGGElement>(
      ".scene-instance",
    )) {
      const state = enabled
        ? (all.nodes.get(node.dataset.instanceId!) ?? "idle")
        : "idle";
      if (node.dataset.flowState !== state) node.dataset.flowState = state;
    }
    for (const edge of this.svg.querySelectorAll<SVGGElement>(".connection"))
      edge.classList.toggle(
        "flow-traced",
        enabled && selected.wires.has(edge.dataset.connectionId!),
      );
  }
}
