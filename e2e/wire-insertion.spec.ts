import { expect, test, type Page } from "@playwright/test";

/** Target a real cable point; source order does not imply a clickable bounding-box center. */
async function wirePoint(page: Page, index: number, lane = ".wire") {
  return page
    .locator(`.connection[data-connection-index="${index}"] ${lane}`)
    .evaluate((element) => {
      const path = element as SVGPathElement,
        point = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    });
}

/** Feed the same manual simulation controls as the learner, in simulated 10ms steps. */
async function advance(page: Page, ticks: number) {
  await page.locator("#traffic-step").evaluate((button, count) => {
    for (let i = 0; i < count; i++) (button as HTMLButtonElement).click();
  }, ticks);
}

test("wire context menu inserts cache in place, persists coverage, and only misses reach database", async ({
  page,
}) => {
  await page.goto("/");
  const original = JSON.parse(await page.locator("#source").inputValue());
  const camera = await page.locator("#scene").getAttribute("viewBox");
  const point = await wirePoint(page, 2, ".wire-response");
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".world-context-menu")).toBeHidden();
  await expect(page.locator(".wire-cut")).toHaveCount(0);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Cut", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Add node…", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add Cache", exact: true }).click();
  await expect(page.locator(".scene-instance")).toHaveCount(5);
  await expect(page.locator(".connection")).toHaveCount(4);
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  const inserted = JSON.parse(await page.locator("#source").inputValue());
  expect(
    inserted.instances
      .slice(0, 4)
      .map((node: { placement: unknown }) => node.placement),
  ).toEqual(
    original.instances.map((node: { placement: unknown }) => node.placement),
  );
  expect(inserted.connections[2]).toMatchObject({
    from: "compute-api",
    to: "cache-1",
  });
  expect(inserted.connections[3]).toMatchObject({
    from: "cache-1",
    to: "db-app",
  });
  const cache = page.locator('.scene-instance[data-instance-id="cache-1"]');
  const cachePoint = await cache.evaluate((node) => {
    const box = node.getBoundingClientRect();
    for (let y = box.bottom - 6; y > box.top; y -= 4)
      for (let x = box.left + 6; x < box.right; x += 4)
        if (
          document.elementFromPoint(x, y)?.closest(".scene-instance") === node
        )
          return { x, y };
    throw new Error("Inserted cache has no visible hit target.");
  });
  await page.mouse.click(cachePoint.x, cachePoint.y, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Inspect node", exact: true })
    .click();
  await expect(page.locator("#cache-hit-percent")).toHaveValue("90");
  await page.locator("#cache-hit-percent").fill("100");
  await page
    .getByRole("button", { name: "Set cache coverage", exact: true })
    .click();
  await expect(page.locator("#cache-settings-message")).toContainText(
    "100% hits",
  );
  const saved = JSON.parse(await page.locator("#source").inputValue());
  expect(
    saved.instances.find((node: { id: string }) => node.id === "cache-1")
      .cacheHitPercent,
  ).toBe(100);
  await advance(page, 250);
  await expect(
    page.locator('.connection[data-connection-index="3"]'),
  ).toHaveAttribute("data-rate-rps", "0");
  await expect(page.locator("#traffic-summary")).toContainText("1 delivered");
  await page.locator("#cache-hit-percent").fill("0");
  await page
    .getByRole("button", { name: "Set cache coverage", exact: true })
    .click();
  await advance(page, 170);
  await expect(
    page.locator('.connection[data-connection-index="3"]'),
  ).toHaveAttribute("data-rate-rps", "1");
  await expect(page.locator("#traffic-summary")).toContainText("0 delivered");
  await advance(page, 20);
  await expect(page.locator("#traffic-summary")).toContainText("1 delivered");
  await page.locator("#cache-hit-percent").fill("90");
  await page
    .getByRole("button", { name: "Set cache coverage", exact: true })
    .click();
  await advance(page, 1050);
  await expect(
    page.locator('.connection[data-connection-index="3"]'),
  ).toHaveAttribute("data-rate-rps", "1");
  await expect(page.locator("#cache-hit-percent")).toHaveValue("90");
});

test("wire keyboard menu cancels safely and Cut removes only the targeted connection", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.locator("#source").inputValue();
  const camera = await page.locator("#scene").getAttribute("viewBox");
  const wire = page.locator('.connection[data-connection-index="1"]');
  await wire.evaluate((node) => (node as SVGGElement).focus());
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Add node…", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".world-context-menu")).toBeHidden();
  expect(await page.locator("#source").inputValue()).toBe(before);
  await wire.evaluate((node) => (node as SVGGElement).focus());
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
  await expect(page.locator(".connection")).toHaveCount(2);
  await expect(page.locator(".scene-instance")).toHaveCount(4);
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  const document = JSON.parse(await page.locator("#source").inputValue());
  expect(
    document.connections.some(
      (edge: { from: string; to: string }) =>
        edge.from === "web-frontend" && edge.to === "compute-api",
    ),
  ).toBe(false);
});
