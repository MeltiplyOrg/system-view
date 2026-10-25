import {
  DATABASE_ANCHOR,
  DATABASE_HEIGHT,
  DatabaseRack,
  project,
} from "./database";
import type { PlacedInstance } from "./design";
import { REDIS_LOGO_ART, findProvider } from "./providers";

const NS = "http://www.w3.org/2000/svg";

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

// ---------------------------------------------------------------------------
// Compute server
// ---------------------------------------------------------------------------

/**
 * Horizontal server geometry, in local world units.
 *
 * The machine is deliberately low and wide: a 272 × 136 tray carries a
 * 260 × 124 × 46 chassis, and a raised processor heatsink lifts the silhouette
 * to z=70. It therefore reads as a rack-mounted compute node rather than a
 * second cabinet while staying inside the shared 288 × 150 footprint.
 */
const COMPUTE_BASE_Z = 7,
  COMPUTE_BODY_Z = 12,
  COMPUTE_BODY_W = 260,
  COMPUTE_BODY_D = 124,
  COMPUTE_BODY_H = 46,
  COMPUTE_TOP_Z = COMPUTE_BODY_Z + COMPUTE_BODY_H,
  COMPUTE_HEIGHT = 70;

/** Front panel: drive caddies, two fans, and the power/link cluster. */
function computeFront(): string {
  // Ten hot-swap bays in a 5 × 2 grid. Drawing them as one compound path keeps
  // the per-instance DOM small while each caddy keeps its own seam and latch.
  let slots = "",
    seams = "",
    latches = "",
    leds = "";
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < 5; column++) {
      const x = 8 + column * 19,
        y = 13 + row * 15.5;
      slots += `M${x} ${y}h18v14h-18Z`;
      seams += `M${x + 4} ${y + 2.5}v9M${x + 14} ${y + 2.5}v9`;
      latches += `M${x + 6.5} ${y + 11.6}h5`;
      leds += circle(x + 15.3, y + 3.1, 0.62);
    }

  return `<g transform="${frontFace(-130, 62, COMPUTE_TOP_Z)}">
    <rect class="face recess" x="4" y="1.5" width="252" height="8.5" rx="1"/>
    <rect class="face recess" x="5" y="11" width="250" height="33" rx="1.5"/>
    <rect class="led" x="5" y="10.3" width="250" height=".8" rx=".4"/>
    <path class="face drawer-front" d="${slots}"/>
    <path class="detail" d="${seams}"/>
    <path class="drawer-tray-pull" d="${latches}"/>
    <path class="led" d="${leds}"/>
    <rect class="face" x="106" y="12" width="68" height="31" rx="1.5"/>
    ${fan(123, 27.5, 12.5)}${fan(157, 27.5, 12.5)}
    <path class="detail" d="M176 13V42"/>
    <path class="face recess" d="${circle(188, 24, 5)}"/>
    <path class="detail" d="${circle(188, 24, 3.2)}"/>
    <path class="led" d="${circle(188, 24, 1.7)}"/>
    <text class="label" x="181" y="38.5" font-size="3.8">PWR</text>
    <rect class="port" x="201" y="16.5" width="6" height="3.6" rx=".5"/>
    <rect class="port" x="209" y="16.5" width="6" height="3.6" rx=".5"/>
    <path class="detail" d="M201 23h14"/>
    <text class="label" x="201" y="38.5" font-size="3.6">USB</text>
    <path class="led" d="${circle(202, 28, 1.1)}${circle(208, 28, 1.1)}${circle(214, 28, 1.1)}"/>
    <path class="detail" d="${circle(220, 24, 0.85)}"/>
    <path class="detail" d="${slits(228, 248, 4, 15.5, 39)}"/>
    <path class="drawer-pull" d="M2 32V17h4v15M258 32V17h-4v15"/>
    <path class="led" d="${circle(250, 5.7, 0.9)}"/>
  </g>`;
}

