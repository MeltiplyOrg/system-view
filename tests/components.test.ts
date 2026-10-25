import { describe, expect, test } from "vite-plus/test";
import {
  componentEnvelope,
  componentHeight,
  createComponent,
} from "../src/components";
import type { PlacedInstance } from "../src/design";

const types: PlacedInstance["type"][] = [
  "database-rack",
  "compute-server",
  "webpage",
  "cache",
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
          expect(node.getAttribute("aria-label")).toContain(
            provider === "postgresql"
              ? "PostgreSQL"
              : provider === "redis"
                ? "Redis"
                : provider === "mysql"
                  ? "MySQL"
                  : provider === "sqlite"
                    ? "SQLite"
                    : "MongoDB",
          );
      }
    }
    expect(componentHeight("cache", "redis")).toBeGreaterThan(
      componentHeight("cache"),
    );
    expect(componentEnvelope("compute-server")).toBeNull();
    expect(componentEnvelope("webpage")).toBeNull();
  });
});
