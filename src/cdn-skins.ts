import {
  box,
  circle,
  endFace,
  fan,
  fixed,
  frontFace,
  rows,
  topFace,
} from "./component-geometry";
import { project } from "./database";
import { PROVIDERS, type ProviderTheme } from "./providers";
import type { TransformerEnvelope } from "./transformer-model";

/** A seated physical assembly; dimensions are world units, not SVG pixels. */
interface Module {
  role: "cache" | "router" | "gateway" | "blade";
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

/** Shared footprint and live name rail; each provider owns a different architecture. */
interface Architecture {
  badge: number;
  modules: readonly Module[];
}

/** Compact parts-table constructor; the module includes its four-unit roof cap. */
function module(
  role: Module["role"],
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
): Module {
  return { role, x, y, z, width, depth, height };
}

/** Physical differences remain visible without accents or marks. No pair-specific motion. */
const ARCHITECTURES: Readonly<Record<string, Architecture>> = {
  cloudflare: {
    badge: 0,
    modules: [
      module("gateway", -112, -50, 34, 224, 48, 64),
      module("cache", -120, 14, 34, 108, 44, 30),
      module("cache", 12, 14, 34, 108, 44, 30),
    ],
  },
  cloudfront: {
    badge: 1,
    modules: [
      module("router", -80, -28, 34, 160, 44, 26),
      module("gateway", -42, -24, 64, 84, 36, 48),
      module("cache", -124, -50, 34, 36, 66, 24),
      module("cache", 88, -50, 34, 36, 66, 24),
      module("blade", -124, 30, 34, 248, 30, 18),
    ],
  },
  "google-cloud-cdn": {
    badge: 1,
    modules: [
      module("cache", -124, -52, 34, 72, 68, 42),
      module("gateway", -36, -52, 34, 72, 68, 68),
      module("cache", 52, -52, 34, 72, 68, 50),
      module("router", -124, 34, 34, 248, 24, 20),
    ],
  },
  "azure-front-door": {
    badge: 2,
    modules: [
      module("cache", -116, -46, 34, 56, 86, 90),
      module("cache", 60, -46, 34, 56, 86, 90),
      module("gateway", -58, -46, 98, 116, 44, 28),
      module("router", -52, 14, 34, 104, 40, 26),
    ],
  },
  fastly: {
    badge: 0,
    modules: [
      module("blade", -124, -46, 34, 248, 100, 22),
      module("blade", -118, -40, 60, 236, 88, 16),
      module("router", 80, -40, 80, 34, 88, 16),
    ],
  },
  akamai: {
    badge: 0,
    modules: [
      module("gateway", -114, -54, 34, 168, 36, 74),
      module("cache", -114, -8, 34, 204, 36, 50),
      module("router", -114, 40, 34, 240, 20, 26),
      module("cache", 100, -50, 34, 26, 78, 58),
    ],
  },
  bunny: {
    badge: 1,
    modules: [
      module("cache", -116, -42, 34, 68, 92, 62),
      module("gateway", -24, -42, 34, 68, 92, 78),
      module("router", 68, -28, 34, 48, 76, 28),
    ],
  },
  cdn77: {
    badge: 0,
    modules: [
      module("gateway", -124, -54, 34, 88, 90, 104),
      module("cache", 36, -54, 34, 88, 90, 104),
      module("router", -30, -30, 34, 60, 64, 32),
      module("blade", -124, 48, 34, 248, 12, 16),
    ],
  },
  keycdn: {
    badge: 0,
    modules: [
      module("gateway", -120, -50, 34, 52, 102, 100),
      module("cache", -56, -50, 34, 178, 38, 34),
      module("cache", -56, 2, 34, 124, 48, 54),
      module("router", 82, 4, 34, 40, 46, 24),
    ],
  },
  "alibaba-cloud-cdn": {
    badge: 2,
    modules: [
      module("cache", -116, -48, 34, 36, 70, 80),
      module("cache", 80, -48, 34, 36, 70, 80),
      module("gateway", -78, -48, 94, 156, 36, 20),
      module("cache", -66, 2, 34, 36, 50, 34),
      module("cache", -18, 2, 34, 36, 50, 34),
      module("cache", 30, 2, 34, 36, 50, 34),
    ],
  },
};

/** Immutable cached artwork plus its separately mounted, bounded live layer. */
interface CdnSkin {
  markup: string;
  motion: string;
  height: number;
  envelope: TransformerEnvelope;
}

/** Cap plus mounted roof hardware; blades keep an unbroken low cooling deck. */
function moduleTop(part: Module): number {
  return part.z + part.height + (part.role === "blade" ? 4 : 7);
}

/**
 * Build a complete seated module: opaque chassis, recessed bays, I/O, cooling,
 * cap, and attached roof hardware. A module never animates its individual faces.
 */
function moduleArtwork(part: Module, index: number): string {
  const { x, y, z, width: w, depth: d, height: h, role } = part;
  const top = z + h;
  let front = `<rect class="cdn-panel" x="4" y="3" width="${w - 8}" height="${h - 6}" rx="1.2"/>
    <path class="cdn-map" d="M8 5H${w - 8}"/>`;
  if (role === "cache") {
    for (let row = 9; row < h - 14; row += 14)
      front += `<rect class="face recess" x="8" y="${row}" width="${w - 16}" height="10" rx="1"/>
        <path class="detail" d="M11 ${row + 3}H${w - 14}M11 ${row + 7}h5"/>
        <path class="led" d="${circle(w - 12, row + 7, 0.65)}"/>`;
  } else if (role === "gateway" && h > 42) {
    front += `<rect class="cdn-display" x="8" y="27" width="${w - 16}" height="${h - 40}" rx="1.5"/>
      <path class="cdn-map" d="M13 ${h - 19}L${w / 2} 32L${w - 13} ${h - 19}M${w / 2} 32V${h - 16}"/>
      <path class="cdn-node" d="${circle(w / 2, 32, 1.7)}${circle(13, h - 19, 1)}${circle(w - 13, h - 19, 1)}"/>`;
  }
  const portCount = Math.min(8, Math.floor((w - 16) / 11));
  for (let port = 0; port < portCount; port++)
    front += `<rect class="port" x="${8 + port * 11}" y="${h - 9}" width="7" height="5" rx=".6"/>
      <path class="detail" d="M${10 + port * 11} ${h - 8}v3M${13 + port * 11} ${h - 8}v3"/>`;
  if (w > 44 && h > 28)
    front += `<text class="label" x="9" y="${h - 12}" font-size="3.2">${role.toUpperCase()} / 0${index + 1}</text>`;
  let svg =
    `<g class="cdn-module" data-cdn-assembly="${role}">` +
    box(x, y, z, w, d, h, 2) +
    `<g transform="${frontFace(x, y + d, top)}">${front}</g>
    <g transform="${endFace(x + w, y + d, top)}">
      <rect class="face recess" x="4" y="4" width="${d - 8}" height="${h - 8}" rx="1"/>
      <path class="detail" d="${rows(8, h - 6, 4, 7, d - 7)}"/>
    </g>` +
    box(x - 2, y - 2, top, w + 4, d + 4, 4, 1.5);
  if (role === "cache") {
    const count = w > 90 ? 3 : 2;
    const pitch = (w - 10) / count;
    const cartridgeWidth = Math.min(18, pitch - 4);
    for (let bank = 0; bank < count; bank++) {
      const bx = x + 5 + bank * pitch;
      svg += box(bx, y + 7, top + 4, cartridgeWidth, d - 14, 3, 0.7);
      svg += `<g transform="${topFace(bx, y + 7, top + 7)}">
        <rect class="cdn-panel" x="2" y="3" width="${cartridgeWidth - 4}" height="${d - 20}" rx=".5"/>
        <path class="led" d="${circle(cartridgeWidth / 2, 6, 0.6)}"/>
      </g>`;
    }
  } else if (role === "blade") {
    svg += `<g transform="${topFace(x, y, top + 4)}">
      <path class="detail" d="${rows(4, d - 4, 4, 8, w - 8)}"/>
      <path class="cdn-map" d="M${w - 12} 4V${d - 4}"/>
    </g>`;
  } else {
    const bw = Math.min(42, w - 12),
      bd = Math.min(28, d - 10);
    const bx = x + (w - bw) / 2,
      by = y + (d - bd) / 2;
    svg += box(bx, by, top + 4, bw, bd, 3, 0.8);
    svg += `<g transform="${topFace(bx, by, top + 7)}">${fan(bw / 2, bd / 2, Math.min(bw, bd) * 0.33)}</g>
      <g transform="${topFace(x, y, top + 4)}">
        <path class="detail" d="${circle(5, 5, 0.8)}${circle(w - 5, 5, 0.8)}${circle(5, d - 5, 0.8)}${circle(w - 5, d - 5, 0.8)}"/>
        <path class="cdn-map" d="M5 ${d / 2}H${(w - bw) / 2 - 2}M${(w + bw) / 2 + 2} ${d / 2}H${w - 5}"/>
      </g>`;
  }
  return svg + "</g>";
}

/** Preserve upstream geometry and root fill when mounting one mark on its fascia. */
function providerBadge(theme: ProviderTheme, part: Module): string {
  const viewBox = /viewBox="([^"]+)"/.exec(theme.logo)![1];
  const fill = /<svg\b[^>]*\bfill="([^"]+)"/.exec(theme.logo)?.[1] ?? "none";
  const art = theme.logo
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "");
  const width = Math.min(60, part.width - 10),
    height = Math.min(22, part.height - 8);
  const x = (part.width - width) / 2;
  return `<g class="cdn-provider-badge" transform="${frontFace(part.x, part.y + part.depth, part.z + part.height)}">
    <rect class="brand-plate" x="${x}" y="4" width="${width}" height="${height}" rx="1.5"/>
    <svg x="${x + 3}" y="6" width="${width - 6}" height="${height - 4}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><g fill="${fill}">${art}</g></svg>
  </g>`;
}