/** Top deck: memory banks, airflow, and board routing around the heatsink. */
function computeTop(): string {
  let svg = `<g transform="${topFace(-130, -62, COMPUTE_TOP_Z)}">
    <path class="detail" d="M7 5H253A2 2 0 0 1 255 7V117A2 2 0 0 1 253 119H7A2 2 0 0 1 5 117V7A2 2 0 0 1 7 5Z"/>
    <path class="detail" d="${slits(14, 40, 3.2, 16, 106)}"/>
    <text class="label" x="14" y="12.5" font-size="4.2">AIR</text>
    <rect class="face recess" x="218" y="14" width="34" height="38" rx="1.5"/>
    <path class="detail" d="${rows(18, 46, 3.2, 222, 248)}"/>
    <text class="label" x="221" y="58" font-size="4.2">PSU</text>
    <path class="detail" d="${circle(11, 11, 1.3)}${circle(249, 11, 1.3)}${circle(11, 113, 1.3)}${circle(249, 113, 1.3)}"/>
    <path d="M126 48h8M126 64h8M126 80h8" style="fill:none;stroke:var(--cable-color);stroke-width:.9;vector-effect:non-scaling-stroke;opacity:.6"/>
  </g>`;

  // Memory slots sit clear of the heatsink footprint so the raised block reads
  // as a separate object. Eight slots and their clips fill the right-hand bay.
  let slots = "",
    clips = "",
    memoryLeds = "";
  for (let index = 0; index < 8; index++) {
    const x = 136 + index * 9.5;
    slots += `M${x} 28h5.5v64h-5.5Z`;
    clips += `M${x + 1} 32h3.5M${x + 1} 88h3.5M${x + 2.75} 37v46`;
    memoryLeds += circle(x + 2.75, 91, 0.62);
  }
  svg += `<g transform="${topFace(-130, -62, COMPUTE_TOP_Z)}">
    <path class="face recess" d="${slots}"/>
    <path class="detail" d="${clips}"/>
    <path class="detail" d="M135 26V94"/>
    <path class="led" d="${memoryLeds}"/>
    <text class="label" x="140" y="22" font-size="4.2">DIMM</text>
  </g>`;

  // Heatsink is painted after the deck so its walls occlude the board below.
  svg += box(-76, -26, COMPUTE_TOP_Z, 68, 60, 12, 1.5);
  svg += `<g transform="${topFace(-76, -26, COMPUTE_HEIGHT)}">
    <path class="detail" d="M5.5 4H62.5A1.5 1.5 0 0 1 64 5.5V54.5A1.5 1.5 0 0 1 62.5 56H5.5A1.5 1.5 0 0 1 4 54.5V5.5A1.5 1.5 0 0 1 5.5 4Z"/>
    <path class="detail" d="${slits(8, 60, 3.4, 8, 52)}"/>
    <rect class="face recess" x="24" y="18" width="20" height="24" rx="1"/>
    <rect class="internal-chip" x="29" y="23" width="10" height="14" rx=".6"/>
    <path class="detail" d="${circle(27, 21, 0.8)}${circle(41, 21, 0.8)}${circle(27, 39, 0.8)}${circle(41, 39, 0.8)}"/>
    <text class="label" x="25.5" y="15.5" font-size="3.6">CPU</text>
  </g>`;
  return svg;
}

/** Rear I/O on the narrow end: vents, network ports, power, and handle. */
function computeEnd(): string {
  return `<g transform="${endFace(130, 62, COMPUTE_TOP_Z)}">
    <rect class="face recess" x="4" y="11" width="116" height="32" rx="1.5"/>
    <rect class="led" x="4" y="10.3" width="116" height=".8" rx=".4"/>
    <path class="detail" d="${rows(14, 38, 3.2, 8, 30)}"/>
    <path class="detail" d="M35 13V41"/>
    <rect class="port" x="41" y="14" width="9" height="6.5" rx=".6"/>
    <rect class="port" x="54" y="14" width="9" height="6.5" rx=".6"/>
    <rect class="port" x="41" y="24" width="9" height="6.5" rx=".6"/>
    <rect class="port" x="54" y="24" width="9" height="6.5" rx=".6"/>
    <path class="led" d="${circle(43, 16, 0.7)}${circle(56, 16, 0.7)}${circle(43, 26, 0.7)}${circle(56, 26, 0.7)}"/>
    <text class="label" x="41" y="39.5" font-size="3.8">LAN</text>
    <rect class="face recess" x="76" y="14" width="14" height="10" rx="1"/>
    <path class="detail" d="M80 17h6v4h-6Z"/>
    <text class="label" x="76" y="39.5" font-size="3.8">PSU</text>
    <path class="led" d="${circle(100, 16, 1.1)}${circle(106, 16, 1.1)}${circle(112, 16, 1.1)}"/>
    <text class="label" x="99" y="39.5" font-size="3.8">OK</text>
    <text class="label" x="100" y="27" font-size="4.2">2U</text>
    <path class="drawer-pull" d="M117 31V20h4v11"/>
    <path class="detail" d="${circle(9, 13, 0.8)}${circle(9, 41, 0.8)}"/>
  </g>`;
}

/** Full static compute-server markup, painted back to front. */
function computeGeometry(): string {
  let svg = box(-136, -68, COMPUTE_BASE_Z, 272, 136, 5, 2.5);
  svg += `<g transform="${frontFace(-136, 68, COMPUTE_BASE_Z + 5)}">
    <path class="detail" d="M8 2.5H264"/>
    <path class="detail" d="${circle(10, 2.5, 1.1)}${circle(262, 2.5, 1.1)}"/>
  </g>`;
  svg += `<g transform="${endFace(136, 68, COMPUTE_BASE_Z + 5)}">
    <path class="detail" d="M8 2.5H128"/>
    <path class="detail" d="${circle(10, 2.5, 1.1)}${circle(126, 2.5, 1.1)}"/>
  </g>`;
  svg += box(
    -130,
    -62,
    COMPUTE_BODY_Z,
    COMPUTE_BODY_W,
    COMPUTE_BODY_D,
    COMPUTE_BODY_H,
    2,
  );
  svg += computeFront();
  svg += computeEnd();
  svg += computeTop();
  return svg;
}

