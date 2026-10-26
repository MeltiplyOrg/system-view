import type { PlacedInstance } from "./design";
import { CDN_MARKS } from "./cdn-provider-marks";
import { MEDIA_MARKS } from "./media-provider-marks";

/** Half extents of a provider's ground footprint in world units. */
export interface ProviderFootprint {
  halfWidth: number;
  halfDepth: number;
}

/**
 * Presentation themes for instance providers.
 *
 * A provider is an optional identifier on an instance (`provider: "redis"`).
 * Known providers replace the component's accent color, may select dedicated
 * artwork in the renderer, and contribute a mark to the tooltip and object
 * badges. Each theme
 * declares the renderer types it supports, so a provider cannot be applied to
 * an unrelated component. Providers are matched case-insensitively; unknown
 * values are ignored, so a document written for a newer provider still opens
 * with the default skin.
 */
export interface ProviderTheme {
  /** Canonical lowercase identifier matched against the document field. */
  id: string;
  /** Human-readable product name for the tooltip mark and accessible label. */
  label: string;
  /** Accent used for LEDs, ports, cables, and provider tinting. */
  color: string;
  /**
   * Renderer types this provider can skin.
   *
   * The picker and color resolution must both consult this list: Redis is a
   * cache technology and must not restyle databases, servers, or pages.
   */
  types: readonly PlacedInstance["type"][];
  /**
   * Ground footprint overrides per renderer type.
   *
   * The platform, dashed node border, and routing bounds use these extents.
   * Omitted types keep the shared 288 × 150 rack foot.
   */
  footprints?: Partial<Record<PlacedInstance["type"], ProviderFootprint>>;
  /**
   * Self-contained SVG mark for the tooltip and printable object badges.
   *
   * Trusted constant markup; the brand fills are embedded so a card or badge
   * needs no network request or stylesheet to render the provider logo.
   */
  logo: string;
  /**
   * Enamel plate behind the mark in the tooltip and on object badges.
   *
   * Omit for the shared dark plate. Providers with a specific enamel tone
   * override it so their mark keeps contrast without a white backing.
   */
  plate?: string;
}

/**
 * Official Redis mark paths from thesvg.org (256 × 220), used unchanged.
 *
 * Exported separately so the 3D renderer can print the exact mark on the
 * cabinet instead of approximating it. The artwork carries its own brand
 * fills, so neither the tooltip nor a themed drawing recolors it. Source:
 * https://thesvg.org/icon/redis
 */
export const REDIS_LOGO_ART = `<path d="M246 169c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 209.4 24 179 10.3 172.5 3.6 169.3 0 166.5 0 164v-26s98-21.3 113.9-27c15.8-5.6 21.3-5.8 34.8-.9 13.4 5 94 19.5 107.3 24.3V160c0 2.5-3 5.3-10 9" fill="#912626"/><path d="M246 143.2c-13.7 7.1-84.5 36.2-99.5 44-15.1 8-23.5 7.9-35.4 2.2-11.9-5.7-87.2-36.1-100.8-42.6-13.5-6.5-13.8-11-.5-16.2 13.4-5.2 88.2-34.6 104-40.3 16-5.6 21.4-5.8 34.9-1 13.4 5 83.8 33 97.1 37.9 13.3 4.9 13.8 8.9.2 16" fill="#C6302B"/><path d="M246 127c-13.7 7.2-84.5 36.3-99.5 44.2-15.1 7.8-23.5 7.7-35.4 2-11.9-5.6-87.2-36-100.8-42.6-6.7-3.2-10.3-6-10.3-8.5V96.2s98-21.3 113.9-27c15.8-5.7 21.3-5.9 34.8-1 13.4 5 94 19.5 107.3 24.4V118c0 2.5-3 5.4-10 9" fill="#912626"/><path d="M246 101.4c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 141.8 24 111.4 10.3 105c-13.5-6.5-13.8-11-.5-16.1C23.2 83.5 98 54 113.8 48.5c16-5.7 21.4-6 34.9-1 13.4 5 83.8 33 97.1 37.8 13.3 5 13.8 9 .2 16" fill="#C6302B"/><path d="M246 83.7c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 124.1 24 93.7 10.3 87.2 3.6 84 0 81.2 0 78.7v-26s98-21.3 113.9-27c15.8-5.6 21.3-5.8 34.8-.9 13.4 5 94 19.5 107.3 24.4v25.5c0 2.5-3 5.3-10 9" fill="#912626"/><path d="M246 58c-13.7 7-84.5 36.1-99.5 44-15.1 7.9-23.5 7.8-35.4 2C99.2 98.5 24 68 10.3 61.6c-13.5-6.5-13.8-11-.5-16.2C23.2 40.1 98 10.7 113.8 5c16-5.6 21.4-5.8 34.9-.9 13.4 5 83.8 33 97.1 37.8 13.3 4.9 13.8 9 .2 16" fill="#C6302B"/><path d="m159.3 32.8-22 2.2-5 11.9-8-13.2L99 31.4l19-6.9-5.8-10.5 17.8 7 16.7-5.5-4.5 10.9 17 6.4M131 90.3l-41-17 58.8-9.1-17.8 26M74 39.3c17.5 0 31.5 5.5 31.5 12.2 0 6.8-14 12.2-31.4 12.2s-31.5-5.4-31.5-12.2c0-6.7 14.1-12.2 31.5-12.2" fill="#FFF"/><path d="M185.3 36 220 49.8l-34.8 13.7V36" fill="#621B1C"/><path d="M146.8 51.2 185.3 36v27.5l-3.8 1.5-34.7-13.8" fill="#9A2928"/>`;

