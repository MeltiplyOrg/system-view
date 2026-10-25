import type { PlacedInstance } from "./design";
import { findProvider } from "./providers";

const NS = "http://www.w3.org/2000/svg";

/** Rack-local world coordinate: [x, y, z] in model units. */
type Point = readonly [number, number, number];

/**
 * Project rack-local world coordinates into SVG user units.
 *
 * The view is a 30° isometric projection: +x runs down-right, +y down-left,
 * and +z up. One world unit maps to one SVG unit; translation and zoom are
 * owned by the scene's `viewBox`.
 */
export const project = (
  x: number,
  y: number,
  z: number,
): readonly [number, number] => [
  (x - y) * Math.cos(Math.PI / 6),
  (x + y) * 0.5 - z,
];

/** Projected rack-foot center; the scene aligns an instance position to it. */
export const DATABASE_ANCHOR = project(144, 75, 0);

/**
 * Build an SVG matrix that maps a face-local 2D system onto a projected plane.
 *
 * `origin` is the face's local (0, 0) corner, `u` its horizontal unit axis,
 * and `v` its vertical unit axis. Rounded rectangles and text can then be
 * drawn in ordinary local coordinates while SVG applies the isometric skew.
 */
const plane = (origin: Point, u: Point, v: Point): string => {
  const o = project(...origin),
    a = project(...u),
    b = project(...v);
  return `matrix(${a[0]} ${a[1]} ${b[0]} ${b[1]} ${o[0]} ${o[1]})`;
};

/** Top face at z=max, facing upward. */
const top = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 1, 0]);

/** Broad visible face at y=max, used for the glass side. */
const front = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 0, -1]);

/** Narrow end at x=max, used for drawer fascias and the switch. */
const side = (x: number, y: number, z: number) =>
  plane([x, y, z], [0, -1, 0], [0, 0, -1]);

/**
 * Project a polyline into an SVG path with two-decimal rounding.
 *
 * The caller appends `Z` when a closed face is required. Rounding keeps path
 * strings compact; the resulting error is far below one screen pixel at the
 * scene's fit scale.
 */
const path = (points: readonly Point[]) =>
  "M" +
  points
    .map((p) =>
      project(...p)
        .map((n) => n.toFixed(2))
        .join(" "),
    )
    .join("L");

// Geometry adapted from April Zhu's rack:
// https://isoglow.dev/demo/objects#rack.
// Shared definitions retain detail without copying chassis markup per object.

/**
 * Draw a box as one visible side wall plus its top face.
 *
 * `r` rounds all vertical corners, giving the cabinet its soft silhouette;
 * it is clamped to half the smaller dimension. The wall samples only the
 * front half of the rounded outline, because back faces are occluded by the
 * opaque fill. Faces must stay opaque: SVG has no depth buffer, so painter
 * order is the only depth sorting. Coordinates are rack-local world units.
 */
function box(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  r = 1,
): string {
  // Six samples per rounded corner are enough at illustration scale; more
  // segments only enlarge the shared SVG definitions.
  const arc = (
    cx: number,
    cy: number,
    a: number,
    b: number,
  ): [number, number][] =>
    Array.from({ length: 7 }, (_, i) => {
      const angle = a + ((b - a) * i) / 6;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });
  const q = Math.PI / 4,
    half = Math.PI / 2;

  // Full rounded rectangle used as the top-face outline.
  const ring = [
    ...arc(x + w - r, y + r, -half, 0),
    ...arc(x + w - r, y + d - r, 0, half),
    ...arc(x + r, y + d - r, half, 2 * half),
    ...arc(x + r, y + r, 2 * half, 3 * half),
  ];

  // Only the front-facing half of the outline is needed for the side wall.
  const visible = [
    ...arc(x + w - r, y + r, -q, 0),
    ...arc(x + w - r, y + d - r, 0, half),
    ...arc(x + r, y + d - r, half, 3 * q),
  ];

  // Wall = visible edge at the base followed by the reversed edge at the top.
  const wall: Point[] = [
    ...visible.map(([a, b]): Point => [a, b, z]),
    ...visible.reverse().map(([a, b]): Point => [a, b, z + h]),
  ];
  return `<path class="face" d="${path(wall)}Z"/><path class="face top" d="${path(ring.map(([a, b]): Point => [a, b, z + h]))}Z"/>`;
}