// ---------------------------------------------------------------------------
// Webpage
// ---------------------------------------------------------------------------

/**
 * Upright browser-window geometry, in local world units.
 *
 * A stepped 260 × 116 plinth carries a short neck and a 228 × 26 × 150 window;
 * the top lands at z=183. The plinth grounds the object inside the shared
 * footprint, while the slab is wide enough for a title bar and a two-column
 * page layout at illustration scale.
 */
const WEB_PLINTH_Z = 7,
  WEB_BASE_TOP = 13,
  WEB_UPPER_Z = 13,
  WEB_UPPER_TOP = 19,
  WEB_NECK_Z = 19,
  WEB_NECK_TOP = 33,
  WEB_FRAME_Z = 33,
  WEB_FRAME_W = 228,
  WEB_FRAME_H = 150,
  WEBPAGE_HEIGHT = WEB_FRAME_Z + WEB_FRAME_H;

/** Browser chrome and the page laid out on the broad front face. */
function webpageFront(): string {
  // Chrome: inset panel, title bar, active tab, address field, and controls.
  let svg = `<rect class="face recess" x="5" y="5" width="218" height="140" rx="2.5"/>
    <rect class="face drawer-front" x="5" y="5" width="218" height="18" rx="2.5"/>
    <path class="detail" d="M5 23H223"/>
    <path class="led" d="${circle(12, 14, 2)}"/>
    <path class="face recess" d="${circle(18, 14, 1.7)}${circle(24, 14, 1.7)}"/>
    <path class="face recess" d="M38 23V10.5a3 3 0 0 1 3-3h76a3 3 0 0 1 3 3V23Z"/>
    <rect class="led" x="38" y="21.8" width="82" height="1.2" rx=".6"/>
    <rect class="face recess" x="128" y="9" width="88" height="11" rx="5.5"/>
    <path class="detail" d="M134 15v-1.8a2.2 2.2 0 0 1 4.4 0V15M133 15h6.4v5H133Z"/>
    <text class="label" x="142" y="16.5" font-size="4">app.local</text>
    <path class="led" d="${circle(210, 14.5, 1.3)}"/>`;

  // Screen: a translucent accent wash over the recess keeps the page inside
  // the same palette without competing with the content blocks.
  svg += `<rect class="glass-pane" x="5" y="23" width="218" height="116" rx="1.5"/>`;

  // Left navigation rail.
  svg += `<rect class="face" x="11" y="29" width="38" height="110" rx="2"/>
    <rect class="internal-board" x="16" y="34" width="14" height="14" rx="2"/>
    <path class="detail" d="M20 38h6v2h-6ZM20 42h6v2h-6Z"/>
    <rect class="led" x="16" y="55" width="27" height="3" rx="1.5"/>
    <path class="detail" d="M22 65h20M22 75h16M22 85h18M22 95h14"/>
    <path class="detail" d="${circle(17, 65, 1.3)}${circle(17, 75, 1.3)}${circle(17, 85, 1.3)}${circle(17, 95, 1.3)}"/>
    <path class="detail" d="M16 106h28"/>
    <rect class="led" x="16" y="126" width="20" height="2" rx="1"/>
    <path class="detail" d="M16 132h28"/>`;

  // Main column: eyebrow, heading, body copy, hero media, and card row.
  svg += `<rect class="led" x="56" y="31" width="24" height="2.2" rx="1.1"/>
    <rect class="face" x="56" y="36" width="112" height="6" rx="1.5"/>
    <rect class="face" x="56" y="45" width="78" height="5" rx="1.2"/>
    <path class="detail" d="M56 56h130M56 61h112M56 66h124"/>`;

  // Hero artwork: tinted media panel with horizon, hills, and an accent sun.
  svg += `<rect class="internal-board" x="56" y="74" width="160" height="40" rx="2"/>
    <path class="detail" d="M62 108h148M62 78h148"/>
    <path class="face top" d="M62 108L92 84L110 98L132 80L158 108Z"/>
    <path class="face" d="M144 108L168 90L192 108Z"/>
    <path class="led" d="${circle(194, 87, 6)}"/>
    <path class="detail" d="${circle(194, 87, 8)}"/>`;

  // Three article cards. The first carries an accent call-to-action bar.
  for (let index = 0; index < 3; index++) {
    const x = 56 + index * 54;
    svg += `<rect class="face" x="${x}" y="120" width="48" height="19" rx="1.5"/>
      <rect class="internal-board" x="${x + 4}" y="124" width="10" height="11" rx="1.5"/>
      <path class="detail" d="M${x + 17} 126h26M${x + 17} 130h18M${x + 17} 134h22"/>`;
    if (index === 0)
      svg += `<rect class="led" x="${x + 4}" y="136.2" width="14" height="1.2" rx=".6"/>`;
  }

  // Scrollbar sits against the window's right inset.
  svg += `<path class="detail" d="M220 29V137"/>
    <rect class="led" x="219" y="32" width="2" height="32" rx="1"/>`;
  return svg;
}