/** Official Redis mark wrapped as a self-contained SVG for the tooltip. */
export const REDIS_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 256 220" aria-hidden="true" focusable="false">${REDIS_LOGO_ART}</svg>`;

/**
 * Official PostgreSQL mark from thesvg.org (432 × 445), used unchanged.
 *
 * The artwork carries its own brand fills and white highlights, so it is never
 * recolored. Source: https://thesvg.org/icon/postgresql
 */
export const POSTGRES_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 432.071 445.383"><g style="fill-rule:nonzero;clip-rule:nonzero;fill:none;stroke:#fff;stroke-width:12.4651;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:4"><path d="M323.205 324.227c2.833-23.601 1.984-27.062 19.563-23.239l4.463.392c13.517.615 31.199-2.174 41.587-7 22.362-10.376 35.622-27.7 13.572-23.148-50.297 10.376-53.755-6.655-53.755-6.655 53.111-78.803 75.313-178.836 56.149-203.322-52.27-66.789-142.748-35.206-144.262-34.386l-.482.089c-9.938-2.062-21.06-3.294-33.554-3.496-22.761-.374-40.032 5.967-53.133 15.904 0 0-161.408-66.498-153.899 83.628 1.597 31.936 45.777 241.655 98.47 178.31 19.259-23.163 37.871-42.748 37.871-42.748 9.242 6.14 20.307 9.272 31.912 8.147l.897-.765c-.281 2.876-.157 5.689.359 9.019-13.572 15.167-9.584 17.83-36.723 23.416-27.457 5.659-11.326 15.734-.797 18.367 12.768 3.193 42.305 7.716 62.268-20.224l-.795 3.188c5.325 4.26 4.965 30.619 5.72 49.452.756 18.834 2.017 36.409 5.856 46.771 3.839 10.36 8.369 37.05 44.036 29.406 29.809-6.388 52.6-15.582 54.677-101.107" style="fill:#000;stroke:#000;stroke-width:37.3953;stroke-linecap:butt;stroke-linejoin:miter"/><path stroke="none" d="M402.395 271.23c-50.302 10.376-53.76-6.655-53.76-6.655 53.111-78.808 75.313-178.843 56.153-203.326-52.27-66.785-142.752-35.2-144.262-34.38l-.486.087c-9.938-2.063-21.06-3.292-33.56-3.496-22.761-.373-40.026 5.967-53.127 15.902 0 0-161.411-66.495-153.904 83.63 1.597 31.938 45.776 241.657 98.471 178.312 19.26-23.163 37.869-42.748 37.869-42.748 9.243 6.14 20.308 9.272 31.908 8.147l.901-.765c-.28 2.876-.152 5.689.361 9.019-13.575 15.167-9.586 17.83-36.723 23.416-27.459 5.659-11.328 15.734-.796 18.367 12.768 3.193 42.307 7.716 62.266-20.224l-.796 3.188c5.319 4.26 9.054 27.711 8.428 48.969-.626 21.259-1.044 35.854 3.147 47.254 4.191 11.4 8.368 37.05 44.042 29.406 29.809-6.388 45.256-22.942 47.405-50.555 1.525-19.631 4.976-16.729 5.194-34.28l2.768-8.309c3.192-26.611.507-35.196 18.872-31.203l4.463.392c13.517.615 31.208-2.174 41.591-7 22.358-10.376 35.618-27.7 13.573-23.148z" style="fill:#336791;stroke:none"/><path d="M215.866 286.484c-1.385 49.516.348 99.377 5.193 111.495 4.848 12.118 15.223 35.688 50.9 28.045 29.806-6.39 40.651-18.756 45.357-46.051 3.466-20.082 10.148-75.854 11.005-87.281M173.104 38.256S11.583-27.76 19.092 122.365c1.597 31.938 45.779 241.664 98.473 178.316 19.256-23.166 36.671-41.335 36.671-41.335M260.349 26.207c-5.591 1.753 89.848-34.889 144.087 34.417 19.159 24.484-3.043 124.519-56.153 203.329"/><path d="M348.282 263.953s3.461 17.036 53.764 6.653c22.04-4.552 8.776 12.774-13.577 23.155-18.345 8.514-59.474 10.696-60.146-1.069-1.729-30.355 21.647-21.133 19.96-28.739-1.525-6.85-11.979-13.573-18.894-30.338-6.037-14.633-82.796-126.849 21.287-110.183 3.813-.789-27.146-99.002-124.553-100.599-97.385-1.597-94.19 119.762-94.19 119.762" style="stroke-linejoin:bevel"/><path d="M188.604 274.334c-13.577 15.166-9.584 17.829-36.723 23.417-27.459 5.66-11.326 15.733-.797 18.365 12.768 3.195 42.307 7.718 62.266-20.229 6.078-8.509-.036-22.086-8.385-25.547-4.034-1.671-9.428-3.765-16.361 3.994z"/><path d="M187.715 274.069c-1.368-8.917 2.93-19.528 7.536-31.942 6.922-18.626 22.893-37.255 10.117-96.339-9.523-44.029-73.396-9.163-73.436-3.193-.039 5.968 2.889 30.26-1.067 58.548-5.162 36.913 23.488 68.132 56.479 64.938"/><path d="M172.517 141.7c-.288 2.039 3.733 7.48 8.976 8.207 5.234.73 9.714-3.522 9.998-5.559.284-2.039-3.732-4.285-8.977-5.015-5.237-.731-9.719.333-9.996 2.367z" style="fill:#fff;stroke-width:4.155;stroke-linecap:butt;stroke-linejoin:miter"/><path d="M331.941 137.543c.284 2.039-3.732 7.48-8.976 8.207-5.238.73-9.718-3.522-10.005-5.559-.277-2.039 3.74-4.285 8.979-5.015 5.239-.73 9.718.333 10.002 2.368z" style="fill:#fff;stroke-width:2.0775;stroke-linecap:butt;stroke-linejoin:miter"/><path d="M350.676 123.432c.863 15.994-3.445 26.888-3.988 43.914-.804 24.748 11.799 53.074-7.191 81.435"/></g></svg>`;

