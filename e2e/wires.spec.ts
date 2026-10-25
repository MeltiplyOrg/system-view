import { expect, test } from "@playwright/test";
import type { Design } from "../src/design";

/**
 * Three clients fan into one database. The hub is declared last, so the layout
 * places every client to its left and all three cables share the hub's left
 * frame edge. The browser test reads the drawn wire endpoints, not the layout
 * helper, so it covers the scene's port grouping as well as the geometry.
 */
const fanIn: Design = {
  version: 1,
  name: "Shared-side fan-in",
  instances: [
    { id: "compute-a", label: "Client A" },
    { id: "compute-b", label: "Client B" },
    { id: "compute-c", label: "Client C" },
    { id: "db-hub", label: "Hub" },
  ],
  connections: [
    { from: "compute-a", to: "db-hub" },
    { from: "compute-b", to: "db-hub" },
    { from: "compute-c", to: "db-hub" },
  ],
  clusters: [],
};

test("spreads same-side cables across the target border", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.locator("#source").fill(JSON.stringify(fanIn));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".connection")).toHaveCount(3);

  const result = await page.evaluate(() => {
    const frame = document.querySelector(
      '.scene-frame[data-cluster-id="instance:db-hub"]',
    )!;
    const values = (
      frame.getAttribute("d")?.match(/-?\d+(?:\.\d+)?/g) ?? []
    ).map(Number);
    // Border corners: left-top, right-top, right-bottom, left-bottom.
    const corners = [0, 2, 4, 6].map((index) => ({
      x: values[index],
      y: values[index + 1],
    }));
    const start = corners[0],
      end = corners[3],
      dx = end.x - start.x,
      dy = end.y - start.y,
      lengthSquared = dx * dx + dy * dy;
    const wires = [...document.querySelectorAll(".connection")]
      .filter((group) =>
        group.getAttribute("data-connection-id")?.endsWith("->db-hub"),
      )
      .map((group) => {
        const path = group.querySelector<SVGPathElement>(".wire")!;
        const point = path.getPointAtLength(path.getTotalLength());
        // Wires paint 4 units above the frame plane.
        const x = point.x,
          y = point.y + 4;
        return {
          slot: ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared,
        };
      })
      .sort((a, b) => a.slot - b.slot);
    return { wires };
  });

  expect(result.wires).toHaveLength(3);
  // Three equal segments: their midpoints are at 1/6, 1/2, and 5/6 of the
  // side. Sorting by slot also proves the fan is centered, not packed at one
  // end.
  const slots = result.wires.map(({ slot }) => slot);
  for (const [index, expected] of [1 / 6, 1 / 2, 5 / 6].entries())
    expect(slots[index]).toBeCloseTo(expected, 2);
});
