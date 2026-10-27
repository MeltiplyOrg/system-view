import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Design, GroundPoint } from "../src/design";
import { groundPoint } from "./ground-point";

test.use({ viewport: { width: 1440, height: 1000 } });

/** Start through the visible confirmation flow, never by mutating application globals. */
async function emptyWorld(page: Page): Promise<void> {
  await page.goto("/");
  const point = await groundPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "New world…" }).click();
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await expect(page.locator(".scene-instance")).toHaveCount(0);
}

/** The JSON editor is the same portable document exposed by import/export. */
async function documentOf(page: Page): Promise<Design> {
  return JSON.parse(await page.locator("#source").inputValue()) as Design;
}

/** Hold a real pointer over the ground so a caller can inspect then release the preview. */
async function dragPreview(
  page: Page,
  item: string,
  point: { x: number; y: number },
): Promise<void> {
  const card = page.locator(`[data-build-item="${item}"]`);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error("Catalogue card has no bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await expect(page.locator(".build-placement")).toBeVisible();
}

/** Find painted SVG pixels rather than assuming every model fills its rectangular bounds. */
async function hitPoint(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  return page
    .locator(`.scene-instance[data-instance-id="${id}"]`)
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      for (let y = box.top + 6; y < box.bottom; y += 6)
        for (let x = box.left + 6; x < box.right; x += 6)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error("Machine has no visible hit target.");
    });
}

/** Wiring starts from the clicked node's context menu, outside the component shelf. */
async function wireFrom(page: Page, id: string): Promise<void> {
  const point = await hitPoint(page, id);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Wire from this node…" }).click();
  await expect(page.locator("#build-body")).toBeHidden();
  await expect(page.locator(".world-edit-panel")).toBeVisible();
}

/** Project a saved ground site through the public SVG camera, independently of the builder. */
async function groundClient(
  page: Page,
  point: GroundPoint,
): Promise<{ x: number; y: number }> {
  return page.locator("#scene").evaluate((element, site) => {
    const svg = element as SVGSVGElement,
      view = svg.viewBox.baseVal,
      box = svg.getBoundingClientRect();
    const x = ((site.x - site.y) * Math.sqrt(3)) / 2,
      y = (site.x + site.y) / 2;
    return {
      x: box.left + ((x - view.x) / view.width) * box.width,
      y: box.top + ((y - view.y) / view.height) * box.height,
    };
  }, point);
}

