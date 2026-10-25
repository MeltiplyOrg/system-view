import type { PlacedInstance } from "./design";
import type { ProviderTheme } from "./providers";
import { findProvider, PROVIDERS } from "./providers";
import {
  box,
  circle,
  front,
  path,
  side,
  slits,
  top,
  type Point,
} from "./database";

const NS = "http://www.w3.org/2000/svg";

/** Two-decimal formatting keeps the generated skin markup compact. */
const fixed = (value: number): string => value.toFixed(2);

/** Horizontal detail lines; the inverse of `slits`. */
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
  return `<path class="detail" d="${d}"/>`;
}

/** A recessed circular cooling fan used by the roof decks. */
function fan(cx: number, cy: number, radius: number): string {
  return `<circle class="face recess" cx="${fixed(cx)}" cy="${fixed(cy)}" r="${fixed(radius)}"/><path class="detail" d="${[0.72, 0.48, 0.24].map((scale) => circle(cx, cy, radius * scale)).join("")}"/><path class="led" d="${circle(cx, cy, Math.max(1, radius * 0.12))}"/>`;
}

/**
 * Print the provider's exact mark on a badge plate in a face-local plane.
 *
 * The theme SVG is the single source for tooltip and object marks. Its root is
 * replaced with explicit `x/y/width/height` so the same inner art scales onto
 * the plate without redrawing paths. The plate fill uses the provider plate
 * variable; MySQL and MongoDB set a dark plate for their light marks.
 */
function logoPlate(
  theme: ProviderTheme,
  transform: string,
  plate: { x: number; y: number; width: number; height: number },
  mark: { x: number; y: number; width: number; height: number },
  round = false,
): string {
  const viewBox = /viewBox="([^"]+)"/.exec(theme.logo)?.[1],
    art = theme.logo
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>[\s\S]*$/, "");
  if (!viewBox || !art) return "";
  const base = round
    ? `<circle class="brand-plate" cx="${fixed(plate.x + plate.width / 2)}" cy="${fixed(plate.y + plate.height / 2)}" r="${fixed(Math.min(plate.width, plate.height) / 2)}"/>`
    : `<rect class="brand-plate" x="${fixed(plate.x)}" y="${fixed(plate.y)}" width="${fixed(plate.width)}" height="${fixed(plate.height)}" rx="2.5"/>`;
  return `<g class="rack-provider-badge" transform="${transform}">${base}<svg x="${fixed(mark.x)}" y="${fixed(mark.y)}" width="${fixed(mark.width)}" height="${fixed(mark.height)}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${art}</svg></g>`;
}

/** Per-provider database cabinet geometry and live detail. */
interface DatabaseSkin {
  id: string;
  height: number;
  rear: string;
  front: string;
  motion: string;
  labelTransform: string;
  labelX: number;
  labelY: number;
  labelFontSize: number;
  labelMaxChars: number;
  labelTextLength: number;
  badge(theme: ProviderTheme): string;
}

/**
 * PostgreSQL: tall blue archive cabinet.
 *
 * Two arched disk windows, a crown badge, a trunk-like side rail, and four
 * primary bays make the elephant's archival appliance. The cabinet is the
 * tallest of the four database skins.
 */