/** Full static webpage markup, painted back to front. */
function webpageGeometry(): string {
  let svg = box(-130, -58, WEB_PLINTH_Z, 260, 116, 6, 2.5);
  svg += box(-118, -48, WEB_UPPER_Z, 236, 96, WEB_UPPER_TOP - WEB_UPPER_Z, 2);
  svg += box(-52, -24, WEB_NECK_Z, 104, 48, WEB_NECK_TOP - WEB_NECK_Z, 2);

  // Plinth and neck details. Their front faces sit closer to the camera than
  // the window frame, so painting them first is safe.
  svg += `<g transform="${frontFace(-130, 58, WEB_BASE_TOP)}">
    <path class="detail" d="M8 3H96M164 3H252"/>
    <path class="detail" d="${circle(10, 3, 1.2)}${circle(250, 3, 1.2)}"/>
    <rect class="face recess" x="112" y="1" width="36" height="4" rx="1"/>
    <path class="led" d="${circle(116, 3, 1)}"/>
  </g>`;
  svg += `<g transform="${frontFace(-118, 48, WEB_UPPER_TOP)}">
    <rect class="face recess" x="6" y="1.2" width="224" height="3.6" rx="1"/>
    <path class="detail" d="M12 3H106M130 3H224"/>
  </g>`;
  svg += `<g transform="${frontFace(-52, 24, WEB_NECK_TOP)}">
    <rect class="face recess" x="6" y="3.5" width="92" height="7" rx="1"/>
    <path class="detail" d="${slits(10, 46, 4, 5, 9)}"/>
    <rect class="led" x="86" y="5" width="8" height="2" rx="1"/>
    <text class="label" x="66" y="9.2" font-size="3.4">PWR</text>
  </g>`;

  svg += box(
    -WEB_FRAME_W / 2,
    -13,
    WEB_FRAME_Z,
    WEB_FRAME_W,
    26,
    WEB_FRAME_H,
    2.5,
  );
  svg += `<g transform="${frontFace(-WEB_FRAME_W / 2, 13, WEBPAGE_HEIGHT)}">${webpageFront()}</g>`;

  // The narrow monitor edge and top cap carry the remaining enclosure detail.
  svg += `<g transform="${endFace(WEB_FRAME_W / 2, 13, WEBPAGE_HEIGHT)}">
    <rect class="face recess" x="6" y="6" width="14" height="138" rx="4"/>
    <path class="detail" d="M13 12V138"/>
    <path class="detail" d="${circle(13, 10, 1.1)}${circle(13, 140, 1.1)}"/>
    <path class="led" d="${circle(13, 40, 1.2)}"/>
  </g>`;
  svg += `<g transform="${topFace(-WEB_FRAME_W / 2, -13, WEBPAGE_HEIGHT)}">
    <path class="detail" d="M6.5 5H221.5A1.5 1.5 0 0 1 223 6.5V19.5A1.5 1.5 0 0 1 221.5 21H6.5A1.5 1.5 0 0 1 5 19.5V6.5A1.5 1.5 0 0 1 6.5 5Z"/>
    <path class="detail" d="${slits(12, 216, 8, 9, 17)}"/>
    <path class="detail" d="${circle(10, 8, 1.1)}${circle(218, 8, 1.1)}"/>
    <rect class="led" x="206" y="20" width="10" height="1.2" rx=".6"/>
  </g>`;
  return svg;
}

/**
 * Three memory banks on a controller base distinguish an in-memory cache from
 * disk racks and compute chassis. All geometry stays inside the shared
 * 288 × 150 platform; the highest chip reaches z=103 for camera fitting.
 * The banks represent memory, not live capacity or hit-rate measurements.
 */
const CACHE_HEIGHT = 103;

/** Static cache artwork in face-local units, painted base-to-top. */
function cacheGeometry(): string {
  let svg = box(-124, -58, 7, 248, 116, 14, 2);
  svg += `<g transform="${frontFace(-124, 58, 21)}">
    <rect class="face recess" x="7" y="3" width="234" height="9" rx="1"/>
    <path class="led" d="${circle(230, 7.5, 1.5)}"/>
  </g>`;
  for (let bank = 0; bank < 3; bank++) {
    const z = 25 + bank * 26,
      top = z + 18;
    svg += box(-112, -50, z, 224, 100, 18, 1);
    svg += `<g transform="${frontFace(-112, 50, top)}">
      <rect class="face recess" x="7" y="4" width="210" height="10" rx="1"/>
      <path class="detail" d="M14 7H40M14 11H40M181 7H205M181 11H205"/>
      <rect class="led" x="50" y="7" width="120" height="2"/>
      <path class="detail" d="${slits(53, 169, 8, 11, 14)}"/>
    </g>
    <g transform="${endFace(112, 50, top)}">
      <path class="detail" d="${slits(12, 88, 6, 5, 13)}"/>
      <path class="led" d="${circle(93, 9, 1.5)}"/>
    </g>`;
    // Chips are raised boxes, so the front bank occludes their lower edges.
    for (let chip = 0; chip < 4; chip++) {
      const x = -94 + chip * 48;
      svg += box(x, -30, top, 36, 54, 8, 1);
      svg += `<g transform="${topFace(x, -30, top + 8)}">
        <rect class="face recess" x="5" y="6" width="26" height="42" rx="1"/>
        <path class="detail" d="M10 15H26M10 20H26M10 25H21"/>
        <path class="led" d="M10 38H26"/>
      </g>`;
    }
    svg += `<g transform="${topFace(-112, -50, top)}">
      <path class="detail" d="M8 86H216M8 82H216M8 10H216"/>
      <text class="label" x="10" y="96" font-size="5">MEMORY BANK ${bank + 1}</text>
    </g>`;
  }
  return svg;
}

