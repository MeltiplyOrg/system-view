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
 * artwork in the renderer, and contribute a mark to the tooltip. Each theme
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
   * Self-contained SVG mark for the tooltip's top-right corner.
   *
   * Trusted constant markup; the brand fills are embedded so the card needs no
   * network request or stylesheet to render the provider logo.
   */
  logo: string;
}

/**
 * Official Redis mark from thesvg.org (256 × 220), used unchanged.
 *
 * The artwork carries its own brand fills, so the tooltip does not recolor it;
 * the span only sizes it. Source: https://thesvg.org/icon/redis
 */
const REDIS_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 256 220" aria-hidden="true" focusable="false"><path d="M246 169c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 209.4 24 179 10.3 172.5 3.6 169.3 0 166.5 0 164v-26s98-21.3 113.9-27c15.8-5.6 21.3-5.8 34.8-.9 13.4 5 94 19.5 107.3 24.3V160c0 2.5-3 5.3-10 9" fill="#912626"/><path d="M246 143.2c-13.7 7.1-84.5 36.2-99.5 44-15.1 8-23.5 7.9-35.4 2.2-11.9-5.7-87.2-36.1-100.8-42.6-13.5-6.5-13.8-11-.5-16.2 13.4-5.2 88.2-34.6 104-40.3 16-5.6 21.4-5.8 34.9-1 13.4 5 83.8 33 97.1 37.9 13.3 4.9 13.8 8.9.2 16" fill="#C6302B"/><path d="M246 127c-13.7 7.2-84.5 36.3-99.5 44.2-15.1 7.8-23.5 7.7-35.4 2-11.9-5.6-87.2-36-100.8-42.6-6.7-3.2-10.3-6-10.3-8.5V96.2s98-21.3 113.9-27c15.8-5.7 21.3-5.9 34.8-1 13.4 5 94 19.5 107.3 24.4V118c0 2.5-3 5.4-10 9" fill="#912626"/><path d="M246 101.4c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 141.8 24 111.4 10.3 105c-13.5-6.5-13.8-11-.5-16.1C23.2 83.5 98 54 113.8 48.5c16-5.7 21.4-6 34.9-1 13.4 5 83.8 33 97.1 37.8 13.3 5 13.8 9 .2 16" fill="#C6302B"/><path d="M246 83.7c-13.7 7-84.5 36.2-99.5 44-15.1 7.9-23.5 7.8-35.4 2.1C99.2 124.1 24 93.7 10.3 87.2 3.6 84 0 81.2 0 78.7v-26s98-21.3 113.9-27c15.8-5.6 21.3-5.8 34.8-.9 13.4 5 94 19.5 107.3 24.4v25.5c0 2.5-3 5.3-10 9" fill="#912626"/><path d="M246 58c-13.7 7-84.5 36.1-99.5 44-15.1 7.9-23.5 7.8-35.4 2C99.2 98.5 24 68 10.3 61.6c-13.5-6.5-13.8-11-.5-16.2C23.2 40.1 98 10.7 113.8 5c16-5.6 21.4-5.8 34.9-.9 13.4 5 83.8 33 97.1 37.8 13.3 4.9 13.8 9 .2 16" fill="#C6302B"/><path d="m159.3 32.8-22 2.2-5 11.9-8-13.2L99 31.4l19-6.9-5.8-10.5 17.8 7 16.7-5.5-4.5 10.9 17 6.4M131 90.3l-41-17 58.8-9.1-17.8 26M74 39.3c17.5 0 31.5 5.5 31.5 12.2 0 6.8-14 12.2-31.4 12.2s-31.5-5.4-31.5-12.2c0-6.7 14.1-12.2 31.5-12.2" fill="#FFF"/><path d="M185.3 36 220 49.8l-34.8 13.7V36" fill="#621B1C"/><path d="M146.8 51.2 185.3 36v27.5l-3.8 1.5-34.7-13.8" fill="#9A2928"/></svg>`;

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