function postgresqlSkin(): DatabaseSkin {
  const X = 36,
    Y = 30,
    W = 216,
    D = 90,
    Z = 16,
    H = 224,
    TOP = Z + H;
  const arch = (x0: number, x1: number) =>
    `M${x0} 148V58Q${x0} 38 ${(x0 + x1) / 2} 38Q${x1} 38 ${x1} 58V148Z`;
  let rear = box(28, 26, 7, 232, 98, 9, 4);
  rear += box(X, Y, Z, W, D, H, 10);
  rear += `<g transform="${front(X, Y + D, TOP)}">
    <rect class="face recess" x="6" y="6" width="204" height="212" rx="4"/>
    <path class="face db-pg-rail" d="M6 32H12V208H6Z M204 32H210V208H204Z"/>
    <rect class="db-pg-glass glass-pane" x="12" y="38" width="192" height="110" rx="3"/>
    <path class="face recess" d="${arch(12, 102)}${arch(114, 204)}"/>
    <path class="db-pg-pane glass-pane" d="${arch(16, 98)}${arch(118, 200)}"/>
    ${[56, 160]
      .map((cx) =>
        [58, 82, 106, 130]
          .map(
            (cy) =>
              `<path class="detail" d="${circle(cx, cy, 17)}"/><path class="face recess" d="${circle(cx, cy, 12)}"/><path class="led" d="${circle(cx, cy, 2.2)}"/><path class="detail" d="M${cx - 15} ${cy}H${cx + 15}"/>`,
          )
          .join(""),
      )
      .join("")}
    <path class="detail" d="M108 38V148M4 151H212"/>
    <text class="label" x="14" y="154.5" font-size="3.2">PRIMARY</text>
    <text class="label" x="176" y="154.5" font-size="3.2">SYNC</text>
    ${[0, 1, 2, 3]
      .map((index) => {
        const x = 10 + index * 49;
        return `<rect class="face recess" x="${x}" y="158" width="46" height="34" rx="1.5"/>
          <rect class="redis-sled" x="${x + 2}" y="160" width="42" height="30" rx="1"/>
          <text class="label" x="${x + 5}" y="${168}" font-size="3.6">0${index + 1}</text>
          ${slits(x + 5, x + 15, 4, 173, 186)}
          <path class="led" d="${circle(x + 35, 167, 1.1)}${circle(x + 39, 167, 1.1)}"/>
          <path class="drawer-pull" d="M${x + 22} 184h14"/>
          <path class="detail" d="M${x + 6} 192h30"/>`;
      })
      .join("")}
    <path class="detail" d="M8 198H208M8 202H208"/>
    <path class="led" d="${circle(14, 209, 1.2)}"/>
    <text class="label" x="20" y="210.5" font-size="3">READY</text>
  </g>`;
  rear += `<g transform="${side(X + W, Y + D, TOP)}">
    <rect class="face recess" x="8" y="20" width="62" height="164" rx="2"/>
    ${slits(14, 64, 6, 26, 178)}
    <rect class="face db-pg-spine" x="76" y="18" width="8" height="188" rx="4"/>
    <path class="detail" d="${circle(80, 24, 1.1)}${circle(80, 200, 1.1)}"/>
    <path class="detail" d="M76 48H70V84Q70 96 76 96"/>
    <rect class="face recess" x="8" y="190" width="46" height="24" rx="2"/>
    <rect class="port" x="13" y="195" width="12" height="7" rx=".7"/>
    <rect class="port" x="29" y="195" width="12" height="7" rx=".7"/>
    <path class="led" d="${circle(58, 196, 1.4)}"/>
    <text class="label" x="13" y="210" font-size="3">SYNC</text>
  </g>`;
  rear += `<g transform="${top(X, Y, TOP)}">
    <rect class="face recess" x="6" y="6" width="204" height="78" rx="3"/>
    ${fan(58, 46, 27)}${fan(158, 46, 27)}
    <path class="detail" d="M12 78Q42 78 58 62Q88 32 118 40Q150 48 204 16"/>
    <path class="detail" d="M12 12H204M12 82H204"/>
    <path class="detail" d="${circle(12, 12, 1.2)}${circle(204, 12, 1.2)}${circle(12, 78, 1.2)}${circle(204, 78, 1.2)}"/>
    <path class="led" d="${circle(198, 18, 1.5)}"/>
  </g>`;
  // The roof fascia is the broad front wall above the glass.
  const overlay = `<g transform="${front(X, Y + D, TOP)}">
    <rect class="face db-pg-fascia" x="6" y="0" width="204" height="10" rx="1.5"/>
    <path class="db-pg-rail" d="M8 1.5H208V3.5H8Z"/>
  </g>`;
  const motion = `<g transform="${front(X, Y + D, TOP)}">
    ${[0, 1, 2, 3]
      .map(
        (index) =>
          `<path class="led db-blink" style="--delay:${(-index * 0.35).toFixed(1)}s" d="${circle(50 + index * 49, 167, 1.1)}"/>`,
      )
      .join("")}
    <g class="db-scan" aria-hidden="true"><rect class="db-scan-line" x="12" y="38" width="192" height="1.4" rx=".7"/></g>
  </g>
  <g transform="${side(X + W, Y + D, TOP)}"><path class="led db-blink" style="--delay:-.8s" d="${circle(58, 196, 1.4)}"/></g>`;
  return {
    id: "postgresql",
    height: TOP,
    rear,
    front: overlay,
    motion,
    labelTransform: side(X + W, Y + D, TOP),
    labelX: 8,
    labelY: 12.5,
    labelFontSize: 4.4,
    labelMaxChars: 16,
    labelTextLength: 74,
    badge: (t) =>
      logoPlate(
        t,
        front(X, Y + D, TOP),
        { x: 12, y: 4, width: 54, height: 28 },
        { x: 16, y: 7, width: 46, height: 22 },
      ),
  };
}

