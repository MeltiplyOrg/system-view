import {
  box,
  circle,
  fan,
  frontFace,
  endFace,
  rows,
  topFace,
} from "./component-geometry";
import type { TransformerEnvelope } from "./transformer-model";
import { MEDIA_MARKS } from "./media-provider-marks";

/** Physical metaphors for logical cloud services, not representations of vendor hardware. */
interface MediaModel {
  markup: string;
  height: number;
  envelope: TransformerEnvelope;
  labelTransform: string;
  labelX: number;
  labelY: number;
  labelMaxChars: number;
  labelTextLength: number;
}

/** A seated plinth supports independently enclosed functional modules. */
function plinth(): string {
  return box(-136, -67, 5, 272, 134, 8, 2) + box(-130, -61, 13, 260, 122, 5, 1);
}

/** Three queue architectures: cassette lanes, sealed managed trays, and a compact streaming switch. */
function queue(kind: "lanes" | "sealed" | "switch"): string {
  let art = plinth();
  const levels = kind === "switch" ? 2 : 3;
  for (let level = 0; level < levels; level++) {
    const z = 18 + level * 30;
    art += box(-112, -49, z, 224, 98, 27, 2);
    art += `<g transform="${frontFace(-112, 49, z + 27)}"><rect class="face recess" x="8" y="5" width="208" height="17" rx="2"/>`;
    for (let slot = 0; slot < (kind === "sealed" ? 3 : 6); slot++) {
      const x = 15 + slot * (kind === "sealed" ? 65 : 32);
      art += `<rect class="face drawer-front" x="${x}" y="7" width="${kind === "sealed" ? 58 : 27}" height="12" rx="1"/><path class="led" d="M${x + 3} 10h${kind === "sealed" ? 38 : 12}"/><path class="detail" d="M${x + 4} 16h8"/>`;
    }
    art += `</g><g transform="${endFace(112, 49, z + 27)}"><path class="detail" d="${rows(7, 20, 4, 10, 88)}"/></g>`;
  }
  const top = 18 + levels * 30;
  art += box(-114, -51, top - 3, 228, 102, 5, 2);
  art += `<g transform="${topFace(-114, -51, top + 2)}"><path class="detail" d="M12 14h202v74H12Z"/><path class="led" d="M29 51h170m-12-9 12 9-12 9"/><text class="label" x="27" y="34" font-size="8">${kind === "switch" ? "STREAM / ACK" : kind === "sealed" ? "MANAGED / JOBS" : "READY / IN-FLIGHT / ACK"}</text></g>`;
  return art;
}

/** Archive library: broad drive blades and a controller spine; R2 uses fewer, taller removable cartridges. */
function storage(compact: boolean): string {
  let art = plinth();
  const count = compact ? 2 : 3,
    width = compact ? 89 : 58;
  for (let i = 0; i < count; i++) {
    const x = -122 + i * (width + 6);
    art += box(x, -49, 18, width, 98, 111, 3);
    art += `<g transform="${frontFace(x, 49, 129)}"><rect class="face recess" x="5" y="8" width="${width - 10}" height="90" rx="3"/>`;
    for (let bay = 0; bay < 5; bay++)
      art += `<rect class="face drawer-front" x="9" y="${14 + bay * 16}" width="${width - 18}" height="12" rx="1"/><path class="led" d="${circle(width - 14, 19 + bay * 16, 1.3)}"/>`;
    art += `</g>`;
    art += box(x - 1, -50, 129, width + 2, 100, 5, 2);
  }
  // This spine is on the near (+x) side of every blade. Paint it last so its
  // front panel occludes the farther drive walls instead of being cut through.
  art += box(83, -52, 18, 36, 105, 118, 2);
  art += `<g transform="${frontFace(83, 53, 136)}"><rect class="face recess" x="5" y="9" width="26" height="82" rx="2"/>${fan(18, 106, 10)}<path class="led" d="M11 20h14m-14 8h14m-14 8h14"/></g>`;
  return art;
}

/** Encoding workstation: exposed GPU blades behind a pair of front cooling modules. */
function worker(ffmpeg: boolean): string {
  let art = plinth() + box(-126, -57, 18, 252, 114, 39, 2);
  art += `<g transform="${frontFace(-126, 57, 57)}"><rect class="face recess" x="7" y="6" width="238" height="27" rx="2"/>${fan(26, 20, 11)}${fan(54, 20, 11)}<rect class="port" x="211" y="12" width="22" height="11" rx="1"/><path class="led" d="M79 13h108m-108 7h75m-75 7h93"/></g>`;
  for (let i = 0; i < (ffmpeg ? 3 : 2); i++) {
    const x = -111 + i * (ffmpeg ? 71 : 107);
    art += box(x, -43, 57, ffmpeg ? 61 : 97, 86, 26 + i * 4, 1);
    art += `<g transform="${topFace(x, -43, 83 + i * 4)}"><path class="detail" d="${rows(8, 77, 5, 5, ffmpeg ? 56 : 92)}"/><rect class="internal-chip" x="${ffmpeg ? 20 : 38}" y="31" width="21" height="24" rx="2"/><path class="led" d="M8 14h${ffmpeg ? 44 : 80}"/></g>`;
  }
  return art;
}