/**
 * Official MySQL mark from thesvg.org (256 × 252), used unchanged.
 *
 * The white dolphin sits on the dark enamel plate shared by the tooltip and
 * the printed database badge. Source: https://thesvg.org/icon/mysql
 */
export const MYSQL_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 256 252"><path fill="#FFF" d="M236 194c-14 0-25 1-34 5-3 1-7 1-7 4l3 6c2 3 5 8 9 11l11 8 21 10 11 9 6 4-3-6-5-5c-5-7-11-13-18-18-6-3-18-9-20-15h-1l12-3 18-3 8-2v-2l-9-10c-8-8-18-15-28-22l-18-8c-2-1-6-2-7-4l-7-13-15-30-8-20c-18-30-38-48-68-65-6-4-14-5-22-7l-13-1-8-6C34 5 8-9 1 9c-5 11 7 22 11 28l9 13 3 9c3 8 5 17 9 24l6 10c2 2 4 3 5 6-3 4-3 9-4 13-7 20-4 44 5 59 2 4 9 14 18 10 8-3 6-13 8-22l1-4 8 14c5 9 14 18 22 24 4 3 8 8 13 10l-4-4-9-10c-8-10-14-21-20-32l-7-17-3-6c-3 4-7 7-9 12-3 7-3 17-4 26h-1c-6-1-8-7-10-12-5-12-6-32-1-46 1-4 6-15 4-19-1-3-4-5-6-7l-7-12-10-30-9-13c-3-5-7-8-10-14-1-2-2-5 0-7l2-2c2-2 9 0 11 1 6 3 12 5 17 9l8 6h4c6 1 12 0 17 2 9 3 18 7 25 12 23 14 42 35 54 59 3 4 3 8 5 12l12 26c4 8 7 16 12 23 3 4 14 6 18 8l12 4 18 12c2 2 11 7 12 10Z"/><path fill="#FFF" d="m58 43-7 1 6 7 4 9v-1c3-1 4-4 4-8l-2-4-5-4Z"/></svg>`;

