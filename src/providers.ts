import type { PlacedInstance } from "./design";

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
   * Omit for the shared light plate used by color marks. A white or bright
   * mark overrides this with a dark plate so it stays legible.
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
 * Official SQLite mark from thesvg.org (512 × 228), used unchanged.
 *
 * The feather and wordmark share one gradient-bearing SVG. Source:
 * https://thesvg.org/icon/sqlite
 */
export const SQLITE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 512 228"><defs><linearGradient x1="57.7%" y1="2%" x2="57.7%" y2="94.4%" id="a"><stop stop-color="#97D9F6" offset="0%"/><stop stop-color="#0F80CC" offset="92%"/><stop stop-color="#0F80CC" offset="100%"/></linearGradient></defs><path d="M194.5 112c-6.8 0-12.3 2-16.6 6.1-4.3 4-6.4 9.3-6.4 15.8a23.3 23.3 0 0 0 6.5 17c2.2 2.4 6.6 5.6 13.2 9.7 8 5 13.4 9 16 12 2.5 3.2 3.7 6.4 3.7 9.9 0 4.5-1.5 8.2-4.6 11a18 18 0 0 1-12.4 4 20.1 20.1 0 0 1-20.3-20.8h-2.5v22.9h2.5c.8-2.2 1.8-3.3 3.2-3.3.7 0 2.3.4 4.7 1.3 6 2.1 10.9 3.2 14.7 3.2a23 23 0 0 0 17-7 23.2 23.2 0 0 0 2.4-30.8c-3-4-9-8.6-18-14a59.5 59.5 0 0 1-15-11.3c-2.3-3-3.5-6.1-3.5-9.7 0-3.8 1.5-7 4.2-9.2 2.8-2.3 6.5-3.5 11-3.5 5.2 0 9.5 1.5 12.9 4.6 3.3 3 5.3 7.4 5.9 12.8h2.5V113h-2.3a6 6 0 0 1-.8 2c-.3.3-.7.4-1.4.4a17 17 0 0 1-4.3-1 38.6 38.6 0 0 0-12.3-2.3Zm82.4 0a44.6 44.6 0 0 0-39 22.2 43.5 43.5 0 0 0 4.5 50.2c7 8.2 15.3 13.3 25 15.3 2.1 1.1 5.3 4.1 9.4 9 4.7 5.3 8.6 9.3 11.9 11.6A35.6 35.6 0 0 0 311 227c5.3 0 10-.9 14-2.7l-.9-2.3a20.1 20.1 0 0 1-18.7-2.3c-3.6-2.5-8.3-7.1-13.8-14a47.6 47.6 0 0 0-5.4-6.1c10.6-2 19.3-7.2 26-15.4a42.8 42.8 0 0 0 10.2-28 42 42 0 0 0-13.2-31.4 44.8 44.8 0 0 0-32.4-12.9Zm51.4 0 .1 2.7c5.5 0 8.6 1.7 9.3 5 .3 1.1.4 3.3.4 6.4v59.6c0 4.5-.7 7.3-2 8.6-1.1 1.2-3.2 2-6.2 2.3l-.1 2.6h55.1l1.4-13.5h-2.5c-.7 3.7-2.3 6.3-5 7.8a30.5 30.5 0 0 1-14 2.3h-5.2c-6 0-9.5-2.2-10.5-6.6-.2-.9-.2-1.8-.2-2.8l.2-60.3c0-4.4.5-7.4 1.7-8.9 1.2-1.4 3.3-2.3 6.4-2.5l-.2-2.7h-28.7Zm-50.6 3.3a28 28 0 0 1 23 11.2 48 48 0 0 1 8.8 30.5c0 12.3-3 22.1-8.9 29.5a29 29 0 0 1-23.7 11c-9.5 0-17.2-3.8-23-11.4a47.1 47.1 0 0 1-8.9-29.6c0-12.5 3-22.5 9-30 5.9-7.5 13.8-11.2 23.7-11.2Zm126.9 12.8c-1.3 0-2.4.5-3.1 1.4-.8 1-1 2-.8 3.4a6 6 0 0 0 2.2 3.4c1.1 1 2.4 1.4 3.7 1.4 1.3 0 2.3-.5 3-1.4.7-1 1-2.1.7-3.4-.3-1.4-1-2.5-2-3.4a5.6 5.6 0 0 0-3.7-1.4Zm36.4 9.2c-2.3 8.8-7.3 13.5-14.9 14.3l.1 2.5h8.9l-.2 29.8c0 5.1.2 8.5.5 10.2 1 4.2 3.6 6.3 8.1 6.3 6.6 0 13.4-4 20.6-12l-2.2-1.8c-5.2 5.2-9.7 7.8-13.7 7.8-2.5 0-4-1.4-4.6-4.2l-.2-2.4v-33.7h13.7l-.2-4h-13.4v-12.8H441Zm52.4 11.2c-7.6 0-13.7 3.7-18.5 11a31.3 31.3 0 0 0-4.4 24.4 21 21 0 0 0 6.7 12.2 19 19 0 0 0 12.7 4.3c4.7 0 11.4-1.2 14.1-3.7 2.8-2.4 5.4-6.3 7.8-11.7l-2-2a20.6 20.6 0 0 1-17.1 10.5c-8 0-12.8-4.3-14.6-13l-.5-3.5a46 46 0 0 0 21.4-8c4.8-3.8 9.6-7.9 8.7-12.1a9.9 9.9 0 0 0-3.9-6c-2-1.6-7.4-2.4-10.4-2.4Zm-83 .3-16.3 3.8v2.9l5.7-.7c2.7 0 4.3 1.2 4.8 3.7.2.8.3 2 .4 3.4l-.2 26.8c0 3.7-.5 5.8-1.3 6.5-.8.6-3 1-6.6 1v2.5h25.9v-2.5c-3.7 0-6-.3-7-.9-1-.5-1.8-1.5-2.1-3-.2-1.2-.3-3.1-.4-5.7l.1-37.8h-3Zm78.9 5c1.6 0 3 .6 4.6 1.8a7 7 0 0 1 2.8 4c1.4 7-4.9 12-19 14.7a25 25 0 0 1 2.7-14.1c2.3-4.3 5.3-6.4 8.9-6.4Z" fill="#003B57"/><path d="M157.9 10H17C7.7 10 0 17.7 0 27v155.2c0 9.4 7.7 17.2 17.1 17.2h92.7c-1-46.2 14.7-135.7 48-189.5Z" fill="#0F80CC"/><path d="M152.8 15H17C10.5 15 5 20.4 5 27V171c30.7-11.8 76.8-22 108.7-21.5a989.7 989.7 0 0 1 39-134.5Z" fill="url(#a)"/><path d="M190.7 4.9c-9.6-8.6-21.3-5.2-32.8 5a81.4 81.4 0 0 0-5.1 5c-19.7 21-38 59.7-43.7 89.2a81.5 81.5 0 0 1 5.8 17.7l.8 3.5-.9-2.8a173.8 173.8 0 0 0-.8-2 172 172 0 0 0-6.4-12.1l-3.5 11c4.5 8.2 7.3 22.4 7.3 22.4l-1.4-4.1c-1-2.9-6-11.7-7.2-13.7-2 7.5-2.8 12.6-2.1 13.8 1.4 2.4 2.7 6.5 4 11a257.6 257.6 0 0 1 4.6 25c-.3 8.6-.1 17.6.5 25.7a91 91 0 0 0 4.7 24.8l1.5-.8a111 111 0 0 1-3.9-37c.9-22.5 6-49.5 15.6-77.7 16-42.5 38.4-76.6 58.8-93-18.6 17-43.8 71.4-51.4 91.6a365.7 365.7 0 0 0-18 64c6.2-19 26.4-27.2 26.4-27.2s9.8-12.2 21.4-29.6a210 210 0 0 0-22.1 6l-7.1 3s18.1-11 33.7-16C191 73.8 214.2 25.9 190.7 4.9" fill="#003B57"/></svg>`;

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
  },
  {
    id: "mongodb",
    label: "MongoDB",
    color: "#00ed64",
    types: ["database-rack"],
    logo: MONGO_LOGO,
    plate: "#0b1a12",
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