/**
 * Provider variant of the cache artwork.
 *
 * Redis is a square, upright memory appliance: a cartridge sled stack behind
 * a red anodized spine, a cooling deck, and a plinth that carries the instance
 * label. It keeps the cache renderer's three-bank memory language while
 * reading as a product cabinet rather than the default wide rack. Height is
 * provider-specific so camera fitting follows the taller silhouette.
 */
const REDIS_CACHE_HEIGHT = 171;

/** Front face top edge; sleds and I/O are laid out downward from here. */
const REDIS_FRONT_TOP = 166;

/** Drawer tops in face-local units: three 35-unit sleds with 3-unit gaps. */
const REDIS_SLED_TOPS = [24, 62, 100] as const;

/** Aspect ratio of the official 256 × 220 mark, used to size printed badges. */
const REDIS_LOGO_RATIO = 256 / 220;

/**
 * The exact upstream Redis mark, nested so `viewBox` scales it onto a face.
 *
 * Never substitute a redrawn approximation here: only the official artwork
 * carries the product identity, and its brand fills stay untouched by theme
 * variables. The raster cache snapshots it with the rest of the static face.
 *
 * @param x - Face-local left edge.
 * @param y - Face-local top edge.
 * @param width - Printed width in face-local units.
 */
function redisBadge(x: number, y: number, width: number): string {
  return `<svg x="${x}" y="${y}" width="${width}" height="${(width / REDIS_LOGO_RATIO).toFixed(2)}" viewBox="0 0 256 220" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${REDIS_LOGO_ART}</svg>`;
}

