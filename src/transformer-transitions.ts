import { ComponentRasterCache } from "./component-raster";
import { createTransformerRig } from "./transformer";
import type { TransformerRig } from "./transformer";
import type {
  TransformerEnvelope,
  TransformerSnapshot,
} from "./transformer-model";

const NS = "http://www.w3.org/2000/svg";
const MAX_ACTIVE = 3;
const MAX_PENDING = 12;
const DURATION = 800;

/** A leased source remains valid after reconciliation removes its DOM root. */
export interface TransformerSource {
  snapshot: TransformerSnapshot;
  envelope: TransformerEnvelope;
  sceneMatrix: DOMMatrix;
}

interface Job {
  source: TransformerSource;
  element: SVGGElement;
  geometry: SVGGElement;
  envelope: TransformerEnvelope;
  waiting: SVGGElement;
  ready: () => void;
  deadline: number;
  rig: TransformerRig | null;
  started: number;
}

/**
 * Owns all transient pixels and one throttled scene clock. Three cabinets may
 * assemble at once; up to twelve total changes display the stationary source
 * until their decoded target and a slot are available. No extra canvas
 * or detailed vector copy is created. Removal, interruption, theme changes,
 * reduced motion and backgrounding synchronously settle to final artwork.
 */
export class TransformerTransitions {
  private readonly jobs = new Map<string, Job>();
  private frame: number | null = null;
  private lastFrame = 0;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");

  /** One manager lives with the application's single scene. */
  constructor(
    private readonly content: SVGGElement,
    private readonly raster: ComponentRasterCache,
  ) {
    this.reduced.addEventListener("change", () => this.cancelAll());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
      this.cancelAll(),
    );
    new MutationObserver(() => this.cancelAll()).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] },
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.cancelAll();
    });
  }

  /** Settle an earlier swap before capturing its declared final source. */
  capture(
    id: string,
    element: SVGGElement,
    envelope: TransformerEnvelope,
  ): TransformerSource | null {
    this.cancel(id);
    if (
      this.reduced.matches ||
      document.hidden ||
      element.closest<SVGGElement>(".instance-placement")?.style.visibility ===
        "hidden"
    )
      return null;
    const geometry = element.querySelector<SVGGElement>("[data-renderer-type]");
    const basis = this.content.getCTM(),
      model = geometry?.getCTM();
    if (!geometry || !basis || !model) return null;
    const snapshot = this.raster.capture(geometry);
    if (!snapshot) return null;
    return {
      snapshot,
      envelope,
      sceneMatrix: basis.inverse().multiply(model),
    };
  }

  /** Consume a source lease even when no rig can safely be scheduled. */
  start(
    id: string,
    source: TransformerSource,
    element: SVGGElement,
    envelope: TransformerEnvelope,
  ): void {
    this.cancel(id);
    const geometry = element.querySelector<SVGGElement>("[data-renderer-type]");
    const model = element.getCTM(),
      basis = this.content.getCTM();
    if (
      !geometry ||
      !model ||
      !basis ||
      this.reduced.matches ||
      this.jobs.size >= MAX_PENDING ||
      element.closest<SVGGElement>(".instance-placement")?.style.visibility ===
        "hidden"
    ) {
      source.snapshot.release();
      return;
    }
    const waiting = document.createElementNS(NS, "g");
    waiting.classList.add("transformer-waiting");
    waiting.setAttribute("pointer-events", "none");
    waiting.setAttribute("aria-hidden", "true");
    waiting.setAttribute(
      "transform",
      model.inverse().multiply(basis).multiply(source.sceneMatrix).toString(),
    );
    waiting.append(...source.snapshot.images);
    element.append(waiting);
    geometry.style.visibility = "hidden";
    const ready = (): void => this.pump();
    geometry.addEventListener("component-raster-ready", ready);
    const job: Job = {
      source,
      element,
      geometry,
      envelope,
      waiting,
      ready,
      deadline: window.setTimeout(() => {
        if (!job.rig) this.cancel(id);
      }, 10000),
      rig: null,
      started: 0,
    };
    this.jobs.set(id, job);
    this.raster.requestSnapshot(geometry);
    this.pump();
  }

  /** Cancel is idempotent and never leaves a target hidden or pixels leased. */
  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    clearTimeout(job.deadline);
    job.geometry.removeEventListener("component-raster-ready", job.ready);
    job.geometry.style.visibility = "";
    job.waiting.remove();
    if (job.rig) job.rig.dispose();
    else job.source.snapshot.release();
    if (!this.jobs.size && this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /** Apply/reset, theme changes and tab suspension do not leave latent jobs. */
  cancelAll(): void {
    for (const id of this.jobs.keys()) this.cancel(id);
  }

  /** Fill only available rig slots; warming and queued sources do not tick. */
  private pump(): void {
    let active = 0;
    for (const job of this.jobs.values()) if (job.rig) active++;
    for (const [id, job] of this.jobs) {
      if (active >= MAX_ACTIVE) break;
      if (job.rig) continue;
      if (!job.element.isConnected) {
        this.cancel(id);
        continue;
      }
      const target = this.raster.capture(job.geometry);
      if (!target) continue;
      const model = job.element.getCTM(),
        basis = this.content.getCTM(),
        targetModel = job.geometry.getCTM();
      if (!model || !basis || !targetModel) {
        target.release();
        this.cancel(id);
        continue;
      }
      const into = model.inverse();
      job.rig = createTransformerRig(
        {
          envelope: job.source.envelope,
          snapshot: job.source.snapshot,
          transform: into.multiply(basis).multiply(job.source.sceneMatrix),
        },
        {
          envelope: job.envelope,
          snapshot: target,
          transform: into.multiply(targetModel),
        },
      );
      job.waiting.remove();
      job.element.append(job.rig.element);
      clearTimeout(job.deadline);
      job.started = performance.now();
      active++;
    }
    if (active && this.frame === null)
      this.frame = requestAnimationFrame(this.tick);
  }

  /** A shared 30 Hz clock makes frame work proportional to three small rigs. */
  private readonly tick = (now: number): void => {
    this.frame = null;
    if (now - this.lastFrame < 1000 / 30) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    this.lastFrame = now;
    for (const [id, job] of this.jobs) {
      if (!job.element.isConnected) {
        this.cancel(id);
        continue;
      }
      if (!job.rig) continue;
      const p = (now - job.started) / DURATION;
      if (p >= 1) this.cancel(id);
      else job.rig.render(p);
    }
    this.pump();
  };
}
