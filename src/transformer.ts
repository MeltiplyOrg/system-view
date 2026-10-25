import { project } from "./database";
import { assemblyCuts, assemblyPose } from "./assembly";
import type {
  TransformerEnvelope,
  TransformerSnapshot,
} from "./transformer-model";

const NS = "http://www.w3.org/2000/svg";
let nextRig = 0;

/** Existing artwork and borrowed decoded pixels, positioned in the new instance. */
export interface TransformerAppearance {
  envelope: TransformerEnvelope;
  snapshot: TransformerSnapshot;
  transform: DOMMatrix;
}

/** A scene-owned clock drives the assembly; disposing releases both image leases. */
export interface TransformerRig {
  element: SVGGElement;
  render(progress: number): void;
  dispose(): void;
}

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** All transient actors are small SVG image references, never artwork clones. */
function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, name);
}

/**
 * One section follows the cabinet's isometric front/side contour, not a flat
 * screen-space horizontal wipe. Null edges include the complete plinth or roof.
 * Adjacent sections share exact boundaries; seated sections are consolidated
 * into one image to prevent clipping seams between completed layers.
 */
function band(
  e: TransformerEnvelope,
  bounds: Bounds,
  low: number | null,
  high: number | null,
): string {
  const corner = project(e.x + e.width, e.y + e.depth, 0);
  const xs = [bounds.left, corner[0], bounds.right];
  const edge = (z: number | null, outer: number): string[] =>
    xs.map(
      (x) =>
        `${x} ${z === null ? outer : corner[1] - Math.abs(x - corner[0]) / Math.sqrt(3) - z}`,
    );
  return `M${edge(high, bounds.top).join("L")}L${edge(low, bounds.bottom).reverse().join("L")}Z`;
}

/** Close an exposed section with a horizontal deck, not hollow sliced walls. */
function sectionTop(e: TransformerEnvelope, z: number): string {
  return `M${[
    project(e.x, e.y, z),
    project(e.x + e.width, e.y, z),
    project(e.x + e.width, e.y + e.depth, z),
    project(e.x, e.y + e.depth, z),
  ]
    .map((p) => p.join(" "))
    .join("L")}Z`;
}

/**
 * Two image actors represent a stack: completed lower sections and the next
 * section seating above them. All contour clips are prepared once. Frame work
 * changes only the completed boundary, the active section, and its short lift.
 */
function stack(
  appearance: TransformerAppearance,
  id: string,
  defs: SVGDefsElement,
) {
  const { envelope, snapshot } = appearance;
  const texture = svg("g");
  texture.id = `${id}-texture`;
  texture.append(...snapshot.images.map((image) => image.cloneNode(false)));
  defs.append(texture);
  const boxes = snapshot.images.map((image) => ({
    x: Number(image.getAttribute("x")),
    y: Number(image.getAttribute("y")),
    width: Number(image.getAttribute("width")),
    height: Number(image.getAttribute("height")),
  }));
  const bounds: Bounds = {
    left: Math.min(...boxes.map((b) => b.x)) - 1,
    right: Math.max(...boxes.map((b) => b.x + b.width)) + 1,
    top: Math.min(...boxes.map((b) => b.y)) - 1,
    bottom: Math.max(...boxes.map((b) => b.y + b.height)) + 1,
  };
  const cuts = assemblyCuts(envelope),
    count = cuts.length + 1;
  const sections = Array.from({ length: count }, (_, i) =>
    band(envelope, bounds, cuts[i - 1] ?? null, cuts[i] ?? null),
  );
  const completed = Array.from({ length: count + 1 }, (_, i) =>
    i === 0 ? "" : band(envelope, bounds, null, cuts[i - 1] ?? null),
  );
  const root = svg("g");
  root.setAttribute("transform", appearance.transform.toString());
  const decks = cuts.map((z) => sectionTop(envelope, z));
  root.dataset.layerCount = String(count);
  const actors = ["seated", "seating"].map((role) => {
    const clip = svg("clipPath");
    clip.id = `${id}-${role}`;
    clip.setAttribute("clipPathUnits", "userSpaceOnUse");
    const path = svg("path");
    clip.append(path);
    defs.append(clip);
    const node = svg("g");
    node.dataset.assemblyActor = role;
    const deck = svg("path");
    deck.setAttribute("class", "assembly-deck");
    const view = svg("g");
    view.setAttribute("clip-path", `url(#${clip.id})`);
    const use = svg("use");
    use.setAttribute("href", `#${texture.id}`);
    view.append(use);
    node.append(deck, view);
    root.append(node);
    return { node, path, deck };
  });
  const [seated, seating] = actors;
  let previousSettled = -1,
    previousActive: number | null | undefined;
  const render = (progress: number): void => {
    const pose = assemblyPose(progress, count);
    if (pose.settled !== previousSettled) {
      seated.node.style.display = pose.settled ? "" : "none";
      seated.path.setAttribute("d", completed[pose.settled]);
      seated.deck.style.display =
        pose.settled > 0 && pose.settled < count ? "" : "none";
      if (pose.settled > 0 && pose.settled < count)
        seated.deck.setAttribute("d", decks[pose.settled - 1]);
      root.dataset.assembledLayers = String(pose.settled);
      previousSettled = pose.settled;
    }
    if (pose.active !== previousActive) {
      seating.node.style.display = pose.active === null ? "none" : "";
      if (pose.active !== null) {
        seating.path.setAttribute("d", sections[pose.active]);
        seating.deck.style.display = pose.active < count - 1 ? "" : "none";
        if (pose.active < count - 1)
          seating.deck.setAttribute("d", decks[pose.active]);
        seating.node.dataset.assemblyLayer = String(pose.active);
      } else delete seating.node.dataset.assemblyLayer;
      previousActive = pose.active;
    }
    if (pose.active !== null)
      seating.node.setAttribute("transform", `translate(0 ${pose.lift})`);
  };
  return { root, render };
}

/**
 * Remove the old stack top-down, then build the actual target artwork bottom-up:
 * plinth → stacked body sections → top cap. No doors, skeleton, picture morph,
 * fading, or large part travel. At most one section per stack is in motion;
 * completed lower layers stay rigid and registered with the platform.
 * Surface textures come from the shared cache; small horizontal decks close
 * exposed sections until the real roof arrives. Two image actors per stack.
 * Cancellation and normal completion both release the borrowed URLs.
 */
export function createTransformerRig(
  from: TransformerAppearance,
  to: TransformerAppearance,
): TransformerRig {
  const id = `transformer-${++nextRig}`;
  const element = svg("g");
  element.classList.add("transformer-rig");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("pointer-events", "none");
  const defs = svg("defs");
  element.append(defs);
  const source = stack(from, `${id}-old`, defs),
    target = stack(to, `${id}-new`, defs);
  source.root.dataset.assemblyStack = "source";
  target.root.dataset.assemblyStack = "target";
  element.append(source.root, target.root);
  let disposed = false;
  const render = (progress: number): void => {
    if (disposed) return;
    const p = Math.max(0, Math.min(1, progress));
    element.dataset.phase = p < 0.18 ? "unstack" : p < 0.88 ? "build" : "cap";
    source.render(1 - p / 0.18);
    target.render((p - 0.18) / 0.82);
  };
  render(0);
  return {
    element,
    render,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      element.remove();
      from.snapshot.release();
      to.snapshot.release();
    },
  };
}