/**
 * MySQL: curved wave cabinet with a dorsal fin and orange racing stripe.
 *
 * Three scalloped drawer waves run under a fin-shaped crown; a round dark
 * plate carries the white dolphin. The low, curved body reads as a different
 * machine from PostgreSQL's archive tower.
 */
function mysqlSkin(): DatabaseSkin {
  const X = 52,
    Y = 34,
    W = 184,
    D = 88,
    Z = 16,
    H = 160,
    TOP = Z + H,
    FIN = 205;
  let rear = box(42, 28, 7, 204, 100, 9, 4);
  rear += box(X, Y, Z, W, D, H, 14);
  // Dorsal fin: a thin double-sided wedge on the narrow end.
  const finBase: Point[] = [
    [X + W, 56, TOP],
    [X + W, 76, FIN],
    [X + W, 102, TOP],
  ];
  const finOuter: Point[] = [
    [X + W - 6, 58, TOP],
    [X + W - 6, 76, FIN - 6],
    [X + W - 6, 102, TOP],
  ];
  rear += `<path class="face db-mysql-fin" d="${path(finBase)}Z"/><path class="face top" d="${path(finOuter)}Z"/><path class="face db-mysql-fin" d="${path([finBase[0], finOuter[0], finOuter[1], finBase[1]])}Z"/><path class="face db-mysql-fin" d="${path([finBase[1], finOuter[1], finOuter[2], finBase[2]])}Z"/>`;
  const wave = (x0: number, x1: number, y: number, lift = 5) =>
    `M${x0} ${y}Q${(x0 + x1) / 2} ${y - lift} ${x1} ${y}`;
  rear += `<g transform="${front(X, Y + D, TOP)}">
    <rect class="face recess" x="6" y="4" width="172" height="150" rx="5"/>
    <path class="db-mysql-stripe" d="M8 4H176V7H8Z"/>
    ${[0, 1, 2, 3]
      .map((i) => wave(8, 176, 18 + i * 6, 3))
      .map((d) => `<path class="db-mysql-wave" d="${d}"/>`)
      .join("")}
    <path class="detail" d="M10 30H130"/>
    ${[0, 1, 2, 3]
      .map((i) => {
        const y = 38 + i * 24;
        return `<path class="face recess" d="M8 ${y}H130Q136 ${y + 10} 130 ${y + 18}H8Q2 ${y + 10} 8 ${y}Z"/>
          <path class="detail" d="M18 ${y + 7}H62"/>
          <path class="drawer-pull" d="M80 ${y + 9}h22"/>
          <path class="led" d="${circle(112, y + 9, 1.2)}${circle(118, y + 9, 1.2)}"/>`;
      })
      .join("")}
    <path class="detail" d="M8 132H128M8 136H128"/>
    <path class="face recess" d="${circle(32, 144, 12)}${circle(32, 144, 8)}"/>
    <path class="led" d="${circle(32, 144, 2.2)}"/>
    <text class="label" x="50" y="147" font-size="3.2">BLOW</text>
    <path class="detail" d="M86 144H124M86 148H116"/>
    <path class="detail" d="M136 32V156"/>
    <path class="led" d="${circle(144, 148, 1.3)}"/>
    <text class="label" x="136" y="156" font-size="3">TAIL</text>
  </g>`;
  rear += `<g transform="${side(X + W, Y + D, TOP)}">
    <rect class="face recess" x="8" y="18" width="58" height="110" rx="3"/>
    ${[0, 1, 2, 3, 4, 5, 6]
      .map((i) => `<path class="detail" d="${wave(12, 62, 24 + i * 14, 4)}"/>`)
      .join("")}
    <path class="db-mysql-stripe" d="M72 16H78V148H72Z"/>
    <path class="detail" d="${circle(75, 20, 1.1)}${circle(75, 144, 1.1)}"/>
    <path class="detail" d="M72 42H66V84Q66 94 72 94"/>
    <rect class="face recess" x="8" y="134" width="58" height="16" rx="2"/>
    <rect class="port" x="12" y="138" width="12" height="7" rx=".7"/>
    <rect class="port" x="28" y="138" width="12" height="7" rx=".7"/>
    <path class="led" d="${circle(56, 140, 1.3)}"/>
  </g>`;
  rear += `<g transform="${top(X, Y, TOP)}">
    <rect class="face recess" x="6" y="6" width="172" height="76" rx="4"/>
    <path class="detail" d="${[0, 1, 2]
      .map((i) => wave(12, 84, 24 + i * 12, 5))
      .join("")}"/>
    ${fan(132, 44, 22)}
    <path class="db-mysql-stripe" d="M10 78H70V81H10Z"/>
    <path class="detail" d="${circle(8, 8, 1.1)}${circle(176, 8, 1.1)}${circle(8, 80, 1.1)}${circle(176, 80, 1.1)}"/>
    <path class="led" d="${circle(170, 13, 1.3)}"/>
  </g>`;
  const overlay = `<g transform="${front(X, Y + D, TOP)}">
    <path class="db-mysql-stripe" d="M138 32V156H141V32Z"/>
  </g>`;
  const motion = `<g transform="${front(X, Y + D, TOP)}">
    <path class="led db-blink" style="--delay:-.2s" d="${circle(112, 47, 1.2)}${circle(118, 47, 1.2)}"/>
    <path class="led db-blink" style="--delay:-1.1s" d="${circle(112, 71, 1.2)}${circle(118, 71, 1.2)}"/>
    <path class="led db-blink" style="--delay:-1.9s" d="${circle(112, 95, 1.2)}${circle(118, 95, 1.2)}"/>
    <path class="led db-blink" style="--delay:-2.6s" d="${circle(112, 119, 1.2)}${circle(118, 119, 1.2)}"/>
    <g class="db-wave-pulse" aria-hidden="true"><path pathLength="100" d="${wave(8, 176, 22, 4)}"/></g>
  </g>
  <g transform="${side(X + W, Y + D, TOP)}"><path class="led db-blink" style="--delay:-.6s" d="${circle(56, 140, 1.3)}"/></g>`;
  return {
    id: "mysql",
    height: FIN,
    rear,
    front: overlay,
    motion,
    labelTransform: side(X + W, Y + D, TOP),
    labelX: 8,
    labelY: 12.5,
    labelFontSize: 4.5,
    labelMaxChars: 16,
    labelTextLength: 74,
    badge: (t) =>
      logoPlate(
        t,
        front(X, Y + D, TOP),
        { x: 144, y: 36, width: 32, height: 32 },
        { x: 147, y: 41, width: 26, height: 22 },
        true,
      ),
  };
}

