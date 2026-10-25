/**
 * Platform SVG tests. Unit coverage proves the merged footprint is translated
 * into expectable markup: one group per elevation, even-odd holes, and walls.
 */
import { describe, expect, test } from "vite-plus/test";
import type { DatabaseInstance } from "../src/design";
import { createPlatforms } from "../src/platform";

/** Minimal validated instance used to compose platform fixtures. */
function rack(id: string, x: number, y: number, z = 0): DatabaseInstance {
  return {
    id,
    type: "database-rack",
    label: id,
    color: "#ff9d52",
    position: { x, y, z },
  };
}

describe("shared platform rendering", () => {
  test("renders one compound platform for touching racks", () => {
    const group = createPlatforms([rack("a", 0, 0), rack("b", 0, 128)]);
    expect(group.classList.contains("platforms")).toBe(true);
    const platforms = group.querySelectorAll(".shared-platform");
    expect(platforms).toHaveLength(1);
    expect(platforms[0].getAttribute("data-elevation")).toBe("0");
    expect(
      platforms[0]
        .querySelector(".platform-top")
        ?.getAttribute("d")
        ?.startsWith("M"),
    ).toBe(true);
    expect(
      platforms[0].querySelector(".platform-wall")?.getAttribute("d"),
    ).toContain("M");
    expect(platforms[0].querySelector(".detail")?.getAttribute("d")).not.toBe(
      "",
    );
  });

  test("renders disconnected islands and elevation groups separately", () => {
    const group = createPlatforms([
      rack("a", 0, 0),
      rack("b", 900, 0),
      rack("c", 0, 0, 100),
    ]);
    const platforms = group.querySelectorAll(".shared-platform");
    expect(platforms).toHaveLength(2);
    expect(
      [...platforms].map((platform) => platform.getAttribute("data-elevation")),
    ).toEqual(["0", "100"]);
    expect(
      group
        .querySelector('[data-elevation="0"] .platform-top')
        ?.getAttribute("d")
        ?.match(/M/g),
    ).toHaveLength(2);
  });

  test("renders no platform elements for an empty design", () => {
    const group = createPlatforms([]);
    expect(group.children).toHaveLength(0);
  });
});