/**
 * Official SQLite mark, monochrome variant, used unchanged.
 *
 * The single-color path is recolored by the dark badge plate so the feather
 * and wordmark stay legible without a white background. Source:
 * https://thesvg.org/icon/sqlite
 */
export const SQLITE_LOGO = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>SQLite</title><path fill="#f2f6f7" d="M21.678.521c-1.032-.92-2.28-.55-3.513.544a8.71 8.71 0 0 0-.547.535c-2.109 2.237-4.066 6.38-4.674 9.544.237.48.422 1.093.544 1.561a13.044 13.044 0 0 1 .164.703s-.019-.071-.096-.296l-.05-.146a1.689 1.689 0 0 0-.033-.08c-.138-.32-.518-.995-.686-1.289-.143.423-.27.818-.376 1.176.484.884.778 2.4.778 2.4s-.025-.099-.147-.442c-.107-.303-.644-1.244-.772-1.464-.217.804-.304 1.346-.226 1.478.152.256.296.698.422 1.186.286 1.1.485 2.44.485 2.44l.017.224a22.41 22.41 0 0 0 .056 2.748c.095 1.146.273 2.13.5 2.657l.155-.084c-.334-1.038-.47-2.399-.41-3.967.09-2.398.642-5.29 1.661-8.304 1.723-4.55 4.113-8.201 6.3-9.945-1.993 1.8-4.692 7.63-5.5 9.788-.904 2.416-1.545 4.684-1.931 6.857.666-2.037 2.821-2.912 2.821-2.912s1.057-1.304 2.292-3.166c-.74.169-1.955.458-2.362.629-.6.251-.762.337-.762.337s1.945-1.184 3.613-1.72C21.695 7.9 24.195 2.767 21.678.521m-18.573.543A1.842 1.842 0 0 0 1.27 2.9v16.608a1.84 1.84 0 0 0 1.835 1.834h9.418a22.953 22.953 0 0 1-.052-2.707c-.006-.062-.011-.141-.016-.2a27.01 27.01 0 0 0-.473-2.378c-.121-.47-.275-.898-.369-1.057-.116-.197-.098-.31-.097-.432 0-.12.015-.245.037-.386a9.98 9.98 0 0 1 .234-1.045l.217-.028c-.017-.035-.014-.065-.031-.097l-.041-.381a32.8 32.8 0 0 1 .382-1.194l.2-.019c-.008-.016-.01-.038-.018-.053l-.043-.316c.63-3.28 2.587-7.443 4.8-9.791.066-.069.133-.128.198-.194Z"/></svg>`;

/**
 * Official MongoDB mark from thesvg.org (120 × 257), used unchanged.
 *
 * The green leaf sits on the dark enamel plate shared by the tooltip and the
 * printed database badge. Source: https://thesvg.org/icon/mongodb
 */
export const MONGO_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 257"><path fill="#00ED64" d="M82.323 28.55C71.537 15.795 62.249 2.84 60.35.15c-.2-.2-.5-.2-.7 0-1.897 2.69-11.185 15.645-21.971 28.4C-54.902 146.238 52.26 225.661 52.26 225.661l.9.597c.798 12.258 2.795 29.896 2.795 29.896h7.99s1.998-17.539 2.797-29.896l.899-.697c.1 0 107.263-79.323 14.68-197.01ZM59.95 223.867s-4.793-4.086-6.092-6.179v-.199l5.793-128.151c0-.4.6-.4.6 0l5.792 128.151v.199c-1.299 2.093-6.093 6.179-6.093 6.179Z"/></svg>`;