/**
 * Build repeated vertical detail lines as one path.
 *
 * Used for vents and slot texture. Batching avoids hundreds of SVG elements
 * and keeps the shared definitions small; values are face-local units.
 */
function slits(
  start: number,
  end: number,
  step: number,
  low: number,
  high: number,
): string {
  let d = "";
  for (let x = start; x <= end; x += step)
    d += `M${x.toFixed(2)} ${low}V${high}`;
  return `<path class="detail" d="${d}"/>`;
}

/**
 * Build a circle path using two arcs.
 *
 * Circles are merged into one path when used as screws or LEDs, reducing the
 * element count. Coordinates are face-local units; the caller owns placement.
 */
function circle(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

// Shared chassis dimensions in world units. The 240 × 92 cabinet sits on a
// 20-unit base; RF is the broad glass face and the drawers live on the narrow
// x=max end. UH is one rack unit (RU); each row subtracts 1.5 for a seam.
const RX = 24,
  RY = 22,
  RW = 240,
  RD = 92,
  RZ = 20,
  RF = 114;
const UH = 13;

// Bottom-to-top row stack. The tuple is [height in RU, visual kind]; display
// numbers count top-down so row 07 is the top of the cabinet. 4U storage and
// 2U storage rows get HDD caddies; other rows are compute drawers.
let nextZ = RZ + 2;
const units = (
  [
    [4, "store"],
    [2, "bays"],
    [1, "flat"],
    [2, "vent"],
    [1, "flat"],
    [2, "bays"],
    [1, "flat"],
  ] as const
).map(([height, kind], i) => {
  const unit = { n: 7 - i, kind, z: nextZ, h: height * UH - 1.5 };
  nextZ += height * UH;
  return unit;
});

// Switch sits above the last server row; the roof adds 20 units on top.
const SZ = nextZ,
  SH = 11.5,
  ZT = SZ + 16,
  TOPZ = ZT + 20;

/** Cabinet height above its base, in world units; used for view fitting. */
export const DATABASE_HEIGHT = TOPZ;

/**
 * Face-local X of a network jack (0–80 on the narrow end).
 * The 5-unit pitch keeps seven cables separate at fit scale.
 */
const portU = (n: number) => 46 + n * 5;

// Center of the switch jack in world z; the port rectangle is 4.4 units tall.
const switchZ = SZ + 9.5 - 4.4 / 2;

/**
 * Build the rear layer painted before cables.
 *
 * Includes the plinth, visible chassis walls, interior trays, glass side,
 * drawer fascias, rails, and switch. The broad y=max wall is intentionally
 * omitted: the tinted glass and internals replace it. No event handlers or
 * per-instance data belong here; this markup is shared through `<defs>`.
 */
function rearGeometry(): string {
  // Scene-level platform union replaces individual bottom plates and seams.
  let svg = box(RX + 6, RY + 6, 7, RW - 12, RD - 10, 10, 2);
  svg += box(RX, RY, 17, RW, RD, 3);
  svg += box(RX, RY, RZ, RW, 6, ZT - RZ);
  svg += box(RX, RY, RZ, 6, RD, ZT - RZ);
  svg += box(RX + RW - 5, RY, RZ, 5, RD, ZT - RZ);

  // Interiors are visible through the broad glass pane. Storage rows show
  // three cages; compute rows show a board, chip, and vent fields.
  svg += '<g class="rack-internals">';
  for (const u of units) {
    const storage = u.kind === "store" || u.kind === "bays";
    svg += box(RX + 12, RY + 8, u.z, RW - 24, RD - 16, 1.5);
    svg += `<g transform="${front(RX + 12, RF - 2, u.z + u.h)}">`;
    if (storage) {
      let cages = "",
        rails = "";
      for (let i = 0; i < 3; i++) {
        const x = 17 + i * 61;
        cages += `M${x} 3h54v${u.h - 6}h-54Z`;
        rails += `M${x + 5} 6v${u.h - 12}M${x + 49} 6v${u.h - 12}`;
      }
      svg += `<path class="internal-cage" d="${cages}"/><path class="detail" d="${rails}"/>`;
    } else {
      const chipHeight = Math.min(14, u.h - 6);
      svg += `<rect class="internal-board" x="14" y="2" width="184" height="${u.h - 4}" rx="1"/>
        <rect class="internal-chip" x="69" y="3" width="18" height="${chipHeight}" rx=".8"/>
        <path class="detail" d="M32 4h27v${Math.max(1, u.h - 8)}h-15M91 5h43"/>
        ${slits(99, 128, 3, 3, u.h - 3)}${slits(153, 178, 5, 3, u.h - 3)}`;
    }
    svg += "</g>";
  }
  svg += "</g>";

  // Glass frame: the even-odd path cuts the pane out of the solid frame.
  // Reflections are clipped to the pane and kept at low opacity.
  const sideScrews = [
    [5, 6],
    [235, 6],
    [5, 181],
    [235, 181],
  ]
    .map(([x, y]) => circle(x, y, 1.1))
    .join("");
  svg += `<g class="glass-side" transform="${front(RX, RF, ZT)}">
    <path class="face" fill-rule="evenodd" d="M0 0H240V187H0Z M10 10V177H230V10Z"/>
    <rect class="glass-pane" x="10" y="10" width="220" height="167" rx="2"/>
    <g clip-path="url(#rack-glass-clip)"><path class="glass-reflection" d="M24 12L110 175H122L36 12Z M57 12L143 175H146L60 12Z"/></g>
    <path class="detail" d="${sideScrews}"/>
    <rect class="face recess" x="218" y="84" width="8" height="18" rx="1.5"/>
    <path class="detail" d="M221 89v8"/>
  </g>`;

  // Drawer fascias live on the narrow x=max face. Storage rows get six
  // vertical hot-swap caddies per row; compute rows get a pull and vents.
  // All of this is visual only: no row is a control.
  for (const u of units) {
    const middle = u.h / 2,
      storage = u.kind === "store" || u.kind === "bays";
    svg += `<g class="drawer-module ${storage ? "storage-drawer" : "compute-drawer"}" transform="${side(RX + RW, RF, u.z + u.h)}">
      <rect class="face drawer-front" x="6" y=".7" width="80" height="${u.h - 1.4}" rx="1.2"/>
      <path class="detail" d="M8 2.5H84"/>`;
    let leds = circle(82, middle, 0.9);
    if (storage) {
      // Six vertical hot-swap HDD caddies per row; 4U storage has two rows.
      const rows = u.kind === "store" ? 2 : 1;
      const caddyHeight = (u.h - 11) / rows - 1;
      let slots = "",
        latches = "",
        seams = "";
      for (let row = 0; row < rows; row++) {
        const y = 9 + row * (caddyHeight + 1);
        for (let col = 0; col < 6; col++) {
          const x = 10 + col * 11.5;
          slots += `M${x} ${y}h8.5v${caddyHeight}h-8.5Z`;
          seams += `M${x + 4.25} ${y + 3}v${Math.max(1, caddyHeight - 9)}`;
          latches += `M${x + 2} ${y + caddyHeight - 2}v-2.5h4.5v2.5`;
          leds += circle(x + 6.2, y + 2.5, 0.6);
        }
      }
      svg += `<text class="label" x="10" y="6.5" font-size="4">${String(u.n).padStart(2, "0")}</text>
        <path class="hdd-caddies face recess" d="${slots}"/><path class="detail" d="${seams}"/><path class="drawer-tray-pull" d="${latches}"/>`;
    } else {
      svg += `<rect class="drawer-pocket" x="11" y="${middle - 3.5}" width="24" height="7" rx="1.5"/>
        <path class="drawer-pull" d="M14 ${middle + 1.8}v-3.6h18v3.6"/>
        <text class="label" x="38" y="${middle + 1.8}" font-size="4.5">${String(u.n).padStart(2, "0")}</text>
        ${slits(47, 76, 4, Math.max(3, middle - 4), Math.min(u.h - 3, middle + 4))}`;
    }
    svg += `<path class="led" d="${leds}"/><rect class="port" x="${portU(u.n) - 2.1}" y="3.5" width="4.2" height="4.4" rx=".5"/></g>`;
  }

  // Switch fascia and its seven destination jacks.
  svg += `<g transform="${side(RX + RW, RF, SZ + SH)}">
    <rect class="face drawer-front" x="6" y=".7" width="80" height="${SH - 1.4}" rx="1.2"/>
    <text class="label" x="10" y="8" font-size="5">SW</text>
    ${slits(25, 40, 3, 3, SH - 3)}
    ${units.map((u) => `<rect class="port" x="${portU(u.n) - 2.1}" y="${SH - 9.5}" width="4.2" height="4.4" rx=".5"/>`).join("")}
  </g>`;

  // Front rails with mounting holes.
  let holes = "";
  for (let v = 4; v < ZT - RZ - 4; v += 4.33) holes += circle(2.5, v, 0.75);
  for (const u of [0, RD - 5]) {
    svg += `<g transform="${side(RX + RW, RF, ZT - 2)}">
      <rect class="face" x="${u}" width="5" height="${ZT - RZ - 2}"/>
      <g transform="translate(${u} 0)"><path class="detail" d="${holes}"/></g>
    </g>`;
  }
  return svg;
}

/**
 * Build the roof layer painted after cables.
 *
 * Cables terminate on the narrow face and must pass under the roof's front
 * strip. Only the top fans and roof outline are shared; the per-instance
 * database name is added by `DatabaseRack`.
 */
function frontGeometry(): string {
  // Roof is painted after the cables; its front strip carries only the database name.
  let svg = box(RX, RY, ZT, RW, RD, 20, 4);
  const fan = (cx: number, cy: number) =>
    `<circle class="face recess" cx="${cx}" cy="${cy}" r="24"/><path class="detail" d="${[20, 14, 8].map((r) => circle(cx, cy, r)).join("")}"/>`;
  svg += `<g transform="${top(RX, RY, TOPZ)}"><rect class="detail" x="6" y="6" width="228" height="80" rx="3"/>${fan(66, 46)}${fan(174, 46)}${slits(104, 136, 3.2, 24, 68)}</g>`;
  return svg;
}

/**
 * Seven cubic cables from each row jack to the matching switch jack.
 *
 * Each curve bows out from the narrow face by an amount that grows with the
 * vertical run. `pathLength="100"` normalizes dash distance so one CSS
 * dash/gap pattern works for every cable regardless of length. The reversed
 * stack gives stable painter ordering at shared port columns.
 *
 * The static wire and the animated pulse are rendered as separate layers: the
 * raster cache replaces only the static chassis, while every `.pulse` stays a
 * live vector element in the rack DOM. Keeping pulse timing in the curve data
 * avoids a second geometry pass when the two layers are built.
 */
const cableCurves = units
  .slice()
  .reverse()
  .map((u) => {
    const y = RF - portU(u.n),
      z = u.z + u.h - 5.7,
      bow = 7 + 0.09 * (switchZ - z);
    const [a, b, c, d] = [
      [RX + RW, y, z],
      [RX + RW + bow, y, z - 1],
      [RX + RW + bow, y, switchZ - 4],
      [RX + RW, y, switchZ],
    ].map((p) =>
      project(p[0], p[1], p[2])
        .map((n) => n.toFixed(2))
        .join(" "),
    );
    return {
      curve: `M${a}C${b} ${c} ${d}`,
      duration: 1.8 + u.n * 0.17,
      delay: -u.n * 0.43,
    };
  });

/** Static cable bodies; these are safe to replace with one cached image. */
const cables = cableCurves
  .map(
    ({ curve }) =>
      `<g class="cable"><path class="wire-under" d="${curve}"/><path class="wire-glow" d="${curve}"/><path class="wire" d="${curve}"/></g>`,
  )
  .join("");

/**
 * Live pulse paths, painted between the cached rear and roof layers.
 *
 * The original markup placed pulses inside each `.cable` before the roof so
 * the roof strip occluded their switch ends. `DatabaseRack` preserves that
 * painter order with two static groups and this overlay between them.
 */
const cablePulses = cableCurves
  .map(
    ({ curve, duration, delay }) =>
      `<path class="pulse" pathLength="100" style="--duration:${duration}s;--delay:${delay}s" d="${curve}"/>`,
  )
  .join("");

/**
 * Create the shared `<defs>` required by every Database Rack.
 *
 * Must be appended exactly once per scene before any rack instance. The two
 * clip paths and rear/front groups are referenced by ID from each instance.
 * A `<g>` is used instead of `<symbol>` because symbols introduce an implicit
 * viewport that would clip negative face coordinates.
 */
export function createDatabaseDefinitions(): SVGDefsElement {
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `<clipPath id="rack-name-clip" clipPathUnits="userSpaceOnUse"><rect x="8" y="2" width="76" height="16"/></clipPath><clipPath id="rack-glass-clip" clipPathUnits="userSpaceOnUse"><rect x="10" y="10" width="220" height="167" rx="2"/></clipPath><g id="rack-rear">${rearGeometry()}</g><g id="rack-front">${frontGeometry()}</g>`;
  return defs;
}

/**
 * Print one provider mark on the roof fascia's enamel plate.
 *
 * The provider theme carries the exact upstream SVG once, for both the tooltip
 * and this object badge. Re-wrap its inner artwork with a fixed viewBox so the
 * mark scales onto the face-local plate without altering any path. The plate is
 * light in both themes; the mark variants are chosen for contrast on it, and
 * the whole badge is part of the rasterized roof overlay.
 *
 * @param logo - Self-contained provider SVG from `ProviderTheme.logo`.
 * @returns Face-local badge group, or an empty string if the mark is malformed.
 */
function providerBadge(logo: string): string {
  const viewBox = /viewBox="([^"]+)"/.exec(logo)?.[1],
    art = logo
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>[\s\S]*$/, "");
  if (!viewBox || !art) return "";
  return `<g class="rack-provider-badge" transform="${front(RX, RF, TOPZ)}">
    <rect class="rack-accent-line" x="8" y="1.2" width="184" height="1.2" rx=".6"/>
    <rect class="brand-plate" x="198" y="1.5" width="38" height="17" rx="2.2"/>
    <svg x="203" y="3" width="28" height="14" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${art}</svg>
  </g>`;
}