test("builds and wires products, then retains moved sites through real export and import", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await emptyWorld(page);
  const camera = await page.locator("#scene").getAttribute("viewBox");
  await dragPreview(page, "compute", { x: 440, y: 320 });
  await expect(page.locator(".build-placement")).not.toHaveClass(
    /placement-invalid/,
  );
  await page.mouse.up();
  const first = (await documentOf(page)).instances[0].placement!;
  expect(Number.isInteger(first.x / 40)).toBe(true);
  expect(Number.isInteger(first.y / 40)).toBe(true);
  await page.locator('[data-category="database-rack"]').click();
  await dragPreview(page, "database-postgresql", { x: 940, y: 420 });
  await page.mouse.up();
  await expect(page.locator(".scene-instance")).toHaveCount(2);
  const built = await documentOf(page);
  expect(built.instances[0].placement).toEqual(first);
  expect(built.instances[1].provider).toBe("postgresql");
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  await wireFrom(page, "compute-1");
  await page.locator("#build-relation").fill("SQL");
  const from = await hitPoint(page, "compute-1"),
    to = await hitPoint(page, "db-1");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.locator(".build-wire-preview")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".connection")).toHaveCount(1);
  await expect(page.locator(".wire-label")).toHaveText("SQL");
  expect((await documentOf(page)).connections[0]).toMatchObject({
    from: "compute-1",
    to: "db-1",
    relation: "SQL",
  });
  await expect(
    page.locator(".build-placement,.build-wire-preview"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close action editor" }).click();
  await expect(page.locator("#build-body")).toBeHidden();
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  const machine = await hitPoint(page, "compute-1");
  await page.mouse.move(machine.x, machine.y);
  const anchor = page.locator(".drag-anchor");
  await expect(anchor).toBeVisible();
  const box = await anchor.boundingBox();
  if (!box) throw new Error("Move handle has no bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 + 35,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = await documentOf(page);
  expect(moved.instances[0].placement).not.toEqual(first);
  const frame = await page
    .locator('.scene-frame[data-cluster-id="instance:compute-1"]')
    .getAttribute("d");
  const wire = await page.locator(".connection .wire").getAttribute("d");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error("Export did not produce a local file.");
  const exported = JSON.parse(readFileSync(path, "utf8")) as Design;
  expect(exported).toEqual(moved);
  await page.locator("#source").fill(JSON.stringify(exported));
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await expect(
    page.locator('.scene-frame[data-cluster-id="instance:compute-1"]'),
  ).toHaveAttribute("d", frame!);
  await expect(page.locator(".connection .wire")).toHaveAttribute("d", wire!);
  expect(errors).toEqual([]);
});

test("rejects occupied and cancelled drops and removes incident wires without moving survivors", async ({
  page,
}) => {
  await emptyWorld(page);
  await dragPreview(page, "compute", { x: 440, y: 320 });
  await page.mouse.up();
  const original = await documentOf(page);
  const occupied = await groundClient(page, original.instances[0].placement!);
  await dragPreview(page, "web", occupied);
  await expect(page.locator(".build-placement")).toHaveClass(
    /placement-invalid/,
  );
  await page.mouse.up();
  await expect(page.locator("#build-status")).toContainText("occupied");
  expect(await documentOf(page)).toEqual(original);
  await page.keyboard.press("Escape");
  await expect(page.locator(".build-placement")).toHaveCount(0);
  await dragPreview(page, "web", { x: 940, y: 320 });
  const toolbar = await page.locator(".build-toolbar").boundingBox();
  if (!toolbar) throw new Error("Build toolbar has no bounds.");
  await page.mouse.move(toolbar.x + 25, toolbar.y + 20, { steps: 5 });
  await page.mouse.up();
  expect(await documentOf(page)).toEqual(original);
  await expect(page.locator(".build-placement")).toHaveCount(0);
  await dragPreview(page, "web", { x: 940, y: 320 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await documentOf(page)).toEqual(original);
  await dragPreview(page, "web", { x: 940, y: 320 });
  await page.mouse.up();
  await wireFrom(page, "web-1");
  const target = await hitPoint(page, "compute-1");
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".connection")).toHaveCount(1);
  // Both the native form and pointer tool reject an already-connected output.
  const connected = await documentOf(page);
  await page.selectOption("#build-from", "web-1");
  await expect(
    page.locator('#build-to option[value="compute-1"]'),
  ).toHaveJSProperty("disabled", true);
  await expect(page.locator("#build-connect")).toBeDisabled();
  const duplicate = await hitPoint(page, "compute-1");
  await page.mouse.click(duplicate.x, duplicate.y);
  expect(await documentOf(page)).toEqual(connected);
  const remove = await hitPoint(page, "web-1");
  await page.mouse.click(remove.x, remove.y, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete node", exact: true })
    .click();
  await expect(page.locator(".scene-instance")).toHaveCount(1);
  await expect(page.locator(".connection")).toHaveCount(0);
  expect((await documentOf(page)).instances[0].placement).toEqual(
    original.instances[0].placement,
  );
});

test("supports pointer-free placement and native endpoint wiring", async ({
  page,
}) => {
  await emptyWorld(page);
  await page
    .getByRole("button", { name: "Build Web frontend", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".build-placement")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.locator(".scene-instance")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Build Compute server", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  for (let step = 0; step < 12; step++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator(".scene-instance")).toHaveCount(2);
  await page.locator("#scene").focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Connect nodes…" }).focus();
  await page.keyboard.press("Enter");
  await page.selectOption("#build-from", "web-1");
  await page.selectOption("#build-to", "compute-1");
  await page.locator("#build-relation").fill("HTTPS / JSON");
  await page.locator("#build-relation").press("Enter");
  await expect(page.locator(".wire-label")).toHaveText("HTTPS / JSON");
  expect((await documentOf(page)).connections[0]).toMatchObject({
    from: "web-1",
    to: "compute-1",
    relation: "HTTPS / JSON",
  });
});

test.describe("touch construction", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("tap-to-place and endpoint controls work without horizontal overflow", async ({
    page,
  }) => {
    await emptyWorld(page);
    await page.locator('[data-category="cache"]').tap();
    await page
      .getByRole("button", { name: "Build Redis", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Build Redis", exact: true }).tap();
    await page.touchscreen.tap(130, 220);
    await expect(
      page.locator('.scene-instance [data-renderer-provider="redis"]'),
    ).toHaveCount(1);
    await page.locator('[data-category="cdn"]').tap();
    await page
      .getByRole("button", { name: "Build Cloudflare CDN", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Build Cloudflare CDN", exact: true })
      .tap();
    await page.touchscreen.tap(300, 350);
    await expect(
      page.locator('.scene-instance [data-renderer-provider="cloudflare"]'),
    ).toHaveCount(1);
    await wireFrom(page, "cdn-1");
    await page.selectOption("#build-to", "cache-1");
    await page.locator("#build-connect").tap();
    await expect(page.locator(".connection")).toHaveCount(1);
    expect((await documentOf(page)).connections[0]).toMatchObject({
      from: "cdn-1",
      to: "cache-1",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth === innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Close action editor" }).tap();
    await expect(page.locator("#build-body")).toBeHidden();
    await expect(page.locator("#build-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
