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
    const rack = new DatabaseRack(example.nodes[0]);
    expect(rack.element.classList.contains("database-rack")).toBe(true);
    expect(rack.element.dataset.nodeId).toBe("database-01");
    expect(rack.element.style.getPropertyValue("--cable-color")).toBe(
      "#ff9d52",
    );
    expect(rack.element.querySelectorAll("use")).toHaveLength(2);
    expect(rack.element.querySelectorAll(".cable")).toHaveLength(7);
    expect(rack.element.querySelectorAll(".pulse")).toHaveLength(7);
    expect(rack.element.querySelector(".node-label")?.textContent).toBe(
      "Database Rack 01",
    );
    expect(rack.element.querySelector("title")?.textContent).toBe(
      "Database Rack 01 (database-01) · Database Rack",
    );
  });

  test("fits long labels inside the nameplate", () => {
    const rack = new DatabaseRack({
      ...example.nodes[0],
      label: "Extremely long imported database rack name",
    });
    const label = rack.element.querySelector(".node-label");
    expect(label?.getAttribute("textLength")).toBe("74");
    expect(label?.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
    expect(label?.getAttribute("clip-path")).toBe("url(#rack-name-clip)");
  });
});