/** Providers with a registered presentation theme. */
export const PROVIDERS: readonly ProviderTheme[] = [
  {
    id: "rabbitmq",
    label: "RabbitMQ",
    color: "#ff6600",
    types: ["message-queue"],
    logo: MEDIA_MARKS.rabbitmq,
  },
  {
    id: "amazon-sqs",
    label: "Amazon SQS",
    color: "#d9a1e8",
    types: ["message-queue"],
    logo: MEDIA_MARKS["amazon-sqs"],
  },
  {
    id: "nats-jetstream",
    label: "NATS JetStream",
    color: "#27aae1",
    types: ["message-queue"],
    logo: MEDIA_MARKS["nats-jetstream"],
  },
  {
    id: "amazon-s3",
    label: "Amazon S3",
    color: "#76b85a",
    types: ["object-storage"],
    logo: MEDIA_MARKS["amazon-s3"],
  },
  {
    id: "cloudflare-r2",
    label: "Cloudflare R2",
    color: "#f38020",
    types: ["object-storage"],
    logo: MEDIA_MARKS["cloudflare-r2"],
  },
  {
    id: "ffmpeg",
    label: "FFmpeg",
    color: "#66bf67",
    types: ["media-worker"],
    logo: MEDIA_MARKS.ffmpeg,
  },
  {
    id: "redis",
    label: "Redis",
    color: "#dc382d",
    types: ["cache"],
    footprints: {
      cache: { halfWidth: 84, halfDepth: 84 },
    },
    logo: REDIS_LOGO,
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    color: "#4169e1",
    types: ["database-rack"],
    logo: POSTGRES_LOGO,
    plate: "#14243a",
  },
  {
    id: "mysql",
    label: "MySQL",
    color: "#00758f",
    types: ["database-rack"],
    logo: MYSQL_LOGO,
    plate: "#0b1a1e",
  },
  {
    id: "sqlite",
    label: "SQLite",
    color: "#0f80cc",
    types: ["database-rack"],
    logo: SQLITE_LOGO,
    plate: "#101c24",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    color: "#00ed64",
    types: ["database-rack"],
    logo: MONGO_LOGO,
    plate: "#0b1a12",
  },
  {
    id: "cloudflare",
    label: "Cloudflare CDN",
    color: "#f38020",
    types: ["cdn"],
    logo: CDN_MARKS.cloudflare,
    plate: "#241910",
  },
  {
    id: "cloudfront",
    label: "Amazon CloudFront",
    color: "#a879e0",
    types: ["cdn"],
    logo: CDN_MARKS.cloudfront,
    plate: "#21162e",
  },
  {
    id: "google-cloud-cdn",
    label: "Google Cloud CDN",
    color: "#4285f4",
    types: ["cdn"],
    logo: CDN_MARKS["google-cloud-cdn"],
    plate: "#142033",
  },
  {
    id: "azure-front-door",
    label: "Azure Front Door",
    color: "#0078d4",
    types: ["cdn"],
    logo: CDN_MARKS["azure-front-door"],
    plate: "#101e2c",
  },
  {
    id: "fastly",
    label: "Fastly",
    color: "#ff282d",
    types: ["cdn"],
    logo: CDN_MARKS.fastly,
    plate: "#291519",
  },
  {
    id: "akamai",
    label: "Akamai",
    color: "#0096d6",
    types: ["cdn"],
    logo: CDN_MARKS.akamai,
    plate: "#10232e",
  },
  {
    id: "bunny",
    label: "bunny.net",
    color: "#ffaa49",
    types: ["cdn"],
    logo: CDN_MARKS.bunny,
    plate: "#281f14",
  },
  {
    id: "cdn77",
    label: "CDN77",
    color: "#ffe115",
    types: ["cdn"],
    logo: CDN_MARKS.cdn77,
    // The official dark wordmark needs its yellow enamel, not a dark plate.
    plate: "#ffe115",
  },
  {
    id: "keycdn",
    label: "KeyCDN",
    color: "#047aed",
    types: ["cdn"],
    logo: CDN_MARKS.keycdn,
    plate: "#131e31",
  },
  {
    id: "alibaba-cloud-cdn",
    label: "Alibaba Cloud CDN",
    color: "#ff6a00",
    types: ["cdn"],
    logo: CDN_MARKS["alibaba-cloud-cdn"],
    plate: "#281a12",
  },
];

/**
 * Resolve a document provider string to its theme.
 *
 * @param name - Optional provider field from a validated instance.
 * @param type - Optional renderer type; when supplied, a theme that does not
 *   support that type is rejected as if unknown.
 * @returns The matching theme, or null for a missing, unknown, or
 *   type-incompatible provider.
 */
export function findProvider(
  name: string | undefined,
  type?: PlacedInstance["type"],
): ProviderTheme | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return (
    PROVIDERS.find(
      (provider) =>
        provider.id === normalized &&
        (type === undefined || provider.types.includes(type)),
    ) ?? null
  );
}

/**
 * Providers that may skin a renderer type.
 *
 * @param type - Renderer type selected by the layout pass.
 * @returns Registered providers supporting that type; empty when none apply.
 */
export function providersFor(
  type: PlacedInstance["type"],
): readonly ProviderTheme[] {
  return PROVIDERS.filter((provider) => provider.types.includes(type));
}