/** Redis cache artwork in face-local units. */
function redisCacheGeometry(): string {
  let svg = box(-80, -80, 7, 160, 160, 9, 4);
  // Plinth fascia: the instance label shares this strip with the power LED.
  svg += `<g transform="${frontFace(-80, 80, 16)}">
    <rect class="redis-edge" x="8" y="1" width="144" height="0.8" rx="0.4"/>
    <path class="detail" d="M8 2.6H152"/>
    <path class="detail" d="${circle(8, 5, 0.9)}${circle(152, 5, 0.9)}"/>
    <rect class="led" x="147.5" y="3.4" width="5" height="1.3" rx="0.65"/>
  </g>`;
  svg += box(-76, -74, 16, 152, 148, 150, 4);

  // Front: brand bar, three cartridge sleds, and the service I/O strip. The
  // recessed surround keeps the pale provider tint from washing out detail.
  let front = `<rect class="face recess" x="4" y="5" width="144" height="142" rx="3"/>
    <rect class="face" x="8" y="7" width="136" height="14" rx="2"/>
    ${redisBadge(11, 7.8, 15)}
    <text class="label redis-wordmark" x="31" y="17" font-size="7">REDIS</text>
    <text class="label" x="69" y="16.2" font-size="3.1">IN-MEMORY CACHE</text>
    <path class="led" d="${circle(130, 14, 1.2)}${circle(135.5, 14, 1.2)}${circle(141, 14, 1.2)}"/>`;

  for (const [row, top] of REDIS_SLED_TOPS.entries()) {
    // Ten gauge bars read as live keyspace activity; the middle sled carries
    // the provider accent so the stack does not look mechanically repeated.
    let gauge = "";
    for (const [index, height] of [4, 7, 10, 6, 9, 5, 8, 10, 7, 3].entries())
      gauge += `M${fixed(14 + index * 3.4)} ${top + 29}v-${height}`;
    front += `<g>
      <rect class="face recess" x="8" y="${top}" width="136" height="35" rx="2"/>
      <rect class="redis-sled" x="10" y="${top + 2}" width="132" height="31" rx="1.5"/>
      <rect class="redis-edge" x="10" y="${top + 2}" width="132" height="1" rx="0.5"/>
      <text class="label" x="14" y="${top + 10}" font-size="3.6">SHARD 0${row + 1}</text>
      <text class="label" x="14" y="${top + 14.6}" font-size="2.6">IN-MEMORY</text>
      <path class="redis-gauge${row === 1 ? " redis-gauge-hot" : ""}" d="${gauge}"/>
      <path class="led" d="${circle(62, top + 9.5, 1.1)}${circle(67, top + 9.5, 1.1)}"/>
      <path class="detail" d="${slits(76, 96, 5, top + 7, top + 28)}"/>
      <text class="label" x="75" y="${top + 32.4}" font-size="2.5">KEYS</text>
      <rect class="redis-handle" x="108" y="${top + 11}" width="26" height="7" rx="3.5"/>
      <path class="redis-handle-line" d="M113 ${top + 14.5}H129"/>
      <path class="detail" d="${circle(140, top + 9, 1.1)}"/>
      <path class="led" d="${circle(140, top + 17, 1.1)}"/>
    </g>`;
  }

  front += `<rect class="face recess" x="8" y="138" width="136" height="10" rx="1.5"/>
    <rect class="port" x="13" y="140" width="10" height="6" rx="0.7"/>
    <rect class="port" x="26" y="140" width="10" height="6" rx="0.7"/>
    <rect class="port" x="41" y="140.5" width="7" height="5" rx="0.6"/>
    <path class="detail" d="M54 142.4h9"/>
    <text class="label" x="67" y="146" font-size="3">SYNC / CONSOLE</text>
    <path class="detail" d="${circle(131, 143, 1.2)}"/>
    <text class="label" x="126" y="146" font-size="2.7">RST</text>
    <path class="led" d="${circle(142, 143, 1.4)}"/>`;
  svg += `<g transform="${frontFace(-76, 74, REDIS_FRONT_TOP)}">${front}</g>`;

  // Narrow end: exhaust grille, service ports, and a full-height accent spine.
  svg += `<g transform="${endFace(76, 74, REDIS_FRONT_TOP)}">
    <rect class="face recess" x="8" y="7" width="92" height="84" rx="2"/>
    <path class="detail" d="${rows(14, 82, 4.5, 14, 94)}"/>
    <text class="label" x="14" y="129" font-size="3">EXHAUST</text>
    <rect class="redis-spine" x="106" y="7" width="7" height="133" rx="3.5"/>
    <path class="detail" d="${circle(109.5, 12, 1)}${circle(109.5, 135, 1)}"/>
    <rect class="face recess" x="8" y="96" width="92" height="40" rx="2"/>
    <rect class="port" x="14" y="102" width="13" height="8" rx="0.8"/>
    <rect class="port" x="31" y="102" width="13" height="8" rx="0.8"/>
    <text class="label" x="14" y="120" font-size="3">SERVICE</text>
    <path class="led" d="${circle(88, 106, 1.5)}"/>
    <text class="label" x="83" y="120" font-size="3">LINK</text>
    <text class="label" x="118" y="70" font-size="3">CACHE</text>
  </g>`;

  // Lid deck: dual cooling fans, four DIMM banks, and a status halo.
  let dimms = "";
  for (let index = 0; index < 4; index++) {
    const x = 70 + index * 13;
    dimms += `<rect class="redis-dimm" x="${x}" y="20" width="8" height="90" rx="1"/>
      <path class="detail" d="M${x + 2} 26h4M${x + 2} 96h4"/>
      <path class="led" d="${circle(x + 4, 24, 0.8)}"/>`;
  }
  svg += box(
    -72,
    -70,
    REDIS_FRONT_TOP,
    144,
    140,
    REDIS_CACHE_HEIGHT - REDIS_FRONT_TOP,
    3,
  );
  svg += `<g transform="${frontFace(-72, 70, REDIS_CACHE_HEIGHT)}">
    <rect class="redis-edge" x="6" y="0.8" width="132" height="1" rx="0.5"/>
  </g>`;
  svg += `<g transform="${topFace(-72, -70, REDIS_CACHE_HEIGHT)}">
    <rect class="face recess" x="4" y="4" width="136" height="132" rx="2"/>
    <rect class="redis-bay" x="8" y="8" width="52" height="124" rx="1.5"/>
    ${fan(34, 40, 15)}${fan(34, 98, 15)}
    <text class="label" x="12" y="127" font-size="3">AIRFLOW</text>
    <path class="detail" d="M65 10V130"/>
    <text class="label" x="70" y="15" font-size="3.4">DIMM</text>
    ${dimms}
    <text class="label" x="70" y="131" font-size="2.8">IN-MEMORY</text>
    <path class="detail" d="${circle(131, 34, 8)}${circle(131, 34, 5)}"/>
    <path class="led" d="${circle(131, 34, 2)}"/>
    <text class="label" x="123" y="50" font-size="2.6">SYNC</text>
    <rect class="redis-spine" x="134" y="64" width="3" height="62" rx="1.5"/>
  </g>`;
  return svg;
}

/**
 * Live Redis details, painted above the rasterized static artwork.
 *
 * Only small, compositor-friendly effects live here: staggered activity LEDs,
 * key packets crossing each sled, and a status dash orbiting the top halo.
 * The raster cache never snapshots this layer, so the animation stays live
 * while static geometry is shared between replicas. Delays are negative so
 * replicas do not blink in lockstep on first paint.
 */