/** Short attached patch leads descend from service ports onto the shared deck. */
function patchRoutes(parts: readonly Module[]): string[] {
  const origin = parts[0];
  return parts.slice(1, 4).map((target, index) => {
    const sx = origin.x + origin.width * 0.65,
      sy = origin.y + origin.depth;
    const tx = target.x + target.width * 0.35,
      ty = target.y + target.depth;
    const lane = 61 + index * 2;
    const points = [
      [sx, sy, origin.z + 8],
      [sx, sy + 3, origin.z + 8],
      [sx, lane, 34],
      [tx, lane, 34],
      [tx, ty + 3, target.z + 8],
      [tx, ty, target.z + 8],
    ];
    return `M${points.map(([px, py, pz]) => project(px, py, pz).map(fixed).join(" ")).join("L")}`;
  });
}

/** Build once per skin; static routes share pixels, at most three packet dashes stay live. */
export const CDN_SKINS: Readonly<Record<string, CdnSkin>> = Object.fromEntries(
  PROVIDERS.filter((theme) => theme.types.includes("cdn")).map((theme) => {
    const architecture = ARCHITECTURES[theme.id]!;
    const height = Math.max(...architecture.modules.map(moduleTop));
    const routes = patchRoutes(architecture.modules);
    let markup =
      box(-144, -75, 7, 288, 150, 9, 3) + box(-136, -67, 16, 272, 134, 16, 2);
    markup += routes.map((d) => `<path class="cdn-link" d="${d}"/>`).join("");
    const ordered = architecture.modules
      .slice()
      .sort((a, b) => a.z - b.z || a.x + a.y - b.x - b.y);
    for (const [index, part] of ordered.entries())
      markup += moduleArtwork(part, index);
    markup += providerBadge(theme, architecture.modules[architecture.badge]);
    markup += `<g transform="${frontFace(-136, 67, 32)}"><path class="detail" d="M8 11H249"/><rect class="port" x="252" y="4" width="11" height="7" rx=".7"/></g>`;
    const motion =
      routes
        .map(
          (d, index) =>
            `<path class="cdn-packet" pathLength="100" style="--delay:${-index * 0.8}s" d="${d}"/>`,
        )
        .join("") +
      `<g transform="${frontFace(-136, 67, 32)}"><path class="led cdn-status" d="${circle(242, 7, 0.65)}${circle(246, 7, 0.65)}${circle(250, 7, 0.65)}"/></g>`;
    return [
      theme.id,
      {
        markup,
        motion,
        height,
        envelope: {
          x: -136,
          y: -67,
          z: 16,
          width: 272,
          depth: 134,
          height: height - 16,
        },
      },
    ];
  }),
);