/**
 * SQLite: low file-slot appliance.
 *
 * A single wide tray replaces the rack stack, with a file slot, status panel,
 * and a wide SQLite mark. The lid's card grid is a storage motif rather than a
 * second feather mark.
 */
function sqliteSkin(): DatabaseSkin {
  const X = 24,
    Y = 32,
    W = 240,
    D = 84,
    Z = 14,
    H = 160,
    TOP = Z + H,
    LID = TOP + 6;
  let rear = box(16, 26, 7, 256, 96, 8, 4);
  rear += box(X, Y, Z, W, D, H, 8);
  rear += box(X + 6, Y + 6, TOP, W - 12, D - 12, 6, 3);
  rear += `<g transform="${front(X, Y + D, TOP)}">
    <rect class="face recess" x="6" y="4" width="228" height="154" rx="3"/>
    <rect class="face recess" x="8" y="6" width="130" height="16" rx="2"/>
    <path class="face db-sqlite-slot" d="M13 12H133V16H13Z"/>
    <path class="led" d="${circle(123, 10, 1.1)}"/>
    <rect class="face recess" x="148" y="6" width="84" height="38" rx="2"/>
    <rect class="db-sqlite-screen" x="152" y="10" width="76" height="28" rx="1"/>
    ${[0, 1, 2, 3, 4]
      .map(
        (i) => `<path class="detail" d="M157 ${15 + i * 4}H${186 + i * 8}"/>`,
      )
      .join("")}
    <path class="led" d="${circle(222, 10, 1.1)}"/>
    <path class="face db-sqlite-bezel" d="M8 57H232V59H8Z"/>
    ${[0, 1, 2]
      .map((i) => {
        const y = 62 + i * 24;
        return `<rect class="face recess" x="8" y="${y}" width="224" height="20" rx="2"/>
          <text class="label" x="14" y="${y + 13}" font-size="3.4">FILES 0${i + 1}</text>
          <path class="drawer-pull" d="M92 ${y + 10}h118"/>
          <path class="detail" d="M96 ${y + 14}H206"/>
          <path class="led" d="${circle(224, y + 10, 1.2)}"/>`;
      })
      .join("")}
    <path class="detail" d="M8 136H232M8 140H232"/>
    <rect class="port" x="8" y="144" width="14" height="8" rx=".7"/>
    <rect class="port" x="26" y="144" width="14" height="8" rx=".7"/>
    <path class="led" d="${circle(226, 148, 1.2)}"/>
    <text class="label" x="52" y="152" font-size="3">WRITE</text>
  </g>`;
  rear += `<g transform="${side(X + W, Y + D, TOP)}">
    <rect class="face recess" x="8" y="18" width="62" height="82" rx="2"/>
    ${slits(14, 64, 5, 23, 94)}
    <rect class="face recess" x="8" y="106" width="62" height="42" rx="2"/>
    <rect class="port" x="12" y="112" width="13" height="7" rx=".7"/>
    <rect class="port" x="29" y="112" width="13" height="7" rx=".7"/>
    <path class="led" d="${circle(56, 115, 1.2)}"/>
    <text class="label" x="12" y="132" font-size="3">SYNC</text>
    <path class="detail" d="M12 140H60"/>
  </g>`;
  rear += `<g transform="${top(X, Y, LID)}">
    <rect class="face recess" x="6" y="6" width="228" height="72" rx="3"/>
    ${[0, 1, 2]
      .map((i) => {
        const x = 12 + i * 74;
        return `<path class="face db-sqlite-card" d="M${x} 16H${x + 62}L${x + 70} 24V62H${x}Z"/>
          <path class="detail" d="M${x + 9} 28H${x + 52}M${x + 9} 36H${x + 44}M${x + 9} 44H${x + 50}"/>
          <path class="led" d="${circle(x + 58, 52, 1.2)}"/>`;
      })
      .join("")}
    <path class="drawer-pull" d="M106 72h26"/>
    <path class="detail" d="${circle(10, 68, 1.1)}${circle(230, 68, 1.1)}"/>
  </g>`;
  const overlay = `<g transform="${front(X, Y + D, TOP)}">
    <path class="face db-sqlite-bezel" d="M8 4H232V8H8Z"/>
  </g>`;
  const motion = `<g transform="${front(X, Y + D, TOP)}">
    <path class="led db-blink" style="--delay:-.4s" d="${circle(123, 10, 1.1)}${circle(222, 10, 1.1)}"/>
    <g class="db-sqlite-pulse" aria-hidden="true"><rect x="14" y="13" width="4" height="1.2" rx=".6"/></g>
  </g>
  <g transform="${side(X + W, Y + D, TOP)}"><path class="led db-blink" style="--delay:-1.2s" d="${circle(56, 115, 1.2)}"/></g>`;
  return {
    id: "sqlite",
    height: LID,
    rear,
    front: overlay,
    motion,
    labelTransform: side(X + W, Y + D, TOP),
    labelX: 8,
    labelY: 12.5,
    labelFontSize: 4.2,
    labelMaxChars: 16,
    labelTextLength: 74,
    badge: (t) =>
      logoPlate(
        t,
        front(X, Y + D, TOP),
        { x: 8, y: 26, width: 64, height: 28 },
        { x: 13, y: 30, width: 54, height: 20 },
      ),
  };
}

