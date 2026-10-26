/**
 * Cached raster drawings for the static parts of rendered components.
 *
 * Every renderer geometry root exposes `data-renderer-type` and keeps its
 * non-identity artwork in `.component-static-base`. Database racks additionally
 * provide `.component-static-overlay` for the roof, with their live pulse layer
 * in `.component-motion` between the two static groups. Labels live in
 * `.component-label` outside those groups, so instance names never enter
 * cached pixels. Single-layer components use one image; racks keep two images
 * around their motion layer to preserve painter order.
 *
 * This manager replaces static vector layers with PNG-backed `<image>`
 * elements and detaches the vectors while the images are current. The cache
 * never owns camera state. The scene calls `setScale` with its current CSS
 * pixels per world unit; scale changes are coalesced so a wheel gesture does
 * not rasterize every frame, and an older image stays visible until a
 * replacement has decoded. Theme and instance-color changes drop the image
 * immediately and restore the live vectors, so a stale palette is never shown
 * while a replacement is being encoded. Detached vectors remain available for
 * invalidation and for a decode-failure fallback.
 */
import type { PlacedInstance } from "./design";
import { instanceColor } from "./layout";
import type { TransformerSnapshot } from "./transformer-model";

const NS = "http://www.w3.org/2000/svg";

/**
 * Raster budget in pixels, shared by every cached layer.
 *
 * Four bytes per pixel makes the retained shared-image budget roughly 30.5 MiB.
 * Replica count does not multiply it: identical renderer type, palette, bounds,
 * and tier own one URL set. Least-recent unused tiers are evicted before
 * active images.
 */
const RASTER_PIXEL_BUDGET = 8_000_000;

/** GPU/canvas dimension guard; the pixel budget is normally much tighter. */
const MAX_RASTER_DIMENSION = 4096;

/** Quiet period after the last scale update before rerasterizing. */
const SCALE_DEBOUNCE_MS = 280;

/** Short delay for the first render after `sync`, outside wheel gestures. */
const INITIAL_DELAY_MS = 80;

/** Settle delay after a pan ends before reallocating rasters by visibility. */
const VIEWPORT_SETTLE_MS = 140;

/** Never stall the sequential queue on a missing image load event. */
const IMAGE_LOAD_TIMEOUT_MS = 4000;

/** Reuse a plan when its dimensions moved by less than this fraction. */
const PLAN_TOLERANCE = 0.18;

/** Prewarm a readable close-up tier even while the camera is zoomed out. */
const PREWARM_SCALE = 1;

/**
 * Extra image space, in component-local world units, for strokes that extend
 * past tight path bounds. A fixed value keeps padded bounds stable across zoom,
 * so a small scale change can reuse the current image instead of rerasterizing.
 * Ten units covers the 5px cable glow even just above the overview threshold.
 */
const RASTER_PAD_WORLD = 10;

/** Palette inputs embedded in a raster; changing any invalidates the image. */
const PALETTE_PROPERTIES = [
  "--body",
  "--deck",
  "--line",
  "--detail",
  "--recess",
  "--fg",
  "--muted",
  "--cable-color",
  "--glow-opacity",
  "--brand-plate",
  "--provider-plate",
] as const;

/**
 * Defensive fallback in rack-local SVG units. It covers the unclipped chassis,
 * cable bows, and roof if Chromium reports stale `<use>` geometry for a group.
 * Other renderers use measured static geometry only; an unmeasurable layer
 * keeps its vectors instead of guessing a coordinate system.
 */
const RACK_FALLBACK_BOUNDS: Bounds = {
  x: -140,
  y: -260,
  width: 560,
  height: 520,
};

const RENDERER_TYPES = [
  "database-rack",
  "compute-server",
  "webpage",
  "cache",
  "cdn",
] as const;

const isRendererType = (value: string | undefined): value is RendererType =>
  value !== undefined && (RENDERER_TYPES as readonly string[]).includes(value);

/**
 * SVG paint properties worth snapshotting from the live class rules.
 *
 * Values are read after CSS variables and `color-mix()` have resolved, so the
 * resulting image needs neither the page stylesheet nor a font/network fetch.
 * `display` is deliberately absent: every static class is forced to `inline`
 * so an overview-hidden `--rack-fine-detail` can never leak into the snapshot.
 */
const PAINT_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "vector-effect",
  "paint-order",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-transform",
  "color",
] as const;

type RendererType = PlacedInstance["type"];
type LayerName = "base" | "overlay";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayerPlan {
  /** Padded bounds in component-local SVG units; also image placement. */
  bounds: Bounds;
  /** Raster backing-store size in device pixels. */
  width: number;
  height: number;
}

interface RecordPlan {
  base: LayerPlan;
  /** Only present when the renderer supplies a static overlay group. */
  overlay: LayerPlan | null;
}

interface LayerBounds {
  base: Bounds;
  overlay: Bounds | null;
}

interface CachedImage {
  element: SVGImageElement;
  url: string;
}

/**
 * Resolved paints for one renderer type/palette.
 *
 * `marks` names live-layer and definition elements whose inline paint was
 * snapshotted into an attribute rule. Paths are structural, so two replicas of
 * the same renderer type can share the snapshot without sharing element
 * identity. Non-paint inline declarations stay on the cloned element.
 */
interface ResolvedStyles {
  css: string;
  marks: ReadonlySet<string>;
  palette: string;
}

/** Shared decoded drawing, retained independently of any replica's DOM. */
interface SharedDrawing {
  type: RendererType;
  /** Canonical provider id whose artwork/palette the drawing encodes. */
  provider: string;
  base: string;
  overlay: string | null;
  plan: RecordPlan;
  bounds: LayerBounds;
  color: string;
  palette: string;
  pixels: number;
  styles: ResolvedStyles;
}

interface RasterRecord {
  /** Geometry root carrying `data-renderer-type`. */
  element: SVGGElement;
  type: RendererType;
  /** Canonical provider id from `data-renderer-provider`, or empty. */
  provider: string;
  staticBase: SVGGElement;
  staticOverlay: SVGGElement | null;
  motion: SVGGElement | null;
  label: SVGGElement | null;
  /** Tight union bounds measured once while vectors are still rendered. */
  bounds: LayerBounds | null;
  base: CachedImage | null;
  overlay: CachedImage | null;
  /** Drawing currently displayed by this record, if any. */
  shared: SharedDrawing | null;
  /** Plan used by the currently displayed image set, for reuse checks. */
  builtPlan: RecordPlan | null;
  /** Latest plan requested by scale/navigation changes. */
  pendingPlan: RecordPlan | null;
  /** A plan whose image decode failed; retried only when it really changes. */
  failedPlan: RecordPlan | null;
  color: string;
  /** Bumped on every invalidation so in-flight jobs can discard themselves. */
  revision: number;
  /** Revision observed when the current job started. */
  builtRevision: number;
  building: boolean;
  /** Resolved paints reused when detached vectors are rerasterized at scale. */
  styles: ResolvedStyles | null;
  /** Static groups removed after a successful install and awaiting restore. */
  vectorsDetached: boolean;
}

