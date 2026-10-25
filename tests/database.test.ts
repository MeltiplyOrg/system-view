/**
 * Database Rack rendering tests. They exercise the shared `<defs>` contract,
 * per-instance color/label wiring, and the isometric projection without a
 * browser, using Vitest's happy-dom environment.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  createDatabaseDefinitions,
  DATABASE_ANCHOR,
  DatabaseRack,
  project,
} from "../src/database";
import { example } from "../src/design";
import { layoutDesign } from "../src/layout";

/** First placed rack from the default clustered design. */
const placed = layoutDesign(example).instances[0];

describe("Database Rack geometry", () => {
  test("projects model axes to the isometric plane", () => {
    expect(project(0, 0, 0)).toEqual([0, 0]);
    expect(project(120, 0, 0)[1] - project(0, 0, 0)[1]).toBeCloseTo(60);
    expect(project(0, 0, 60)[1]).toBe(-60);
    expect(DATABASE_ANCHOR).toHaveLength(2);
  });

  test("defines shared rear, front, and clipping geometry once", () => {
    const defs = createDatabaseDefinitions();
    expect(defs.querySelector("#rack-rear")).not.toBeNull();
    expect(defs.querySelector("#rack-front")).not.toBeNull();
    expect(defs.querySelector("#rack-name-clip")).not.toBeNull();
    expect(defs.querySelector("#rack-glass-clip")).not.toBeNull();
    expect(defs.querySelector("#rack-rear")?.children.length).toBeGreaterThan(
      10,
    );
    expect(defs.querySelector("#rack-front")?.children.length).toBeGreaterThan(
      2,
    );
  });

  test("creates a colored rack with shared layers, cables, and an identity plate", () => {
    const rack = new DatabaseRack(placed);
    expect(rack.element.classList.contains("database-rack")).toBe(true);
    expect(rack.element.dataset.rendererType).toBe("database-rack");
    expect(rack.element.dataset.instanceId).toBe("db-01");
    const base = rack.element.querySelector(".rack-static-base");
    expect(base?.classList.contains("component-static-base")).toBe(true);
    expect(base?.querySelector(".instance-label")).toBeNull();
    const overlay = rack.element.querySelector(".rack-static-roof");
    expect(overlay?.classList.contains("component-static-overlay")).toBe(true);
    expect(
      rack.element
        .querySelector(".rack-pulses")
        ?.classList.contains("component-motion"),
    ).toBe(true);
    const nameplate = rack.element.querySelector(".rack-nameplate");
    expect(nameplate?.classList.contains("component-label")).toBe(true);
    expect(rack.element.querySelectorAll("use")).toHaveLength(2);
    expect(rack.element.querySelectorAll(".cable")).toHaveLength(7);
    expect(rack.element.querySelectorAll(".pulse")).toHaveLength(7);
    expect(nameplate?.querySelector(".instance-label")?.textContent).toBe(
      "Database Rack 01",
    );
    expect(rack.element.getAttribute("aria-label")).toBe(
      "Database Rack 01 (db-01) · Database Rack",
    );
  });

  test("prints exactly one provider mark on the roof fascia", () => {
    for (const [provider, viewBox] of [
      ["postgresql", "0 0 432.071 445.383"],
      ["mysql", "0 0 256 252"],
      ["sqlite", "0 0 512 228"],
      ["mongodb", "0 0 120 257"],
    ] as const) {
      const rack = new DatabaseRack({
        ...placed,
        provider,
        color: "#4169e1",
      });
      const overlay = rack.element.querySelector(".rack-static-roof");
      const badge = overlay?.querySelector(".rack-provider-badge");
      expect(badge).not.toBeNull();
      expect(badge?.querySelectorAll("svg")).toHaveLength(1);
      expect(badge?.querySelector("svg")?.getAttribute("viewBox")).toBe(
        viewBox,
      );
      expect(
        rack.element.querySelectorAll(".rack-provider-badge"),
      ).toHaveLength(1);
    }
  });

  test("leaves the base rack and unsupported providers mark-free", () => {
    expect(
      new DatabaseRack(placed).element.querySelector(".rack-provider-badge"),
    ).toBeNull();
    expect(
      new DatabaseRack({ ...placed, provider: "redis" }).element.querySelector(
        ".rack-provider-badge",
      ),
    ).toBeNull();
  });

  test("fits long labels inside the nameplate", () => {
    const rack = new DatabaseRack({
      ...placed,
      label: "Extremely long imported database rack name",
    });
    const label = rack.element.querySelector(".instance-label");
    expect(label?.getAttribute("textLength")).toBe("74");
    expect(label?.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
    expect(label?.getAttribute("clip-path")).toBe("url(#rack-name-clip)");
  });
});