/**
 * MongoDB: wide shard-blade enclosure.
 *
 * Three horizontal blade modules sit beside a dark leaf plate; the lid carries
 * shard buses and document stacks. The low, wide silhouette and blade seams
 * distinguish it from the taller, drawer-stacked skins.
 */
function mongodbSkin(): DatabaseSkin {
  const X = 18,
    Y = 26,
    W = 252,
    D = 98,
    Z = 16,
    H = 160,
    TOP = Z + H,
    LID = TOP + 6;
  let rear = box(12, 20, 7, 264, 110, 9, 4);
  rear += box(X, Y, Z, W, D, H, 6);
  rear += box(X + 6, Y + 6, TOP, W - 12, D - 12, 6, 3);
  rear += `<g transform="${front(X, Y + D, TOP)}">
    <rect class="face recess" x="6" y="4" width="240" height="154" rx="3"/>
    <path class="db-mongo-rail" d="M58 6H62V154H58Z"/>
    ${[0, 1, 2, 3, 4, 5]
      .map((i) => {
        const y = 7 + i * 22;
        return `<rect class="face db-mongo-blade" x="66" y="${y}" width="174" height="18" rx="1.5"/>
          <text class="label" x="72" y="${y + 11.5}" font-size="3.2">S${i + 1}</text>
          ${slits(92, 206, 6, y + 4, y + 14)}
          <path class="drawer-pull" d="M214 ${y + 9}h16"/>
          <path class="led" d="${circle(84, y + 9, 1.2)}"/>`;
      })
      .join("")}
    <text class="label" x="10" y="48" font-size="3">CONTROL</text>
    ${[0, 1, 2]
      .map(
        (i) =>
          `<rect class="port" x="10" y="${56 + i * 12}" width="18" height="8" rx=".7"/>
          <path class="led" d="${circle(38, 60 + i * 12, 1.2)}"/>`,
      )
      .join("")}
    <path class="detail" d="M8 136H240"/>
    <rect class="port" x="70" y="142" width="14" height="8" rx=".7"/>
    <rect class="port" x="88" y="142" width="14" height="8" rx=".7"/>
    <path class="led" d="${circle(110, 146, 1.2)}"/>
    <text class="label" x="122" y="150" font-size="3">SHARD BUS</text>
  </g>`;
  rear += `<g transform="${side(X + W, Y + D, TOP)}">
    <rect class="face recess" x="8" y="18" width="78" height="72" rx="2"/>
    ${rows(23, 84, 4, 14, 78)}
    <rect class="face recess" x="8" y="96" width="78" height="46" rx="2"/>
    <rect class="port" x="12" y="102" width="14" height="7" rx=".7"/>
    <rect class="port" x="30" y="102" width="14" height="7" rx=".7"/>
    <rect class="port" x="50" y="102" width="14" height="7" rx=".7"/>
    <path class="led" d="${circle(72, 105, 1.2)}"/>
    <text class="label" x="12" y="122" font-size="3">SHARD BUS</text>
    <path class="detail" d="M12 132H78"/> 
  </g>`;
  rear += `<g transform="${top(X, Y, LID)}">
    <rect class="face recess" x="6" y="6" width="240" height="86" rx="3"/>
    ${[14, 40, 66]
      .map(
        (y) =>
          `<path class="db-mongo-bus" d="M12 ${y}H240"/><path class="detail" d="M12 ${y + 4}H240"/>${[
            0, 1, 2, 3, 4, 5, 6, 7,
          ]
            .map(
              (k) =>
                `<path class="detail" d="M26 ${y + 8}v${8 - (k % 3)}M${44 + k * 26} ${y + 8}v${6 + (k % 4)}"/>`,
            )
            .join("")}<path class="led" d="${circle(230, y + 2, 1.2)}"/>`,
      )
      .join("")}
    ${[0, 1, 2]
      .map(
        (i) =>
          `<path class="face db-mongo-doc" d="M${12 + i * 9} ${74 - i * 4}h18v12h-18Z"/>`,
      )
      .join("")}
    <path class="detail" d="${circle(10, 10, 1.1)}${circle(242, 10, 1.1)}${circle(10, 88, 1.1)}${circle(242, 88, 1.1)}"/>
  </g>`;
  const overlay = `<g transform="${front(X, Y + D, TOP)}">
    <path class="face db-mongo-bezel" d="M6 4H246V7H6Z"/>
  </g>`;
  const motion = `<g transform="${front(X, Y + D, TOP)}">
    ${[0, 1, 2, 3, 4, 5]
      .map(
        (i) =>
          `<path class="led db-blink" style="--delay:${(-i * 0.45).toFixed(2)}s" d="${circle(84, 16 + i * 22, 1.2)}"/>`,
      )
      .join("")}
    <g class="db-mongo-pulse" aria-hidden="true"><circle cx="84" cy="16" r="1.2"/></g>
  </g>
  <g transform="${side(X + W, Y + D, TOP)}"><path class="led db-blink" style="--delay:-.9s" d="${circle(72, 105, 1.2)}"/></g>`;
  return {
    id: "mongodb",
    height: LID,
    rear,
    front: overlay,
    motion,
    labelTransform: side(X + W, Y + D, TOP),
    labelX: 8,
    labelY: 12.5,
    labelFontSize: 4.3,
    labelMaxChars: 16,
    labelTextLength: 74,
    badge: (t) =>
      logoPlate(
        t,
        front(X, Y + D, TOP),
        { x: 8, y: 8, width: 46, height: 28 },
        { x: 13, y: 10, width: 36, height: 24 },
      ),
  };
}