function redisCacheMotion(): string {
  let front = "";
  for (const [row, top] of REDIS_SLED_TOPS.entries()) {
    front += `<path class="led redis-blink" style="--delay:${(-row * 0.7).toFixed(1)}s" d="${circle(62, top + 9.5, 1.1)}${circle(67, top + 9.5, 1.1)}"/>
      <g class="redis-packet" style="--delay:${(-row * 0.9).toFixed(1)}s"><rect x="14" y="${top + 23}" width="4" height="1.6" rx="0.8"/></g>`;
  }
  front += `<path class="led redis-blink" style="--delay:-1.3s" d="${circle(142, 143, 1.4)}"/>`;

  return `<g transform="${frontFace(-76, 74, REDIS_FRONT_TOP)}">${front}</g>
    <g transform="${endFace(76, 74, REDIS_FRONT_TOP)}">
      <path class="led redis-blink" style="--delay:-0.4s" d="${circle(88, 106, 1.5)}"/>
    </g>
    <g transform="${topFace(-72, -70, REDIS_CACHE_HEIGHT)}">
      <path class="redis-orbit" pathLength="100" d="${circle(131, 34, 8)}"/>
      <path class="led redis-core" d="${circle(131, 34, 2)}"/>
      <g class="redis-packet" style="--delay:-1.1s"><rect x="70" y="112" width="10" height="1.2" rx="0.6"/></g>
    </g>`;
}

/** Height, artwork, and label placement registered for a provider/renderer pair. */
interface ComponentVariant {
  /** Static artwork; the raster cache may replace it with a shared image. */
  markup: string;
  /**
   * Optional live layer painted above the static artwork.
   *
   * CSS animations here survive rasterization because the raster cache only
   * snapshots `.component-static-base`. Keep it limited to small compositor
   * effects; the scene hides motion layers during camera navigation.
   */
  motion?: string;
  height: number;
  /** Overrides the default instance-label face for this skin. */
  labelTransform?: string;
  labelX?: number;
  labelY?: number;
  /** Maximum characters before the label is condensed to `labelTextLength`. */
  labelMaxChars?: number;
  labelTextLength?: number;
  labelFontSize?: number;
}

/**
 * Provider-specific artwork, keyed by canonical provider id and renderer type.
 *
 * Adding a provider with a distinct silhouette means registering its theme in
 * `providers.ts` and, when needed, one variant here. Providers without an
 * entry reuse the default renderer geometry and height.
 */
const PROVIDER_VARIANTS: Readonly<
  Record<string, Partial<Record<PlacedInstance["type"], ComponentVariant>>>
> = {
  redis: {
    cache: {
      markup: redisCacheGeometry(),
      motion: redisCacheMotion(),
      height: REDIS_CACHE_HEIGHT,
      labelTransform: frontFace(-80, 80, 16),
      labelX: 10,
      labelY: 7.6,
      labelMaxChars: 34,
      labelTextLength: 140,
      labelFontSize: 6.2,
    },
  },
};

/** Provider artwork for a type, or undefined to use the default renderer. */
function variantOf(
  type: PlacedInstance["type"],
  provider: string | undefined,
): ComponentVariant | undefined {
  const theme = findProvider(provider, type);
  return theme ? PROVIDER_VARIANTS[theme.id]?.[type] : undefined;
}

