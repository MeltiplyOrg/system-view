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

/** A switching deck makes workflow decisions legible without another server-shaped box. */
function switcher(join: boolean): string {
  return (
    plinth() +
    box(-98, -48, 18, 196, 96, 48, 3) +
    `<g transform="${frontFace(-98, 48, 66)}"><rect class="face recess" x="9" y="8" width="178" height="30" rx="3"/><text class="label" x="18" y="27" font-size="10">${join ? "MERGE / SYNC" : "IF / ELSE"}</text><path class="led" d="${circle(167, 22, 3)}"/></g>` +
    box(-100, -50, 66, 200, 100, 6, 3) +
    `<g transform="${topFace(-100, -50, 72)}"><rect class="face recess" x="12" y="12" width="176" height="76" rx="5"/><path class="cdn-map" d="${join ? "M30 25H75L118 50H166M30 75H75L118 50" : "M30 50H85L125 25H170M85 50L125 75H170"}"/><path class="led" d="${circle(30, join ? 25 : 50, 4)}${circle(170, join ? 50 : 25, 4)}${circle(join ? 30 : 170, 75, 4)}"/><text class="label" x="140" y="18" font-size="7">${join ? "OUT" : "TRUE"}</text><text class="label" x="140" y="88" font-size="7">${join ? "SYNC" : "FALSE"}</text></g>`
  );
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
const BRANCH = model(switcher(false), 72);
const MERGE = model(switcher(true), 72);

/** Resolve a media renderer's actual body, height and nameplate as one contract. */
export function mediaModel(
  type: string,
  provider?: string,
): MediaModel | undefined {
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