/**
 * SVG renderer for one Database Rack.
 *
 * The element is a `<g>` containing two static layers (shared rear markup plus
 * static cable bodies, then shared roof markup), a live pulse overlay between
 * them, and a per-instance nameplate. Splitting the static layers around the
 * pulses preserves the original back-to-front paint order: the roof still
 * covers cable ends, while the shared raster cache can replace both static
 * layers with cached images without touching labels or animation. The static
 * layers carry both the rack-specific and generic cache classes, and the root
 * exposes `data-renderer-type` for that cache.
 *
 * It has no event listeners or internal state; the scene owns placement.
 * Instances rely on the IDs produced by `createDatabaseDefinitions`, so that
 * function must run first.
 */
export class DatabaseRack {
  /** Ready-to-append group; caller applies the scene translation. */
  readonly element = document.createElementNS(NS, "g");

  /**
   * Render a validated instance.
   *
   * The instance color becomes `--cable-color` and is inherited by cables,
   * ports, LEDs, and glass tint. The label is assigned with `textContent`, so
   * imported text cannot inject markup. Labels longer than 16 characters are
   * compressed into the 74-unit clip region; aria-label exposes the full name
   * to assistive technology without triggering browser hover tooltips.
   *
   * @throws Error indirectly if the DOM or shared defs are unavailable.
   */
  constructor(instance: PlacedInstance) {
    this.element.classList.add("database-rack");
    this.element.dataset.rendererType = "database-rack";
    this.element.dataset.instanceId = instance.id;
    this.element.style.setProperty("--cable-color", instance.color);
    const theme = findProvider(instance.provider, "database-rack"),
      badge = theme ? providerBadge(theme.logo) : "";
    this.element.innerHTML = `<g class="rack-static rack-static-base component-static-base" aria-hidden="true"><use href="#rack-rear"/>${cables}</g><g class="rack-pulses component-motion" aria-hidden="true">${cablePulses}</g><g class="rack-static rack-static-roof component-static-overlay" aria-hidden="true"><use href="#rack-front"/>${badge}</g>`;

    // Plain identity lettering on the top strip of the narrow drawer face.
    const nameplate = document.createElementNS(NS, "g");
    nameplate.classList.add("rack-nameplate", "component-label");
    nameplate.setAttribute("transform", side(RX + RW, RF, TOPZ));
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", "8");
    label.setAttribute("y", "12.5");
    label.setAttribute("clip-path", "url(#rack-name-clip)");
    label.classList.add("instance-label");
    label.textContent = instance.label;
    if (instance.label.length > 16) {
      label.setAttribute("textLength", "74");
      label.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
    nameplate.append(label);
    this.element.append(nameplate);

    this.element.setAttribute("role", "img");
    this.element.setAttribute(
      "aria-label",
      `${instance.label} (${instance.id}) · Database Rack`,
    );
  }
}