/** Compare padded bounds with sub-unit tolerance. */
const sameBounds = (a: Bounds, b: Bounds): boolean =>
  Math.abs(a.x - b.x) < 0.05 &&
  Math.abs(a.y - b.y) < 0.05 &&
  Math.abs(a.width - b.width) < 0.05 &&
  Math.abs(a.height - b.height) < 0.05;

/** Treat small pixel-size changes as the same plan; larger ones rerasterize. */
const closeDimension = (next: number, current: number): boolean =>
  Math.abs(next - current) <= Math.max(2, current * PLAN_TOLERANCE);

/** A single layer plan is reusable when geometry and resolution are close. */
const sameLayerPlan = (a: LayerPlan | null, b: LayerPlan | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    sameBounds(a.bounds, b.bounds) &&
    closeDimension(a.width, b.width) &&
    closeDimension(a.height, b.height)
  );
};

/** A record plan is reusable when both present layers still match. */
const samePlan = (a: RecordPlan, b: RecordPlan): boolean =>
  sameLayerPlan(a.base, b.base) && sameLayerPlan(a.overlay, b.overlay);

/** Convert an SVG bounding box to plain numbers, or reject degenerate input. */
const toBounds = (box: DOMRect): Bounds | null =>
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  Number.isFinite(box.width) &&
  Number.isFinite(box.height) &&
  box.width > 0 &&
  box.height > 0
    ? { x: box.x, y: box.y, width: box.width, height: box.height }
    : null;

