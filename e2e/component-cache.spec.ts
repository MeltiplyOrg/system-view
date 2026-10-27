import { expect, test } from "@playwright/test";
import type { Design } from "../src/design";

/** Mixed designs must share static pixels by visual type, never by label or ID. */
test("all node types share cached geometry across designs while keeping live identity", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const prefixes = ["db", "compute", "web", "cache", "cdn"];
  const makeDesign = (generation: number): Design => {
    const groups = prefixes.map((prefix) =>
      Array.from({ length: 3 }, (_, index) => ({
        id: `${prefix}-${generation}-${index}`,
        label: `${prefix} generation ${generation} instance ${index}`,
        description: `Description for ${prefix} ${generation} ${index}`,
      })),
    );
    return {
      version: 1,
      name: `Mixed generation ${generation}`,
      instances: groups.flat(),
      clusters: groups
        .filter(
          (_, index) => prefixes[index] !== "web" && prefixes[index] !== "cdn",
        )
        .map((instances, index) => ({
          id: `group-${index}`,
          instances: instances.map(({ id }) => id),
        })),
      connections: [
        ["web", "compute"],
        ["compute", "cache"],
        ["cache", "db"],
        ["web", "cdn"],
      ].map(([from, to]) => ({
        from: `${from}-${generation}-0`,
        to: `${to}-${generation}-0`,
        relation: "request",
      })),
    };
  };
  const first = makeDesign(1);
  await page.locator("#source").fill(JSON.stringify(first));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.locator('[data-renderer-type][data-raster-ready="true"]'),
  ).toHaveCount(15);
  const images = await page
    .locator("[data-renderer-type]")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        type: node.getAttribute("data-renderer-type"),
        urls: [...node.querySelectorAll(".component-raster")].map((image) =>
          image.getAttribute("href"),
        ),
      })),
    );
  const byType = new Map<string | null, string[]>();
  for (const image of images) {
    const expectedLayers = image.type === "database-rack" ? 2 : 1;
    expect(image.urls).toHaveLength(expectedLayers);
    if (byType.has(image.type))
      expect(image.urls).toEqual(byType.get(image.type));
    else byType.set(image.type, image.urls as string[]);
  }
  expect(new Set([...byType.values()].flat()).size).toBe(6);
  const firstUrls = [...byType.values()].flat();
  const second = makeDesign(2);
  await page.locator("#source").fill(JSON.stringify(second));
  const reused = await page.locator("#apply").evaluate((button, urls) => {
    (button as HTMLButtonElement).click();
    return {
      ready: document.querySelectorAll(
        '[data-renderer-type][data-raster-ready="true"]',
      ).length,
      reused: [...document.querySelectorAll(".component-raster")].every(
        (image) => urls.includes(image.getAttribute("href")!),
      ),
    };
  }, firstUrls);
  expect(reused).toEqual({ ready: 15, reused: true });
  const labels = await page
    .locator(".scene-instance .instance-label")
    .allTextContents();
  expect(labels.sort()).toEqual(
    second.instances.map(({ label }) => label!).sort(),
  );
  await expect(page.locator(".connection")).toHaveCount(4);
  await page.selectOption("#theme", "light");
  await expect(
    page.locator('[data-renderer-type][data-raster-ready="true"]'),
  ).toHaveCount(15);
  await expect
    .poll(() =>
      page
        .locator(".component-raster")
        .evaluateAll(
          (nodes, oldUrls) =>
            nodes.every(
              (image) => !oldUrls.includes(image.getAttribute("href")!),
            ),
          firstUrls,
        ),
    )
    .toBe(true);
  await expect(page.locator(".scene-instance .instance-label")).toHaveCount(15);
});

/** Cache failure must leave real vector nodes interactive, not blank images. */
test("non-database nodes remain visible and selectable when raster decoding fails", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLImageElement.prototype.decode = () =>
      Promise.reject(new Error("Unavailable image decoder"));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const fallback = JSON.parse(
    await page.locator("#source").inputValue(),
  ) as Design;
  fallback.instances.push({
    id: "cdn-edge",
    description: "Delivers cached content from the edge.",
  });
  fallback.instances.push({
    id: "cache-data",
    description: "A cache fixture independent of the request walkthrough.",
    placement: { x: 1300, y: 450 },
  });
  await page.locator("#source").fill(JSON.stringify(fallback));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.locator("#panel-close").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  for (const type of ["users", "compute-server", "webpage", "cache", "cdn"]) {
    const visual = page.locator(`[data-renderer-type="${type}"]`);
    await expect(visual.locator(".component-static-base")).toBeVisible();
    await expect(visual.locator(".component-raster")).toHaveCount(0);
    const point = await page.evaluate((kind) => {
      for (let y = 40; y < innerHeight - 40; y += 8)
        for (let x = 40; x < innerWidth - 40; x += 8) {
          const instance = document
            .elementFromPoint(x, y)
            ?.closest(".scene-instance");
          if (instance?.querySelector(`[data-renderer-type="${kind}"]`))
            return { x, y };
        }
      return null;
    }, type);
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(page.locator("#callout .callout-description")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("#fit").click();
    await page.locator("#panel-close").click();
    await expect(page.locator("#sidebar")).toBeHidden();
  }
});