/** Cable-sized decision and convergence fittings; no cabinet, plinth or nameplate. */
function junction(join: boolean): MediaModel {
  const body = join
    ? `<g transform="${topFace(0, 0, 3)}"><path class="face" d="${circle(0, 0, 20)}"/></g><g transform="${topFace(0, 0, 10)}"><path class="face top junction-core" d="${circle(0, 0, 20)}"/></g>`
    : box(-16, -16, 3, 32, 32, 7, 3);
  return {
    markup:
      body +
      `<g transform="${topFace(0, 0, 10)}"><path class="junction-symbol" d="${join ? "M-11-8L0 0H12M-11 8L0 0m7-4 5 4-5 4" : "M-12 0H-2L10-10M-2 0L10 10M4-10H10V-4M4 10H10V4"}"/></g>`,
    height: 10,
    envelope: { x: -20, y: -20, z: 3, width: 40, depth: 40, height: 7 },
    labelTransform: "translate(0 22)",
    labelX: 0,
    labelY: 0,
    labelMaxChars: 24,
    labelTextLength: 100,
  };
}

/** A stepped crossbar switch: ingress console, exposed routing deck and raised backend port bank. */
function loadBalancer(): string {
  // Seated base → lower console → deck details → raised rear I/O bank.
  let art = plinth() + box(-126, -57, 18, 252, 114, 34, 2);
  art += `<g transform="${frontFace(-126, 57, 52)}"><rect class="face recess" x="7" y="5" width="238" height="23" rx="2"/><rect class="port" x="15" y="10" width="30" height="13" rx="1"/><path class="detail" d="M20 13h20m-20 3h20m-20 3h20"/><path class="led" d="${circle(51, 12, 1.5)}"/><text class="label" x="65" y="20" font-size="7">INGRESS / ROUND ROBIN</text><path class="led" d="${circle(224, 12, 2)}${circle(233, 12, 2)}"/></g>`;
  art += `<g transform="${endFace(126, 57, 52)}"><rect class="face recess" x="8" y="6" width="98" height="21" rx="2"/><path class="detail" d="${rows(10, 23, 3, 15, 80)}"/><rect class="port" x="89" y="11" width="11" height="10" rx="1"/></g>`;
  art += `<g transform="${topFace(-126, -57, 52)}"><path class="detail" d="M7 53H245V106H7Z"/><path class="cdn-map" d="M30 99V75H210M80 75V56m65 19V56m65 19V56"/><path class="led" d="${circle(30, 99, 3)}${circle(80, 56, 2)}${circle(145, 56, 2)}${circle(210, 56, 2)}"/><text class="label" x="75" y="99" font-size="6">ONE REQUEST / ONE BACKEND</text></g>`;
  art += box(-110, -49, 52, 220, 38, 34, 2);
  art += `<g transform="${frontFace(-110, -11, 86)}"><rect class="face recess" x="6" y="5" width="208" height="24" rx="2"/>`;
  for (let bank = 0; bank < 3; bank++) {
    const x = 14 + bank * 65;
    art += `<rect class="face drawer-front" x="${x}" y="8" width="56" height="18" rx="1"/><rect class="port" x="${x + 5}" y="12" width="18" height="10" rx="1"/><rect class="port" x="${x + 30}" y="12" width="18" height="10" rx="1"/><path class="led" d="${circle(x + 51, 12, 1.2)}"/>`;
  }
  art += `</g><g transform="${topFace(-110, -49, 86)}"><path class="detail" d="M8 7h204v24H8Z"/><path class="detail" d="${rows(11, 27, 4, 90, 202)}"/><text class="label" x="15" y="22" font-size="6">BACKENDS / 01–03</text></g>`;
  return art;
}

/** Freeze artwork once; every world node and placement ghost shares the normal raster cache. */
function model(
  markup: string,
  height: number,
  provider?: string,
  plate = topFace(-114, -51, height),
): MediaModel {
  const brand = provider
    ? `<g transform="${plate}"><rect class="face brand-plate" x="178" y="12" width="30" height="30" rx="2"/><svg x="182" y="16" width="22" height="22">${MEDIA_MARKS[provider]}</svg></g>`
    : "";
  return {
    markup: markup + brand,
    height,
    envelope: {
      x: -126,
      y: -57,
      z: 18,
      width: 252,
      depth: 114,
      height: height - 18,
    },
    labelTransform: frontFace(-130, 61, 18),
    labelX: 10,
    labelY: 4,
    labelMaxChars: 44,
    labelTextLength: 238,
  };
}
const QUEUE = model(queue("lanes"), 110);
const RABBIT = model(QUEUE.markup, 110, "rabbitmq");
const SQS = model(queue("sealed"), 110, "amazon-sqs");
const NATS = model(queue("switch"), 80, "nats-jetstream");
const STORAGE = model(storage(false), 136);
const S3 = model(STORAGE.markup, 136, "amazon-s3", topFace(-91, -52, 136));
const R2 = model(storage(true), 136, "cloudflare-r2", topFace(-91, -52, 136));
const WORKER = model(worker(false), 91);
const FFMPEG = model(worker(true), 91, "ffmpeg", topFace(-126, -43, 91));
const BRANCH = junction(false);
const MERGE = junction(true);
const LOAD_BALANCER = model(loadBalancer(), 86);

/** Resolve a media renderer's actual body, height and nameplate as one contract. */
export function mediaModel(
  type: string,
  provider?: string,
): MediaModel | undefined {
  if (type === "load-balancer") return LOAD_BALANCER;
  if (type === "message-queue")
    return provider === "amazon-sqs"
      ? SQS
      : provider === "nats-jetstream"
        ? NATS
        : provider === "rabbitmq"
          ? RABBIT
          : QUEUE;
  if (type === "object-storage")
    return provider === "cloudflare-r2"
      ? R2
      : provider === "amazon-s3"
        ? S3
        : STORAGE;
  if (type === "media-worker") return provider === "ffmpeg" ? FFMPEG : WORKER;
  if (type === "branch") return BRANCH;
  if (type === "merge") return MERGE;
  return undefined;
}