/** Skin builders keyed by provider id. */
const SKIN_BUILDERS: Readonly<Record<string, () => DatabaseSkin>> = {
  postgresql: postgresqlSkin,
  mysql: mysqlSkin,
  sqlite: sqliteSkin,
  mongodb: mongodbSkin,
};

/** Built skins for every database provider. */
const SKINS: Readonly<Record<string, DatabaseSkin>> = Object.fromEntries(
  PROVIDERS.filter((theme) => theme.types.includes("database-rack")).map(
    (theme) => [theme.id, SKIN_BUILDERS[theme.id]()],
  ),
);

/**
 * Shared definitions for every provider database cabinet.
 *
 * The scene appends this once, next to the default rack definitions. Each skin
 * keeps its chassis behind a `db-<id>-rear` id and its roof fascia behind a
 * matching `-front` id, so instances share the detailed geometry while the
 * raster cache still sees one static base and one overlay per component.
 *
 * @returns A `<defs>` element containing the nameplate clip and four cabinets.
 */
export function createProviderDatabaseDefinitions(): SVGDefsElement {
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    `<clipPath id="db-name-clip" clipPathUnits="userSpaceOnUse"><rect x="6" y="1" width="82" height="16"/></clipPath>` +
    Object.values(SKINS)
      .map(
        (skin) =>
          `<g id="db-${skin.id}-rear">${skin.rear}</g><g id="db-${skin.id}-front">${skin.front}</g>`,
      )
      .join("");
  return defs;
}