// Shared, immutable markup. Per-instance color flows through CSS variables and
// the label is appended with textContent, so no user input enters these strings.
const COMPUTE_GEOMETRY = computeGeometry();
const WEBPAGE_GEOMETRY = webpageGeometry();
const CACHE_GEOMETRY = cacheGeometry();
const COMPONENT_GEOMETRY = {
  "compute-server": COMPUTE_GEOMETRY,
  webpage: WEBPAGE_GEOMETRY,
  cache: CACHE_GEOMETRY,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Human-readable renderer names for accessible labels. */
const TYPE_LABELS: Readonly<Record<PlacedInstance["type"], string>> = {
  "database-rack": "Database Rack",
  "compute-server": "Compute Server",
  webpage: "Webpage",
  cache: "Cache",
};

/**
 * Height of a component above its placement elevation, in world units.
 *
 * The scene uses this for view fitting and callout anchors. Database racks
 * report their existing cabinet height; the newer components include their
 * plinth because their local z starts at the platform surface. A registered
 * provider variant may supply its own height, since providers are allowed to
 * use a different silhouette. Values are constants, so the result never
 * depends on label length or instance identity.
 *
 * @param type - Renderer type selected by the layout pass.
 * @param provider - Optional provider key from the document.
 * @returns Top elevation relative to `position.z`.
 */
export function componentHeight(
  type: PlacedInstance["type"],
  provider?: string,
): number {
  const variant = variantOf(type, provider);
  if (variant) return variant.height;
  switch (type) {
    case "database-rack":
      return DATABASE_HEIGHT;
    case "compute-server":
      return COMPUTE_HEIGHT;
    case "webpage":
      return WEBPAGE_HEIGHT;
    case "cache":
      return CACHE_HEIGHT;
  }
}

/**
 * Create one world-positioned scene instance.
 *
 * The returned `<g>` owns the placement transform, the scene-instance marker,
 * and the accessible label. Database racks keep their existing local chassis
 * coordinates and are offset by `DATABASE_ANCHOR`; the newer components are
 * modelled around a local origin at platform center, so their local (0, 0)
 * projects straight to the instance position. Colors become `--cable-color`
 * and are inherited by every detail.
 *
 * Each geometry root exposes `data-renderer-type` for the shared raster cache.
 * Static artwork sits in one `.component-static-base` group and the live
 * `.component-label` follows it, so identity never enters cached pixels.
 *
 * @param instance - Validated, placed instance.
 * @returns Group ready to append to the scene; no event handlers are attached.
 */
export function createComponent(instance: PlacedInstance): SVGGElement {
  const element = document.createElementNS(NS, "g"),
    [x, y] = project(
      instance.position.x,
      instance.position.y,
      instance.position.z,
    ),
    theme = findProvider(instance.provider, instance.type),
    variant = variantOf(instance.type, instance.provider),
    typeLabel = theme
      ? `${theme.label} ${TYPE_LABELS[instance.type]}`
      : TYPE_LABELS[instance.type];
  element.classList.add("scene-instance");
  element.dataset.instanceId = instance.id;
  element.setAttribute("role", "img");
  element.setAttribute(
    "aria-label",
    `${instance.label} (${instance.id}) · ${typeLabel}`,
  );
  element.style.setProperty("--cable-color", instance.color);

  if (instance.type === "database-rack") {
    element.setAttribute(
      "transform",
      `translate(${x - DATABASE_ANCHOR[0]} ${y - DATABASE_ANCHOR[1]})`,
    );
    const rack = new DatabaseRack(instance).element;
    // The wrapper owns scene identity and receives the cluster id later. The
    // rack's own copy would be the nearer data-instance-id ancestor for
    // closest() lookups, hiding the wrapper's cluster id from hover/select.
    rack.removeAttribute("data-instance-id");
    rack.removeAttribute("role");
    rack.removeAttribute("aria-label");
    if (theme) {
      rack.dataset.rendererProvider = theme.id;
      rack.classList.add("provider-skin", `provider-${theme.id}`);
    }
    element.append(rack);
    return element;
  }

  element.setAttribute("transform", `translate(${x} ${y})`);
  const geometry = document.createElementNS(NS, "g");
  geometry.classList.add(instance.type);
  geometry.dataset.rendererType = instance.type;
  if (theme) {
    // Raster keys distinguish provider artwork and palettes by this marker;
    // the generic class carries the shared surface tint.
    geometry.dataset.rendererProvider = theme.id;
    geometry.classList.add("provider-skin", `provider-${theme.id}`);
  }
  geometry.setAttribute("aria-hidden", "true");
  geometry.innerHTML = `<g class="component-static-base">${
    variant?.markup ?? COMPONENT_GEOMETRY[instance.type]
  }</g>${
    variant?.motion
      ? `<g class="component-motion" aria-hidden="true">${variant.motion}</g>`
      : ""
  }`;
  element.append(geometry);

  // Identity sits on the server's top rail, cache controller strip, or browser
  // active tab; provider variants may move it to their own face. Text is
  // assigned with textContent so imported names cannot inject markup; long
  // names are condensed rather than clipped.
  const labelGroup = document.createElementNS(NS, "g"),
    wideLabel = instance.type === "compute-server" || instance.type === "cache",
    labelMaxChars = variant?.labelMaxChars ?? (wideLabel ? 48 : 14),
    labelTextLength = variant?.labelTextLength ?? (wideLabel ? 230 : 68);
  labelGroup.classList.add("component-label");
  labelGroup.setAttribute(
    "transform",
    variant?.labelTransform ??
      (instance.type === "compute-server"
        ? frontFace(-130, 62, COMPUTE_TOP_Z)
        : instance.type === "cache"
          ? frontFace(-124, 58, 21)
          : frontFace(-WEB_FRAME_W / 2, 13, WEBPAGE_HEIGHT)),
  );
  const label = document.createElementNS(NS, "text");
  label.classList.add("instance-label");
  label.setAttribute("x", String(variant?.labelX ?? (wideLabel ? 11 : 44)));
  label.setAttribute("y", String(variant?.labelY ?? (wideLabel ? 7.4 : 18.2)));
  if (variant?.labelFontSize)
    label.style.fontSize = `${variant.labelFontSize}px`;
  else if (!wideLabel) label.style.fontSize = "5.2px";
  if (instance.label.length > labelMaxChars) {
    label.setAttribute("textLength", String(labelTextLength));
    label.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
  label.textContent = instance.label;
  labelGroup.append(label);
  geometry.append(labelGroup);
  return element;
}
