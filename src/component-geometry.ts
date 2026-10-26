import { project } from "./database";

/** Local world coordinate: [x, y, z] in model units. */
type Point = readonly [number, number, number];

/** Two-decimal formatting keeps paths compact without visible error. */
const fixed = (value: number): string => value.toFixed(2);

/**
 * Build an SVG matrix mapping a face-local 2D system onto a projected plane.
 *
 * The renderer reuses the rack's isometric projection so every component
 * shares the same camera. Detail can therefore be drawn as ordinary `<rect>`
 * and `<path>` markup in face coordinates and let SVG apply the skew.
 */
function plane(origin: Point, u: Point, v: Point): string {
  const o = project(...origin),
    a = project(...u),
    b = project(...v);
  return `matrix(${a[0]} ${a[1]} ${b[0]} ${b[1]} ${o[0]} ${o[1]})`;
}

/** Upward-facing plane at height z. */
const topFace = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 1, 0]);

/** Broad wall at y=max; local +x runs right, local +y runs down. */
const frontFace = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 0, -1]);

/** Narrow end wall at x=max; local +x runs rearward, local +y runs down. */
const endFace = (x: number, y: number, z: number) =>
  plane([x, y, z], [0, -1, 0], [0, 0, -1]);

/**
 * Projected silhouette of a box.
 *
 * Two visible walls and the top face are emitted separately. Unlike a single
 * silhouette path, the shared vertical edge stays stroked, which is what makes
 * the three faces legible in the drawing's technical register. Faces must be
 * opaque because painter order is the only depth sort.
 */
function box(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  radius = 1.2,
): string {
  const top = z + height;
  return `<g transform="${endFace(x + width, y + depth, top)}"><rect class="face" width="${depth}" height="${height}" rx="${radius}"/></g><g transform="${frontFace(x, y + depth, top)}"><rect class="face" width="${width}" height="${height}" rx="${radius}"/></g><g transform="${topFace(x, y, top)}"><rect class="face top" width="${width}" height="${depth}" rx="${radius}"/></g>`;
}

/** Circle path built from two arcs; used for LEDs, screws, and fan rings. */
function circle(cx: number, cy: number, radius: number): string {
  return `M${fixed(cx - radius)} ${fixed(cy)}a${fixed(radius)} ${fixed(radius)} 0 1 0 ${fixed(2 * radius)} 0a${fixed(radius)} ${fixed(radius)} 0 1 0 ${fixed(-2 * radius)} 0`;
}

/** Vertical detail lines, batched into one path to keep markup compact. */
function slits(
  start: number,
  end: number,
  step: number,
  low: number,
  high: number,
): string {
  let d = "";
  for (let x = start; x <= end; x += step)
    d += `M${fixed(x)} ${fixed(low)}V${fixed(high)}`;
  return d;
}

/** Horizontal detail lines, used for side-face vent stacks. */
function rows(
  start: number,
  end: number,
  step: number,
  low: number,
  high: number,
): string {
  let d = "";
  for (let y = start; y <= end; y += step)
    d += `M${fixed(low)} ${fixed(y)}H${fixed(high)}`;
  return d;
}

/** Recessed fan: bezel, two guide rings, seven blades, and an accent hub. */
function fan(cx: number, cy: number, radius: number): string {
  const hub = radius * 0.24;
  let blades = circle(cx, cy, radius * 0.74);
  for (let i = 0; i < 7; i++) {
    const start = (i / 7) * Math.PI * 2,
      end = start + 0.58,
      middle = start + 0.29,
      x1 = cx + Math.cos(start) * hub,
      y1 = cy + Math.sin(start) * hub,
      x2 = cx + Math.cos(end) * radius * 0.76,
      y2 = cy + Math.sin(end) * radius * 0.76,
      controlX = cx + Math.cos(middle) * radius * 0.5,
      controlY = cy + Math.sin(middle) * radius * 0.5;
    blades += `M${fixed(x1)} ${fixed(y1)}Q${fixed(controlX)} ${fixed(controlY)} ${fixed(x2)} ${fixed(y2)}`;
  }
  return `<path class="face recess" d="${circle(cx, cy, radius)}"/><path class="detail" d="${blades}"/><path class="led" d="${circle(cx, cy, Math.max(1, radius * 0.11))}"/>`;
}

export { box, circle, endFace, fan, fixed, frontFace, rows, slits, topFace };