/**
 * Build the nameplate for one provider cabinet.
 *
 * The clip and face transform come from the skin; the text stays outside the
 * cached static layers and is assigned with `textContent`.
 */
function nameplate(instance: PlacedInstance, skin: DatabaseSkin): SVGGElement {
  const group = document.createElementNS(NS, "g");
  group.classList.add("rack-nameplate", "component-label");
  group.setAttribute("transform", skin.labelTransform);
  const label = document.createElementNS(NS, "text");
  label.setAttribute("x", String(skin.labelX));
  label.setAttribute("y", String(skin.labelY));
  label.setAttribute("clip-path", "url(#db-name-clip)");
  label.classList.add("instance-label");
  label.style.fontSize = `${skin.labelFontSize}px`;
  label.textContent = instance.label;
  if (instance.label.length > skin.labelMaxChars) {
    label.setAttribute("textLength", String(skin.labelTextLength));
    label.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
  group.append(label);
  return group;
}

/**
 * Create one provider-designed database cabinet.
 *
 * The returned element follows the component contract: one static base, one
 * live motion layer, one roof overlay, and a live nameplate. The provider mark
 * is printed inside the overlay, so exactly one logo belongs to the object and
 * the raster cache bakes it with the rest of the skin. Unknown providers return
 * null so the caller can fall back to the neutral rack.
 *
 * @param instance - Validated placed database instance.
 * @param theme - Provider theme supporting the database renderer.
 * @returns The cabinet element, or null when no skin is registered.
 */
export function createProviderDatabaseRack(
  instance: PlacedInstance,
  theme: ProviderTheme,
): SVGGElement | null {
  const skin = SKINS[theme.id];
  if (!skin) return null;
  const element = document.createElementNS(NS, "g");
  element.classList.add(
    "database-rack",
    "provider-skin",
    `provider-${theme.id}`,
  );
  element.dataset.rendererType = "database-rack";
  element.dataset.rendererProvider = theme.id;
  element.dataset.instanceId = instance.id;
  element.style.setProperty("--cable-color", instance.color);
  if (theme.plate) element.style.setProperty("--provider-plate", theme.plate);
  element.innerHTML = `<g class="rack-static rack-static-base component-static-base" aria-hidden="true"><use href="#db-${skin.id}-rear"/></g><g class="rack-pulses component-motion" aria-hidden="true">${skin.motion}</g><g class="rack-static rack-static-roof component-static-overlay" aria-hidden="true"><use href="#db-${skin.id}-front"/>${skin.badge(theme)}</g>`;
  element.append(nameplate(instance, skin));
  element.setAttribute("role", "img");
  element.setAttribute(
    "aria-label",
    `${instance.label} (${instance.id}) · ${theme.label} Database Rack`,
  );
  return element;
}

/**
 * Cabinet height for a database provider skin.
 *
 * @param provider - Provider key from the document.
 * @returns Top elevation above the platform, or null for the neutral rack.
 */
export function databaseProviderHeight(
  provider: string | undefined,
): number | null {
  const theme = findProvider(provider, "database-rack");
  return theme ? (SKINS[theme.id]?.height ?? null) : null;
}
