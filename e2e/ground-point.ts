import type { Page } from "@playwright/test";

/** Find actual empty SVG ground rather than clicking fixed pixels that may belong to a HUD. */
export async function groundPoint(
  page: Page,
): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    for (let y = 40; y < innerHeight - 100; y += 24)
      for (let x = 12; x < innerWidth - 12; x += 24)
        if (document.elementFromPoint(x, y)?.matches("#scene, .space-grid"))
          return { x, y };
    throw new Error("No unobstructed world ground is visible.");
  });
}
