import { describe, expect, test } from "vite-plus/test";
import {
  componentEnvelope,
  componentHeight,
  createComponent,
} from "../src/components";
import type { PlacedInstance } from "../src/design";
import { providersFor } from "../src/providers";

const types: PlacedInstance["type"][] = [
  "database-rack",
  "compute-server",
  "webpage",
  "cache",
  "cdn",
  "message-queue",
  "object-storage",
  "media-worker",
  "branch",
  "merge",
];

/** Placed artwork input independent of the layout algorithm under test elsewhere. */
function instance(
  type: PlacedInstance["type"],
  label: string,
  provider?: string,
): PlacedInstance {
  return {
    id: "artwork",
    label,
    type,
    position: { x: 120, y: 80, z: 6 },
    color: "#4169e1",
    ...(provider === undefined ? {} : { provider }),
  };
}

describe("component provider boundaries", () => {
  test("ignores unknown and unsupported providers in artwork, fitting and assembly", () => {
    for (const type of types) {
      const unsupported = type === "cache" ? "postgresql" : "redis";
      for (const provider of ["unknown-product", unsupported]) {
        const node = createComponent(
          instance(type, "Unchanged service", provider),
        );
        expect(node.querySelector(".provider-skin")).toBeNull();
        expect(node.getAttribute("aria-label")).not.toContain(provider);
        expect(componentHeight(type, provider)).toBe(componentHeight(type));
        expect(componentEnvelope(type, provider)).toEqual(
          componentEnvelope(type),
        );
      }
    }
  });

  test("preserves full labels as text, including oversized untrusted names", () => {
    for (const type of types) {
      const provider =
        type === "cache"
          ? "redis"
          : type === "database-rack"
            ? "postgresql"
            : type === "cdn"
              ? "cloudflare"
              : undefined;
      for (const skin of provider ? [undefined, provider] : [undefined]) {
        for (const name of [
          "API",
          '<svg onload="alert(1)">' + "Very long service name ".repeat(6),
        ]) {
          const node = createComponent(instance(type, name, skin));
          const label = node.querySelector(".instance-label")!;
          expect(label.textContent).toBe(name);
          expect(label.children).toHaveLength(0);
          expect(node.getAttribute("aria-label")).toContain(name);
          if (name.length > 100) {
            expect(label.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
          }
        }
      }
    }
  });

  test("bounds supported cabinets without losing rooftop geometry from fitting", () => {
    for (const [type, providers] of [
      [
        "database-rack",
        [undefined, "postgresql", "mysql", "sqlite", "mongodb"],
      ],
      ["cache", [undefined, "redis"]],
      ["cdn", [undefined, ...providersFor("cdn").map(({ id }) => id)]],
      [
        "message-queue",
        [undefined, ...providersFor("message-queue").map(({ id }) => id)],
      ],
      [
        "object-storage",
        [undefined, ...providersFor("object-storage").map(({ id }) => id)],
      ],
      ["media-worker", [undefined, "ffmpeg"]],
      ["branch", [undefined]],
      ["merge", [undefined]],
    ] as const) {
      for (const provider of providers) {
        const envelope = componentEnvelope(type, provider)!;
        expect(envelope.width).toBeGreaterThan(0);
        expect(envelope.depth).toBeGreaterThan(0);
        expect(envelope.z + envelope.height).toBeLessThanOrEqual(
          componentHeight(type, provider),
        );
        const node = createComponent(instance(type, "Named cabinet", provider));
        expect(node.querySelectorAll(".instance-label")).toHaveLength(1);
        if (provider)
          expect(
            node
              .querySelector("[data-renderer-provider]")
              ?.getAttribute("data-renderer-provider"),
          ).toBe(provider);
      }
    }
    expect(componentHeight("cache", "redis")).toBeGreaterThan(
      componentHeight("cache"),
    );
    expect(componentEnvelope("compute-server")).toBeNull();
    expect(componentEnvelope("webpage")).toBeNull();
  });

  test("normalizes CDN provider input without leaking its artwork into other renderers", () => {
    for (const { id } of providersFor("cdn")) {
      const cdn = createComponent(
        instance("cdn", "Edge content", ` ${id.toUpperCase()} `),
      );
      expect(
        cdn
          .querySelector("[data-renderer-provider]")
          ?.getAttribute("data-renderer-provider"),
      ).toBe(id);
      expect(cdn.querySelectorAll(".cdn-provider-badge svg")).toHaveLength(1);
      expect(cdn.querySelectorAll(".brand-plate")).toHaveLength(1);
      for (const type of types.filter((type) => type !== "cdn")) {
        const unsupported = createComponent(
          instance(type, "Unchanged service", id),
        );
        expect(unsupported.querySelector(".provider-skin")).toBeNull();
        expect(unsupported.querySelector(".cdn-provider-badge")).toBeNull();
        expect(componentHeight(type, id)).toBe(componentHeight(type));
        expect(componentEnvelope(type, id)).toEqual(componentEnvelope(type));
      }
    }
  });
});
