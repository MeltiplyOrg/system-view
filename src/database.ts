import type { DatabaseNode } from "./design";

const NS = "http://www.w3.org/2000/svg";
type Point = readonly [number, number, number];
export const project = (
  x: number,
  y: number,
  z: number,
): readonly [number, number] => [
  (x - y) * Math.cos(Math.PI / 6),
  (x + y) * 0.5 - z,
];
export const DATABASE_ANCHOR = project(144, 75, 0);
const plane = (origin: Point, u: Point, v: Point): string => {
  const o = project(...origin),
    a = project(...u),
    b = project(...v);
  return `matrix(${a[0]} ${a[1]} ${b[0]} ${b[1]} ${o[0]} ${o[1]})`;
};
const top = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 1, 0]);
const front = (x: number, y: number, z: number) =>
  plane([x, y, z], [1, 0, 0], [0, 0, -1]);
const side = (x: number, y: number, z: number) =>
  plane([x, y, z], [0, -1, 0], [0, 0, -1]);
const path = (points: readonly Point[]) =>
  "M" +
  points
    .map((p) =>
      project(...p)
        .map((n) => n.toFixed(2))
        .join(" "),
    )
    .join("L");

// Geometry adapted from April Zhu's rack: https://isoglow.dev/demo/objects#rack.
// Shared symbols retain detail without copying the chassis into every object.
function box(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  r = 1,
): string {
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
  const ring = [
    ...arc(x + w - r, y + r, -half, 0),
    ...arc(x + w - r, y + d - r, 0, half),
    ...arc(x + r, y + d - r, half, 2 * half),
    ...arc(x + r, y + r, 2 * half, 3 * half),
  ];
  const visible = [
    ...arc(x + w - r, y + r, -q, 0),
    ...arc(x + w - r, y + d - r, 0, half),
    ...arc(x + r, y + d - r, half, 3 * q),
  ];
  const wall: Point[] = [
    ...visible.map(([a, b]): Point => [a, b, z]),
    ...visible.reverse().map(([a, b]): Point => [a, b, z + h]),
  ];
  return `<path class="face" d="${path(wall)}Z"/><path class="face top" d="${path(ring.map(([a, b]): Point => [a, b, z + h]))}Z"/>`;
}
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
function circle(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}
const RX = 24,
  RY = 22,
  RW = 240,
  RD = 92,
  RZ = 20,
  RF = 114;
const UH = 13;
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
const SZ = nextZ,
  SH = 11.5,
  ZT = SZ + 16,
  TOPZ = ZT + 20;
const portU = (n: number) => 46 + n * 5;
const switchZ = SZ + 9.5 - 4.4 / 2; // Center of the switch jack, not the fascia edge.

function rearGeometry(): string {
  // The broad side is glazed; opaque walls must not cover the internal modules.
  let svg = box(RX + 6, RY + 6, 7, RW - 12, RD - 10, 10, 2);
  svg += box(RX, RY, 17, RW, RD, 3);
  svg += box(RX, RY, RZ, RW, 6, ZT - RZ);
  svg += box(RX, RY, RZ, 6, RD, ZT - RZ);
  svg += box(RX + RW - 5, RY, RZ, 5, RD, ZT - RZ);
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
  svg += `<g transform="${side(RX + RW, RF, SZ + SH)}">
    <rect class="face drawer-front" x="6" y=".7" width="80" height="${SH - 1.4}" rx="1.2"/>
    <text class="label" x="10" y="8" font-size="5">SW</text>
    ${slits(25, 40, 3, 3, SH - 3)}
    ${units.map((u) => `<rect class="port" x="${portU(u.n) - 2.1}" y="${SH - 9.5}" width="4.2" height="4.4" rx=".5"/>`).join("")}
  </g>`;
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
function frontGeometry(): string {
  // Roof is painted after the cables; its front strip carries only the database name.
  let svg = box(RX, RY, ZT, RW, RD, 20, 4);
  const fan = (cx: number, cy: number) =>
    `<circle class="face recess" cx="${cx}" cy="${cy}" r="24"/><path class="detail" d="${[20, 14, 8].map((r) => circle(cx, cy, r)).join("")}"/>`;
  svg += `<g transform="${top(RX, RY, TOPZ)}"><rect class="detail" x="6" y="6" width="228" height="80" rx="3"/>${fan(66, 46)}${fan(174, 46)}${slits(104, 136, 3.2, 24, 68)}</g>`;
  return svg;
}
const cables = units
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
    const curve = `M${a}C${b} ${c} ${d}`;
    return `<g class="cable"><path class="wire-under" d="${curve}"/><path class="wire-glow" d="${curve}"/><path class="wire" d="${curve}"/><path class="pulse" pathLength="100" style="--duration:${1.8 + u.n * 0.17}s;--delay:${-u.n * 0.43}s" d="${curve}"/></g>`;
  })
  .join("");

export function createDatabaseDefinitions(): SVGDefsElement {
  const defs = document.createElementNS(NS, "defs");
  // <g> rather than <symbol> avoids an implicit viewport clipping the negative y coordinates.
  defs.innerHTML = `<clipPath id="rack-name-clip" clipPathUnits="userSpaceOnUse"><rect x="8" y="2" width="76" height="16"/></clipPath><clipPath id="rack-glass-clip" clipPathUnits="userSpaceOnUse"><rect x="10" y="10" width="220" height="167" rx="2"/></clipPath><g id="rack-rear">${rearGeometry()}</g><g id="rack-front">${frontGeometry()}</g>`;
  return defs;
}

export class DatabaseRack {
  readonly element = document.createElementNS(NS, "g");
  constructor(node: DatabaseNode) {
    this.element.classList.add("database-rack");
    this.element.dataset.nodeId = node.id;
    this.element.style.setProperty("--cable-color", node.color);
    this.element.innerHTML = `<use href="#rack-rear"/>${cables}<use href="#rack-front"/>`;
    // Plain identity lettering on the top strip of the narrow drawer face.
    const nameplate = document.createElementNS(NS, "g");
    nameplate.setAttribute("transform", side(RX + RW, RF, TOPZ));
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", "8");
    label.setAttribute("y", "12.5");
    label.setAttribute("clip-path", "url(#rack-name-clip)");
    label.classList.add("node-label");
    label.textContent = node.label;
    if (node.label.length > 16) {
      label.setAttribute("textLength", "74");
      label.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
    nameplate.append(label);
    this.element.append(nameplate);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${node.label} (${node.id}) · Database Rack`;
    this.element.prepend(title);
  }
}