/** References to local SVG definitions in serialized markup. */
const referencedIds = (markup: string): string[] => {
  const ids = new Set<string>();
  for (const match of markup.matchAll(
    /(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/g,
  )) {
    ids.add(match[1]!);
  }
  for (const match of markup.matchAll(/url\(\s*#([^)\s"']+)\s*\)/g)) {
    ids.add(match[1]!);
  }
  return [...ids];
};

/**
 * Resolve the definitions referenced by the given roots, recursively.
 *
 * Only referenced definitions are cloned, so unrelated scene definitions and
 * previously cached images never enter a raster source.
 */
const referencedDefinitions = (
  defs: SVGDefsElement,
  roots: readonly Element[],
): Element[] => {
  const byId = new Map<string, Element>();
  for (const element of defs.querySelectorAll<SVGElement>("[id]")) {
    const id = element.getAttribute("id");
    if (id) byId.set(id, element);
  }
  const result: Element[] = [];
  const seen = new Set<string>();
  const pending = referencedIds(roots.map((root) => root.outerHTML).join(""));
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const element = byId.get(id);
    if (!element) continue;
    result.push(element);
    pending.push(...referencedIds(element.outerHTML));
  }
  return result;
};

/**
 * Copy the paint declarations from one live inline style.
 *
 * Paint values are read from computed style, so `var()` and `color-mix()`
 * resolve before the raster is serialized. The generated rule deliberately
 * includes values that also exist as presentation attributes: inline styles
 * override those attributes, while a snapshot rule must reproduce the same
 * resolved result in the standalone document.
 */
const inlinePaint = (view: Window, element: SVGElement): string => {
  const computed = view.getComputedStyle(element);
  const declarations: string[] = ["display:inline"];
  for (const property of PAINT_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) declarations.push(`${property}:${value}`);
  }
  return declarations.join(";");
};

/**
 * Resolve the live paint styles used by one record's static layers.
 *
 * Classed elements are sampled from the actual static geometry (not only
 * shared definitions), so non-rack renderers get their resolved fills,
 * strokes, and typography. Inline paint is snapshotted under a structural
 * path; the clone keeps all non-paint inline declarations. Shared definition
 * elements are sampled while `--cable-color` is set on `<defs>`, because
 * `<use>` shadow content is not queryable through the instance.
 */
function styleSheetFor(
  view: Window,
  record: RasterRecord,
  defs: SVGDefsElement | null,
  color: string,
  palette: string,
): ResolvedStyles {
  const samples = new Map<
    string,
    { element: SVGElement; presentation: Set<string> }
  >();
  const inlineRules: string[] = [];
  const marks = new Set<string>();
  const collect = (root: Element, prefix: string): void => {
    const elements: SVGElement[] = [
      root as SVGElement,
      ...root.querySelectorAll<SVGElement>("*"),
    ];
    for (const [index, element] of elements.entries()) {
      const key = Array.from(element.classList).sort().join(".");
      if (key) {
        let entry = samples.get(key);
        if (!entry) {
          entry = { element, presentation: new Set() };
          samples.set(key, entry);
        }
        for (const property of PAINT_PROPERTIES) {
          if (element.hasAttribute(property)) entry.presentation.add(property);
        }
      }
      if (element.hasAttribute("style")) {
        const path = `${prefix}:${index}`;
        marks.add(path);
        inlineRules.push(
          `[data-raster-paint=${JSON.stringify(path)}]{${inlinePaint(
            view,
            element,
          )}}`,
        );
      }
    }
  };

  const layers = [record.staticBase, record.staticOverlay].filter(
    (layer): layer is SVGGElement => layer !== null,
  );
  collect(record.staticBase, "base");
  if (record.staticOverlay) collect(record.staticOverlay, "overlay");

  const previous = defs?.getAttribute("style") ?? null;
  defs?.style.setProperty("--cable-color", color);
  try {
    if (defs) {
      for (const definition of referencedDefinitions(defs, layers)) {
        const id = definition.getAttribute("id");
        if (id) collect(definition, id);
      }
    }
    const rules: string[] = [];
    for (const [key, { element: sample, presentation }] of samples) {
      const computed = view.getComputedStyle(sample);
      let declarations = "display:inline";
      for (const property of PAINT_PROPERTIES) {
        // Keep per-element presentation attributes (for example label sizes)
        // rather than flattening every element with a shared class to one value.
        if (presentation.has(property)) continue;
        const value = computed.getPropertyValue(property);
        if (value) declarations += `;${property}:${value}`;
      }
      rules.push(`.${key}{${declarations}}`);
    }
    rules.push(...inlineRules);
    return { css: rules.join(""), marks, palette };
  } finally {
    if (defs) {
      if (previous === null) defs.removeAttribute("style");
      else defs.setAttribute("style", previous);
    }
  }
}

/** Apply the snapshot's structural markers to a cloned static subtree. */
const applyStyles = (
  original: Element,
  clone: Element,
  prefix: string,
  styles: ResolvedStyles,
): void => {
  const originals = [original, ...original.querySelectorAll("*")];
  const clones = [clone, ...clone.querySelectorAll("*")];
  const length = Math.min(originals.length, clones.length);
  for (let index = 0; index < length; index++) {
    const path = `${prefix}:${index}`;
    if (!styles.marks.has(path)) continue;
    const target = clones[index] as SVGElement;
    target.setAttribute("data-raster-paint", path);
    // Paint declarations move to the resolved attribute rule; custom
    // properties and unrelated inline declarations stay untouched.
    for (const property of PAINT_PROPERTIES)
      target.style.removeProperty(property);
    if (target.style.length) target.setAttribute("style", target.style.cssText);
    else target.removeAttribute("style");
  }
};

/** Serialize only the definitions referenced by a static layer clone. */
const definitionsFor = (
  defs: SVGDefsElement | null,
  roots: readonly Element[],
  styles: ResolvedStyles,
): string => {
  if (!defs) return "";
  const originals = referencedDefinitions(defs, roots);
  if (originals.length === 0) return "";
  const staging = defs.ownerDocument.createElementNS(NS, "g");
  for (const original of originals) {
    const id = original.getAttribute("id");
    if (!id) continue;
    const clone = original.cloneNode(true) as Element;
    applyStyles(original, clone, id, styles);
    for (const cached of clone.querySelectorAll(".component-raster")) {
      cached.remove();
    }
    staging.append(clone);
  }
  return staging.innerHTML;
};

/** Self-contained SVG document for one static layer. */
function sourceFor(
  record: RasterRecord,
  layer: LayerName,
  plan: LayerPlan,
  defs: SVGDefsElement | null,
  styles: ResolvedStyles,
): string {
  const source = layer === "base" ? record.staticBase : record.staticOverlay;
  if (!source) throw new Error(`Missing ${layer} geometry.`);
  const clone = source.cloneNode(true) as SVGGElement;
  applyStyles(source, clone, layer, styles);
  for (const cached of clone.querySelectorAll(".component-raster")) {
    cached.remove();
  }
  const definitions = definitionsFor(defs, [clone], styles);
  const { bounds } = plan;
  return (
    `<svg xmlns="${NS}" width="${plan.width}" height="${plan.height}" ` +
    `viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" ` +
    `preserveAspectRatio="none">` +
    `<style>${styles.css}</style>` +
    (definitions ? `<defs>${definitions}</defs>` : "") +
    `${clone.outerHTML}</svg>`
  );
}

/** Decode an image URL without attaching it to the document. */
const decodeImage = async (
  url: string,
  view: Window,
): Promise<HTMLImageElement> => {
  const image = view.document.createElement("img");
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
};

/** Wait for an SVG `<image>` to load after it has been inserted. */
const imageLoaded = (image: SVGImageElement, view: Window): Promise<boolean> =>
  new Promise((resolve) => {
    let timer = 0;
    const settle = (loaded: boolean): void => {
      view.clearTimeout(timer);
      resolve(loaded);
    };
    image.addEventListener("load", () => settle(true), { once: true });
    image.addEventListener("error", () => settle(false), { once: true });
    timer = view.setTimeout(() => settle(false), IMAGE_LOAD_TIMEOUT_MS);
  });

/**
 * Bounded cache for component static layers.
 *
 * Create one per scene after the shared rack `<defs>` are mounted. All methods
 * are safe to call repeatedly; the manager discovers geometry roots from the
 * SVG DOM through `data-renderer-type`.
 */
export class ComponentRasterCache {
  private readonly view: Window;
  private readonly document: Document;
  private readonly records = new Map<SVGGElement, RasterRecord>();
  private readonly queue: RasterRecord[] = [];
  private readonly queued = new Set<RasterRecord>();
  /** Explicit provider edits prepare their normal shared image ahead of idle tiers. */
  private readonly requested = new Set<RasterRecord>();

  /** Insertion order is LRU; URLs outlive replica removal but stay pixel-bounded. */
  private readonly drawings = new Map<string, SharedDrawing>();

  /** Bitmap leases keep in-flight transformer textures alive without copying pixels. */
  private readonly leases = new Map<SharedDrawing, number>();
  private readonly retired = new Set<SharedDrawing>();

  /** Current CSS pixels per world unit; zero until first update. */
  private scale = 0;

  /** Debounce for continuous wheel/pinch scale changes. */
  private scaleTimer: number | null = null;

  /** Debounce after pans, when scale is unchanged but culling has moved. */
  private viewportTimer: number | null = null;

  /** Coalesced plan refresh outside continuous gestures. */
  private refreshTimer: number | null = null;

  /** One raster job at a time, so many components never form one long task. */
  private processing = false;
  private pumpTimer: number | null = null;
  private pumpIdle = false;

  /** Invalidates every in-flight raster when the palette changes. */
  private themeRevision = 0;

  /** Permanent document listeners; the cache lives with its scene. */
  private readonly themeObserver: MutationObserver | null;
  private readonly mediaQueries: MediaQueryList[] = [];

  constructor(private readonly svg: SVGSVGElement) {
    this.view = svg.ownerDocument.defaultView ?? window;
    this.document = svg.ownerDocument;

    const Observer =
      typeof MutationObserver === "undefined" ? null : MutationObserver;
    this.themeObserver = Observer
      ? new Observer(() => this.invalidateAll())
      : null;
    this.themeObserver?.observe(this.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // The media query keeps an OS-driven theme change in sync with the cache,
    // not only explicit data-theme selections in the UI.
    for (const query of [
      "(prefers-color-scheme: light)",
      "(prefers-color-scheme: dark)",
    ]) {
      const media = this.view.matchMedia?.(query);
      if (!media) continue;
      media.addEventListener("change", () => this.invalidateAll());
      this.mediaQueries.push(media);
    }
  }

  /**
   * Discover current geometry roots and forget detached ones.
   *
   * Call after each scene render. Existing records survive replica edits, so
   * stable components keep their decoded images; a detached component
   * releases its DOM references while shared drawings remain available for a
   * re-added replica. Color changes on a retained component invalidate it.
   * New records synchronously install a matching shared tier, so switching
   * between designs with the same renderer types never re-encodes geometry.
   */
  sync(): void {
    const live = new Set<SVGGElement>();
    let needsRefresh = false;
    const palettes = new Map<string, string>();
    const paletteFor = (record: RasterRecord): string => {
      const key = `${record.type}|${record.provider}|${record.color}`;
      let palette = palettes.get(key);
      if (palette === undefined) {
        palette = this.paletteOf(record.element);
        palettes.set(key, palette);
      }
      return palette;
    };

    for (const element of this.svg.querySelectorAll<SVGGElement>(
      "[data-renderer-type]",
    )) {
      const type = element.dataset.rendererType;
      if (!isRendererType(type)) continue;
      const provider = element.dataset.rendererProvider ?? "";
      const known = this.records.get(element);
      const queryBase = element.querySelector<SVGGElement>(
        ".component-static-base",
      );
      const queryOverlay = element.querySelector<SVGGElement>(
        ".component-static-overlay",
      );
      // A successfully cached record has detached its vectors; the known
      // groups are authoritative until invalidation restores them.
      const staticBase =
        queryBase ??
        (known && (known.vectorsDetached || element.contains(known.staticBase))
          ? known.staticBase
          : null);
      const staticOverlay =
        queryOverlay ??
        (known &&
        known.staticOverlay &&
        (known.vectorsDetached || element.contains(known.staticOverlay))
          ? known.staticOverlay
          : null);
      if (!staticBase) continue;
      live.add(element);

      let record = known;
      if (
        record &&
        (record.type !== type ||
          record.provider !== provider ||
          record.staticBase !== staticBase ||
          record.staticOverlay !== staticOverlay)
      ) {
        if (
          (record.type !== type || record.provider !== provider) &&
          record.staticBase === staticBase &&
          record.staticOverlay === staticOverlay &&
          record.vectorsDetached
        ) {
          // A retained DOM root that only changed its renderer type or
          // provider still needs its vectors before the new record can sample
          // or measure.
          this.restoreVectors(record);
        }
        this.release(record);
        record = undefined;
      }
      const motion =
        element.querySelector<SVGGElement>(".component-motion") ??
        record?.motion ??
        null;
      const label =
        element.querySelector<SVGGElement>(".component-label") ??
        record?.label ??
        null;
      const color = this.colorOf(element, type, provider);
      if (!record) {
        record = {
          element,
          type,
          provider,
          staticBase,
          staticOverlay,
          motion,
          label,
          bounds: null,
          base: null,
          overlay: null,
          shared: null,
          builtPlan: null,
          pendingPlan: null,
          failedPlan: null,
          color,
          revision: 0,
          builtRevision: 0,
          building: false,
          styles: null,
          vectorsDetached: false,
        };
        this.records.set(element, record);
        needsRefresh = true;
      } else {
        record.motion = motion;
        record.label = label;
        if (record.color !== color) {
          record.color = color;
          this.invalidate(record);
          needsRefresh = true;
        }
      }

      if (!record.base && !record.building) {
        const drawing = this.warmDrawing(record, paletteFor(record));
        if (drawing) {
          this.installShared(record, drawing);
          needsRefresh = true;
        }
      }
    }

    for (const [element, record] of this.records) {
      if (live.has(element) && element.isConnected) continue;
      this.release(record);
    }
    this.trimDrawings();
    if (needsRefresh) this.scheduleRefresh();
  }

  /**
   * Prepare a visible user-requested target promptly, through the existing
   * pixel budget and single-encode queue. This neither makes a transition-only
   * bitmap nor samples source vectors; only the ordinary target cache job is
   * advanced ahead of background sharpening. Navigation still owns the CPU.
   */
  requestSnapshot(geometry: SVGGElement): void {
    const record = this.records.get(geometry);
    if (!record || record.base || this.isCulled(record)) return;
    this.requested.add(record);
    const queuedAt = this.queue.indexOf(record);
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1);
      this.queue.unshift(record);
    }
    if (this.pumpIdle && this.pumpTimer !== null) {
      this.view.cancelIdleCallback(this.pumpTimer);
      this.pumpTimer = null;
      this.pumpIdle = false;
    }
    this.scheduleRefresh(0);
  }

  /**
   * Borrow already-decoded static images for a mechanical transformation.
   * Never expands vectors or allocates a canvas. The caller owns an idempotent
   * release; shared URLs survive source removal and palette invalidation until
   * the final borrower releases them.
   */
  capture(geometry: SVGGElement): TransformerSnapshot | null {
    const record = this.records.get(geometry);
    const drawing = record?.shared;
    if (!drawing || !record.base) return null;
    this.leases.set(drawing, (this.leases.get(drawing) ?? 0) + 1);
    const images = [record.base.element, record.overlay?.element]
      .filter((image): image is SVGImageElement => image !== undefined)
      .map((image) => {
        const clone = image.cloneNode(false) as SVGImageElement;
        clone.removeAttribute("class");
        clone.removeAttribute("data-raster-layer");
        clone.style.visibility = "visible";
        return clone;
      });
    let released = false;
    return {
      images,
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.leases.get(drawing) ?? 1) - 1;
        if (remaining > 0) this.leases.set(drawing, remaining);
        else {
          this.leases.delete(drawing);
          if (this.retired.delete(drawing)) {
            URL.revokeObjectURL(drawing.base);
            if (drawing.overlay) URL.revokeObjectURL(drawing.overlay);
          }
        }
        this.trimDrawings();
      },
    };
  }

  /**
   * Record the viewport's current CSS pixels per world unit.
   *
   * Called for every viewBox update. The value is only used after a short
   * quiet period; the previous image keeps painting during navigation, and a
   * plan whose dimensions barely changed is reused.
   */
  setScale(cssPixelsPerWorldUnit: number): void {
    if (!Number.isFinite(cssPixelsPerWorldUnit) || cssPixelsPerWorldUnit <= 0)
      return;
    if (Math.abs(cssPixelsPerWorldUnit - this.scale) < 0.001) {
      // Pans keep scale but move scene culling. Replan once movement settles
      // so only painted components consume the shared pixel budget. One
      // pending timer serves the whole gesture instead of churning every
      // frame.
      this.scheduleVisibilityRefresh();
      return;
    }
    this.scale = cssPixelsPerWorldUnit;
    if (this.viewportTimer !== null) {
      this.view.clearTimeout(this.viewportTimer);
      this.viewportTimer = null;
    }
    if (this.scaleTimer !== null) this.view.clearTimeout(this.scaleTimer);
    if (this.refreshTimer !== null) {
      this.view.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.scaleTimer = this.view.setTimeout(() => {
      this.scaleTimer = null;
      this.refreshPlans();
    }, SCALE_DEBOUNCE_MS);
  }

  /**
   * True while the scene's camera culling hides this component's placement.
   *
   * Offscreen components keep their vector fallback but do not consume the
   * shared raster budget, so the components actually filling the close view
   * stay sharp. Scene culling writes inline visibility on `.instance-placement`.
   */
  private isCulled(record: RasterRecord): boolean {
    return (
      record.element.closest<SVGGElement>(".instance-placement")?.style
        .visibility === "hidden"
    );
  }

  /** Current instance color, preferring the value the scene writes inline. */
  private colorOf(
    element: SVGGElement,
    type: RendererType,
    provider = "",
  ): string {
    const owner =
      element.style.getPropertyValue("--cable-color").trim() ||
      element
        .closest<SVGGElement>(".scene-instance")
        ?.style.getPropertyValue("--cable-color")
        .trim();
    if (owner) return owner;
    return (
      this.view
        .getComputedStyle(element)
        .getPropertyValue("--cable-color")
        .trim() || instanceColor(type, provider)
    );
  }

  /**
   * Resolved theme inputs captured by a snapshot.
   *
   * Comparing this at job completion catches a palette change even before the
   * theme observer or media listener has run its invalidation.
   */
  private paletteOf(element: SVGGElement): string {
    const computed = this.view.getComputedStyle(element);
    return PALETTE_PROPERTIES.map((property) =>
      computed.getPropertyValue(property).trim(),
    ).join("|");
  }

  /** Schedule plan computation; a pending gesture owns the next rebuild. */
  private scheduleRefresh(delay = INITIAL_DELAY_MS): void {
    if (this.scaleTimer !== null || this.viewportTimer !== null) {
      if (delay > 0) return;
    }
    if (this.refreshTimer !== null) {
      if (delay > 0) return;
      this.view.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = this.view.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshPlans();
    }, delay);
  }

  /**
   * Coalesce pan-driven culling changes into one plan refresh.
   *
   * Scale does not change while panning, so `setScale` cannot use the scale
   * debounce. A single timer per gesture (not per pointer frame) waits for the
   * scene's `.navigating` state to clear; while motion continues it simply
   * checks again, which keeps timer churn far below frame rate.
   */
  private scheduleVisibilityRefresh(): void {
    if (this.viewportTimer !== null) return;
    this.viewportTimer = this.view.setTimeout(() => {
      this.viewportTimer = null;
      if (this.svg.classList.contains("navigating")) {
        this.scheduleVisibilityRefresh();
        return;
      }
      this.refreshPlans();
    }, VIEWPORT_SETTLE_MS);
  }

  /**
   * Measure static vectors once and cache their local bounds.
   *
   * `getBBox` includes referenced `<use>` geometry and cable bows. Rack
   * components keep a conservative fallback if a browser cannot resolve that
   * geometry. Other renderer types retain their live vectors when a layer
   * cannot be measured, because there is no safe coordinate-system guess.
   */
  private measure(record: RasterRecord): boolean {
    if (record.bounds) return true;
    const fallback =
      record.type === "database-rack" ? RACK_FALLBACK_BOUNDS : null;
    try {
      const base = toBounds(record.staticBase.getBBox()) ?? fallback;
      const overlay = record.staticOverlay
        ? (toBounds(record.staticOverlay.getBBox()) ?? fallback)
        : null;
      if (!base || (record.staticOverlay && !overlay)) return false;
      record.bounds = { base, overlay };
      return true;
    } catch {
      if (!fallback) return false;
      record.bounds = {
        base: fallback,
        overlay: record.staticOverlay ? fallback : null,
      };
      return true;
    }
  }

  /**
   * Build a resolution plan for every visible component under one budget.
   *
   * Component-local space uses one unit per world unit. Scaling by CSS pixels
   * per unit times devicePixelRatio gives device-pixel backing stores.
   * Offscreen components keep the original vectors and do not consume raster
   * memory. When visible components would exceed the budget, one uniform
   * reduction keeps them equally sharp instead of starving later components.
   * Identical type/palette/bounds/tier geometry is counted once.
   */
  private computePlans(): Map<RasterRecord, RecordPlan> {
    const plans = new Map<RasterRecord, RecordPlan>();
    // Stable power-of-two tiers prevent cache fragmentation during wheel zoom.
    const deviceScale =
      2 **
      Math.ceil(
        Math.log2(
          Math.max(this.scale, PREWARM_SCALE) *
            Math.max(1, this.view.devicePixelRatio || 1),
        ),
      );
    const entries: {
      record: RasterRecord;
      layer: LayerName;
      bounds: Bounds;
      width: number;
      height: number;
    }[] = [];

    for (const record of this.records.values()) {
      if (this.isCulled(record)) continue;
      if (!this.measure(record)) continue;
      const measured = record.bounds;
      if (!measured) continue;
      const layers: LayerName[] = record.staticOverlay
        ? ["base", "overlay"]
        : ["base"];
      for (const layer of layers) {
        const tight = measured[layer];
        if (!tight) continue;
        const bounds = {
          x: tight.x - RASTER_PAD_WORLD,
          y: tight.y - RASTER_PAD_WORLD,
          width: tight.width + RASTER_PAD_WORLD * 2,
          height: tight.height + RASTER_PAD_WORLD * 2,
        };
        entries.push({
          record,
          layer,
          bounds,
          width: Math.max(1, Math.round(bounds.width * deviceScale)),
          height: Math.max(1, Math.round(bounds.height * deviceScale)),
        });
      }
    }

    let totalPixels = 0;
    const unique = new Set<string>();
    for (const entry of entries) {
      const key = JSON.stringify([
        entry.record.type,
        entry.record.color,
        entry.layer,
        entry.bounds,
        entry.width,
        entry.height,
      ]);
      if (unique.has(key)) continue;
      unique.add(key);
      totalPixels += entry.width * entry.height;
    }
    const shrink =
      totalPixels > RASTER_PIXEL_BUDGET
        ? Math.sqrt(RASTER_PIXEL_BUDGET / totalPixels)
        : 1;

    for (const entry of entries) {
      let width = Math.max(1, Math.round(entry.width * shrink));
      let height = Math.max(1, Math.round(entry.height * shrink));
      const longest = Math.max(width, height);
      if (longest > MAX_RASTER_DIMENSION) {
        const cap = MAX_RASTER_DIMENSION / longest;
        width = Math.max(1, Math.floor(width * cap));
        height = Math.max(1, Math.floor(height * cap));
      }
      let plan = plans.get(entry.record);
      if (!plan) {
        plan = {
          base: { bounds: entry.bounds, width, height },
          overlay: null,
        };
        plans.set(entry.record, plan);
      }
      if (entry.layer === "base") {
        plan.base = { bounds: entry.bounds, width, height };
      } else {
        plan.overlay = { bounds: entry.bounds, width, height };
      }
    }
    return plans;
  }

  /** Recompute plans and enqueue only the components that really changed. */
  private refreshPlans(): void {
    if (!this.scale) return;
    if (this.svg.classList.contains("navigating")) {
      this.scheduleVisibilityRefresh();
      return;
    }
    for (const record of this.records.values()) {
      if (!this.isCurrent(record)) continue;
      if (this.isCulled(record) && (record.base || record.overlay))
        this.invalidate(record);
    }
    for (const [record, plan] of this.computePlans()) {
      if (!this.isCurrent(record)) continue;
      const color = this.colorOf(record.element, record.type, record.provider);
      if (record.color !== color) {
        record.color = color;
        this.invalidate(record);
      }
      const queuedPlan = record.pendingPlan;
      record.pendingPlan = plan;
      const reusable =
        record.base !== null &&
        record.builtPlan !== null &&
        samePlan(record.builtPlan, plan);
      if (reusable) continue;
      // A decode failure is retried only after the plan or theme really
      // changes, so a broken image cannot form a rerasterization loop.
      if (record.failedPlan && samePlan(record.failedPlan, plan)) continue;
      // A refresh that observes the plan already being encoded must not bump
      // the revision and throw that work away.
      if (record.building && queuedPlan && samePlan(queuedPlan, plan)) continue;
      record.revision += 1;
      this.enqueue(record);
    }
    this.pump();
  }

  /** Enqueue one component; `building` jobs observe revisions and rebuild. */
  private enqueue(record: RasterRecord): void {
    if (record.building || this.queued.has(record)) return;
    if (!this.records.has(record.element)) return;
    this.queued.add(record);
    if (this.requested.has(record)) this.queue.unshift(record);
    else this.queue.push(record);
    this.pump();
  }

  /** Yield between encodes; explicit target requests precede idle sharpening. */
  private pump(): void {
    if (this.processing || this.pumpTimer !== null || !this.queue.length)
      return;
    const run = () => {
      this.pumpTimer = null;
      this.pumpIdle = false;
      this.processNext();
    };
    this.pumpIdle =
      this.requested.size === 0 &&
      typeof this.view.requestIdleCallback === "function";
    this.pumpTimer = this.pumpIdle
      ? this.view.requestIdleCallback(run, { timeout: 1000 })
      : this.view.setTimeout(run, 0);
  }

  /** Run one queued component, then yield before the next. */
  private processNext(): void {
    if (this.processing) return;
    // Encoding and palette sampling must never compete with interactive frames.
    // Keep the existing decoded image (or vectors) until navigation is idle.
    if (this.svg.classList.contains("navigating")) {
      this.pumpTimer = this.view.setTimeout(() => {
        this.pumpTimer = null;
        this.processNext();
      }, VIEWPORT_SETTLE_MS);
      return;
    }
    while (this.queue.length) {
      const record = this.queue.shift();
      if (!record) break;
      this.requested.delete(record);
      this.queued.delete(record);
      if (
        !this.isCurrent(record) ||
        record.building ||
        !record.pendingPlan ||
        this.isCulled(record)
      )
        continue;
      this.processing = true;
      void this.build(record).finally(() => {
        this.processing = false;
        if (!this.isCurrent(record)) {
          this.pump();
          return;
        }
        // A plan or palette change during the async encode needs a fresh run.
        if (
          record.revision !== record.builtRevision &&
          !record.building &&
          record.pendingPlan
        ) {
          this.enqueue(record);
          return;
        }
        this.pump();
      });
      return;
    }
  }

  /** True while a record is still installed in the observed SVG. */
  private isCurrent(record: RasterRecord): boolean {
    return (
      this.records.get(record.element) === record &&
      record.element.isConnected &&
      this.svg.contains(record.element)
    );
  }

  /** Cache key: renderer type, provider, theme/palette, bounds, and tier. */
  private drawingKey(
    record: RasterRecord,
    color: string,
    palette: string,
    plan: RecordPlan,
  ): string {
    return JSON.stringify([
      record.type,
      record.provider,
      this.themeRevision,
      color,
      palette,
      plan.base.bounds,
      plan.base.width,
      plan.base.height,
      plan.overlay
        ? [plan.overlay.bounds, plan.overlay.width, plan.overlay.height]
        : null,
    ]);
  }

  /** Most recently used shared drawing for this type/palette, if any. */
  private warmDrawing(
    record: RasterRecord,
    palette: string,
  ): SharedDrawing | undefined {
    // Prefer the tier another replica of this type is already displaying, so
    // an add/re-add keeps exact URL equality even if a navigation rebuild has
    // produced a newer tier elsewhere. During a whole-design swap the old
    // roots are disconnected but their displayed drawings are still the exact
    // pixels being replaced, so they beat an arbitrary latest map entry.
    let displayed: SharedDrawing | undefined;
    for (const other of this.records.values()) {
      const shared = other.shared;
      if (other === record || !other.base || !shared) continue;
      if (
        shared.type !== record.type ||
        shared.provider !== record.provider ||
        shared.color !== record.color ||
        shared.palette !== palette ||
        (shared.plan.overlay === null) !== (record.staticOverlay === null)
      )
        continue;
      if (other.element.isConnected) return shared;
      displayed = shared;
    }

    let matchKey: string | null = null;
    let match: SharedDrawing | undefined;
    for (const [key, drawing] of this.drawings) {
      if (
        drawing.type !== record.type ||
        drawing.provider !== record.provider ||
        drawing.color !== record.color ||
        drawing.palette !== palette ||
        (drawing.plan.overlay === null) !== (record.staticOverlay === null)
      )
        continue;
      matchKey = key;
      match = drawing;
    }
    if (matchKey && match) {
      // Refresh LRU order without changing which tier was selected.
      this.drawings.delete(matchKey);
      this.drawings.set(matchKey, match);
    }
    return displayed ?? match;
  }

  /** True when an async raster's palette snapshot is no longer current. */
  private stalePalette(
    record: RasterRecord,
    themeRevision: number,
    palette: string,
    color: string,
  ): boolean {
    return (
      themeRevision !== this.themeRevision ||
      palette !== this.paletteOf(record.element) ||
      color !== this.colorOf(record.element, record.type, record.provider)
    );
  }

  /**
   * Rasterize one record into its static image set.
   *
   * No visible DOM is mutated until every layer has decoded. A failed source
   * decode leaves the live vectors (and any previous image set) untouched.
   */
  private async build(record: RasterRecord): Promise<void> {
    record.building = true;
    const plan = record.pendingPlan;
    let baseUrl: string | null = null;
    let overlayUrl: string | null = null;
    try {
      const color = this.colorOf(record.element, record.type, record.provider);
      if (record.color !== color) {
        // The scene may recolor a retained component without a sync; the old
        // image cannot be trusted, so restore vectors for this job's snapshot.
        record.color = color;
        this.dropImages(record);
        record.builtPlan = null;
        record.failedPlan = null;
      }
      const revision = record.revision;
      record.builtRevision = revision;
      const themeRevision = this.themeRevision;
      const palette = this.paletteOf(record.element);
      if (!plan || !this.isCurrent(record) || this.isCulled(record)) return;
      if ((plan.overlay === null) !== (record.staticOverlay === null)) return;
      if (
        record.vectorsDetached &&
        (!record.styles || record.styles.palette !== palette)
      ) {
        // A palette change invalidates the displayed image. Restore live
        // vectors before sampling, because computed styles of detached
        // geometry are not reliable input for the next snapshot.
        record.styles = null;
        this.dropImages(record);
        record.builtPlan = null;
        record.failedPlan = null;
      } else if (record.styles && record.styles.palette !== palette) {
        record.styles = null;
      }

      const key = this.drawingKey(record, color, palette, plan);
      const shared = this.drawings.get(key);
      if (shared) {
        this.drawings.delete(key);
        this.drawings.set(key, shared);
        this.installShared(record, shared);
        this.trimDrawings();
        return;
      }

      const defs = this.svg.querySelector<SVGDefsElement>("defs");
      const styles = (record.styles ??= styleSheetFor(
        this.view,
        record,
        defs,
        color,
        palette,
      ));
      baseUrl = await this.rasterize(
        sourceFor(record, "base", plan.base, defs, styles),
        plan.base,
      );
      if (!baseUrl) {
        record.failedPlan = plan;
        return;
      }
      if (plan.overlay && record.staticOverlay) {
        overlayUrl = await this.rasterize(
          sourceFor(record, "overlay", plan.overlay, defs, styles),
          plan.overlay,
        );
        if (!overlayUrl) {
          record.failedPlan = plan;
          return;
        }
      }
      if (
        revision !== record.revision ||
        this.isCulled(record) ||
        !this.isCurrent(record)
      )
        return;
      if (this.stalePalette(record, themeRevision, palette, color)) {
        // The snapshot (and any displayed image) belongs to an old palette;
        // restore real vectors and let the scheduled refresh rebuild.
        record.styles = null;
        this.invalidate(record);
        return;
      }

      const baseImage = this.makeImage("base", plan.base, baseUrl);
      const overlayImage =
        overlayUrl && plan.overlay
          ? this.makeImage("overlay", plan.overlay, overlayUrl)
          : null;
      const baseLoad = imageLoaded(baseImage, this.view);
      const overlayLoad = overlayImage
        ? imageLoaded(overlayImage, this.view)
        : Promise.resolve(true);
      // Load pixels before claiming ownership; vectors remain visible until
      // every layer can be painted together.
      record.element.insertBefore(baseImage, this.baseAnchor(record));
      if (overlayImage) {
        record.element.insertBefore(overlayImage, this.overlayAnchor(record));
      }
      const [baseReady, overlayReady] = await Promise.all([
        baseLoad,
        overlayLoad,
      ]);
      if (!baseReady || !overlayReady) {
        record.failedPlan = plan;
        baseImage.remove();
        overlayImage?.remove();
        return;
      }
      if (
        revision !== record.revision ||
        this.isCulled(record) ||
        !this.isCurrent(record)
      ) {
        baseImage.remove();
        overlayImage?.remove();
        return;
      }
      if (this.stalePalette(record, themeRevision, palette, color)) {
        baseImage.remove();
        overlayImage?.remove();
        record.styles = null;
        this.invalidate(record);
        return;
      }

      baseImage.style.visibility = "";
      baseImage.classList.add("component-raster");
      if (overlayImage) {
        overlayImage.style.visibility = "";
        overlayImage.classList.add("component-raster");
      }
      record.base?.element.remove();
      record.overlay?.element.remove();
      record.base = { element: baseImage, url: baseUrl };
      record.overlay = overlayImage
        ? { element: overlayImage, url: overlayUrl! }
        : null;
      const pixels =
        plan.base.width * plan.base.height +
        (plan.overlay ? plan.overlay.width * plan.overlay.height : 0);
      const drawing: SharedDrawing = {
        type: record.type,
        provider: record.provider,
        base: baseUrl,
        overlay: overlayUrl,
        plan,
        bounds: record.bounds!,
        color,
        palette,
        pixels,
        styles,
      };
      this.drawings.set(key, drawing);
      record.shared = drawing;
      // Shared cache owns the URLs, independently of this replica's lifetime.
      baseUrl = null;
      overlayUrl = null;
      record.builtPlan = plan;
      record.failedPlan = null;
      record.element.dataset.rasterReady = "true";
      // Detached originals retain fallback/source data without participating
      // in SVG layout on every close-range camera update.
      this.detachVectors(record);
      record.element.dispatchEvent(new Event("component-raster-ready"));
      this.trimDrawings();
    } catch {
      // Leave the original vectors (and any previous image set) in place.
      record.failedPlan = plan ?? record.failedPlan;
    } finally {
      if (baseUrl) URL.revokeObjectURL(baseUrl);
      if (overlayUrl) URL.revokeObjectURL(overlayUrl);
      record.building = false;
    }
  }

  /** Painter-order anchor for the base static layer. */
  private baseAnchor(record: RasterRecord): Node | null {
    const motion = record.motion;
    if (motion && motion.parentNode === record.element) return motion;
    const overlay = record.staticOverlay;
    if (overlay && overlay.parentNode === record.element) return overlay;
    const label = record.label;
    return label && label.parentNode === record.element
      ? label
      : record.element.firstChild;
  }

  /** Painter-order anchor for the optional overlay static layer. */
  private overlayAnchor(record: RasterRecord): Node | null {
    const label = record.label;
    if (label && label.parentNode === record.element) return label;
    const motion = record.motion;
    return motion && motion.parentNode === record.element
      ? (motion.nextSibling ?? null)
      : null;
  }

  /** Create a hidden SVG image; insertion and loading are owned by `build`. */
  private makeImage(
    layer: LayerName,
    plan: LayerPlan,
    url: string,
  ): SVGImageElement {
    const image = this.document.createElementNS(NS, "image") as SVGImageElement;
    image.dataset.rasterLayer = layer;
    image.setAttribute("aria-hidden", "true");
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("x", String(plan.bounds.x));
    image.setAttribute("y", String(plan.bounds.y));
    image.setAttribute("width", String(plan.bounds.width));
    image.setAttribute("height", String(plan.bounds.height));
    image.style.visibility = "hidden";
    image.setAttribute("href", url);
    return image;
  }

  /** Encode one self-contained SVG source into a PNG object URL. */
  private async rasterize(
    source: string,
    plan: LayerPlan,
  ): Promise<string | null> {
    const sourceUrl = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml" }),
    );
    let canvas: HTMLCanvasElement | null = null;
    try {
      const image = await decodeImage(sourceUrl, this.view);
      canvas = this.document.createElement("canvas");
      canvas.width = plan.width;
      canvas.height = plan.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.clearRect(0, 0, plan.width, plan.height);
      context.drawImage(image, 0, 0, plan.width, plan.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas?.toBlob(resolve, "image/png"),
      );
      if (!blob) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(sourceUrl);
      // Drop the backing store before the next component so only displayed
      // rasters plus the current encoding canvas occupy memory.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  /** Remove images and restore the original vectors for one record. */
  private invalidate(record: RasterRecord): void {
    this.dropImages(record);
    record.builtPlan = null;
    record.failedPlan = null;
    record.revision += 1;
  }

  /** Theme changes invalidate every snapshot; vectors paint the new palette. */
  private invalidateAll(): void {
    this.themeRevision += 1;
    for (const record of this.records.values()) this.invalidate(record);
    for (const drawing of this.drawings.values()) {
      if (this.leases.has(drawing)) this.retired.add(drawing);
      else {
        URL.revokeObjectURL(drawing.base);
        if (drawing.overlay) URL.revokeObjectURL(drawing.overlay);
      }
    }
    this.drawings.clear();
    this.scheduleRefresh(0);
  }

  /** Detach one record's images and restore its live vectors. */
  private dropImages(record: RasterRecord): void {
    record.base?.element.remove();
    record.overlay?.element.remove();
    record.base = null;
    record.overlay = null;
    record.shared = null;
    this.restoreVectors(record);
    record.styles = null;
    delete record.element.dataset.rasterReady;
  }

  /** Release all state for a component that left the scene. */
  private release(record: RasterRecord): void {
    record.base?.element.remove();
    record.overlay?.element.remove();
    record.base = null;
    record.overlay = null;
    record.shared = null;
    delete record.element.dataset.rasterReady;
    this.records.delete(record.element);
    this.requested.delete(record);
    record.revision += 1;
  }

  /** Remove static vectors after an image set is visible. */
  private detachVectors(record: RasterRecord): void {
    if (record.vectorsDetached) return;
    record.staticBase.remove();
    record.staticOverlay?.remove();
    record.vectorsDetached = true;
  }

  /** Reinsert static vectors in painter order after cache invalidation. */
  private restoreVectors(record: RasterRecord): void {
    if (!record.vectorsDetached) return;
    if (record.staticOverlay) {
      record.element.insertBefore(
        record.staticOverlay,
        this.overlayAnchor(record),
      );
    }
    record.element.insertBefore(record.staticBase, this.baseAnchor(record));
    record.vectorsDetached = false;
  }

  /** Reuse already decoded pixels without sampling styles, encoding, or waiting. */
  private installShared(record: RasterRecord, drawing: SharedDrawing): void {
    const base = this.makeImage("base", drawing.plan.base, drawing.base);
    const overlay =
      drawing.overlay && drawing.plan.overlay
        ? this.makeImage("overlay", drawing.plan.overlay, drawing.overlay)
        : null;
    base.style.visibility = "";
    base.classList.add("component-raster");
    if (overlay) {
      overlay.style.visibility = "";
      overlay.classList.add("component-raster");
    }
    record.base?.element.remove();
    record.overlay?.element.remove();
    record.element.insertBefore(base, this.baseAnchor(record));
    if (overlay) {
      record.element.insertBefore(overlay, this.overlayAnchor(record));
    }
    record.base = { element: base, url: drawing.base };
    record.overlay = overlay
      ? { element: overlay, url: drawing.overlay! }
      : null;
    record.shared = drawing;
    record.builtPlan = drawing.plan;
    record.failedPlan = null;
    record.bounds = drawing.bounds;
    record.styles = drawing.styles;
    record.element.dataset.rasterReady = "true";
    this.detachVectors(record);
    record.element.dispatchEvent(new Event("component-raster-ready"));
  }

  /** Evict least-recent unused tiers; active replicas never lose their pixels. */
  private trimDrawings(): void {
    let pixels = 0;
    for (const drawing of this.drawings.values()) pixels += drawing.pixels;
    if (pixels <= RASTER_PIXEL_BUDGET) return;
    const active = new Set<string>();
    for (const record of this.records.values()) {
      if (record.base) active.add(record.base.url);
    }
    for (const drawing of this.leases.keys()) active.add(drawing.base);
    for (const [key, drawing] of this.drawings) {
      if (active.has(drawing.base)) continue;
      URL.revokeObjectURL(drawing.base);
      if (drawing.overlay) URL.revokeObjectURL(drawing.overlay);
      this.drawings.delete(key);
      pixels -= drawing.pixels;
      if (pixels <= RASTER_PIXEL_BUDGET) break;
    }
    // If every remaining drawing is active, the displayed tier set can exceed
    // the budget until records move to a smaller tier; evicting live pixels
    // would only force an immediate re-encode.
  }
}
