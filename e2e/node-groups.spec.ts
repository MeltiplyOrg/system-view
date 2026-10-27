import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Design } from "../src/design";

test.use({ viewport: { width: 1440, height: 1000 } });

/** Build a compact mixed workflow through the portable JSON interface. */
async function world(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").fill(
    JSON.stringify({
      version: 1,
      name: "Grouped application",
      instances: [
        { id: "web-client", placement: { x: -400, y: 0 } },
        { id: "branch-route", placement: { x: -160, y: 0 } },
        { id: "compute-api", placement: { x: 160, y: 0 } },
        { id: "db-data", placement: { x: 560, y: 0 } },
      ],
      connections: [
        { from: "web-client", to: "branch-route" },
        { from: "branch-route", to: "compute-api", outlet: "true" },
        { from: "compute-api", to: "db-data" },
      ],
    }),
  );
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await expect(
    page.locator('.scene-instance [data-raster-ready="true"]'),
  ).toHaveCount(4);
}

/** Export source is the applied document, never a testing-only application global. */
async function documentOf(page: Page): Promise<Design> {
  return JSON.parse(await page.locator("#source").inputValue()) as Design;
}

/** Hit actual painted pixels, not transparent corners in projected model bounds. */
async function hit(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page
    .locator(`.scene-instance[data-instance-id="${id}"]`)
    .evaluate((node) => {
      const b = node.getBoundingClientRect();
      for (let y = b.top + 3; y < b.bottom; y += 4)
        for (let x = b.left + 3; x < b.right; x += 4)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error(
        `No visible node: ${node.getAttribute("data-instance-id")}`,
      );
    });
}

/** Group editing is contextual; the component shelf is never repurposed for management. */
async function manageGroups(page: Page): Promise<void> {
  await page.mouse.click(20, 80, { button: "right" });
  await page.getByRole("menuitem", { name: "Select nodes to group…" }).click();
  await expect(page.locator("#build-body")).toBeHidden();
  await expect(page.locator(".world-edit-panel")).toBeVisible();
}

/** Title headers are the intentional move target; the backdrop does not swallow ordinary node edits. */
async function dragGroup(page: Page, cancel = false): Promise<void> {
  const start = await page
    .locator(".node-group-header-hit")
    .evaluate((plate) => {
      const rect = plate as SVGRectElement;
      const point = new DOMPoint(
        50,
        rect.height.baseVal.value / 2,
      ).matrixTransform(rect.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 50, { steps: 10 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("mixed groups preserve wires, move rigidly, cancel safely, rename and round-trip export/import", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await world(page);
  const before = await documentOf(page);
  const camera = await page.locator("#scene").getAttribute("viewBox");
  const wire = await page
    .locator('.connection[data-connection-id="compute-api->db-data"] .wire')
    .getAttribute("d");
  await manageGroups(page);
  for (const id of ["web-client", "branch-route", "compute-api"])
    await page.locator(`#group-members input[value="${id}"]`).check();
  await page.locator("#group-name").fill("Application");
  await page.locator("#group-save").click();
  const grouped = await documentOf(page);
  expect(grouped.groups).toEqual([
    {
      id: "group-1",
      label: "Application",
      instances: ["web-client", "branch-route", "compute-api"],
    },
  ]);
  expect(grouped.connections).toEqual(before.connections);
  expect(grouped.clusters).toEqual([]);
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  await expect(
    page.locator(
      '.connection[data-connection-id="compute-api->db-data"] .wire',
    ),
  ).toHaveAttribute("d", wire!);
  // Both the boundary and its label must follow the two ground axes, not the
  // screen-aligned artwork bounds. Measure the actual rendered control planes.
  const planes = await page.locator(".node-group").evaluate((group) =>
    [".node-group-area", ".node-group-header-hit"].map((selector) => {
      const rect = group.querySelector<SVGRectElement>(selector)!;
      const matrix = rect
        .ownerSVGElement!.getScreenCTM()!
        .inverse()
        .multiply(rect.getScreenCTM()!);
      return [
        [0, 0],
        [rect.width.baseVal.value, 0],
        [rect.width.baseVal.value, rect.height.baseVal.value],
        [0, rect.height.baseVal.value],
      ].map(([x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
    }),
  );
  for (const [a, b, c] of planes) {
    expect((b.y - a.y) / (b.x - a.x)).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect((c.y - b.y) / (c.x - b.x)).toBeCloseTo(-1 / Math.sqrt(3), 6);
  }
  expect(await documentOf(page)).toEqual(grouped);
  await dragGroup(page);
  const moved = await documentOf(page);
  const delta = {
    x: moved.instances[0].placement!.x - grouped.instances[0].placement!.x,
    y: moved.instances[0].placement!.y - grouped.instances[0].placement!.y,
  };
  expect(Math.hypot(delta.x, delta.y)).toBeGreaterThan(10);
  for (let index = 0; index < 3; index++) {
    expect(
      moved.instances[index].placement!.x -
        grouped.instances[index].placement!.x,
    ).toBeCloseTo(delta.x, 8);
    expect(
      moved.instances[index].placement!.y -
        grouped.instances[index].placement!.y,
    ).toBeCloseTo(delta.y, 8);
  }
  expect(moved.instances[3]).toEqual(grouped.instances[3]);
  expect(moved.connections).toEqual(grouped.connections);
  await page.locator(".node-group-header").focus();
  await page.keyboard.press("ArrowRight");
  const nudged = await documentOf(page);
  expect(nudged.instances[0].placement!.x).toBeCloseTo(
    moved.instances[0].placement!.x + 40,
    8,
  );
  expect(nudged.instances[3]).toEqual(moved.instances[3]);
  await page.keyboard.press("Enter");
  await expect(page.locator("#group-picker")).toHaveValue("group-1");
  await page.locator("#group-name").fill("Public API");
  await page.locator("#group-save").click();
  await page.locator("#panel-toggle").click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const path = await (await downloadEvent).path();
  const exported = JSON.parse(readFileSync(path!, "utf8")) as Design;
  expect(exported.groups![0].label).toBe("Public API");
  await page.locator("#file").setInputFiles({
    name: "grouped.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.locator("#panel-close").click();
  expect(await documentOf(page)).toEqual(exported);
  await expect(page.locator(".node-group-title")).toContainText("Public API");
  await manageGroups(page);
  await page.selectOption("#group-picker", "group-1");
  await page.locator("#group-ungroup").click();
  const ungrouped = await documentOf(page);
  expect(ungrouped.groups).toEqual([]);
  expect(ungrouped.instances).toEqual(exported.instances);
  expect(ungrouped.connections).toEqual(exported.connections);
  await expect(page.locator(".node-group")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Shift-click and marquee select nodes without panning, while grouped nodes keep individual scaling", async ({
  page,
}) => {
  await world(page);
  await manageGroups(page);
  const camera = await page.locator("#scene").getAttribute("viewBox");
  const client = await hit(page, "web-client");
  await page.keyboard.down("Shift");
  await page.mouse.click(client.x, client.y);
  await page.keyboard.up("Shift");
  await expect(
    page.locator('#group-members input[value="web-client"]'),
  ).toBeChecked();
  await page.locator("#group-clear").click();
  const b = (await page
    .locator('.scene-instance[data-instance-id="web-client"]')
    .boundingBox())!;
  await page.mouse.move(b.x - 8, b.y + 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 4, b.y + 45, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.locator('#group-members input[value="web-client"]'),
  ).toBeChecked();
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  const api = await hit(page, "compute-api");
  await page.mouse.click(api.x, api.y);
  await page.locator("#group-name").fill("App");
  await page.locator("#group-save").click();
  await page.getByRole("button", { name: "Close action editor" }).click();
  const point = await hit(page, "compute-api");
  await page.mouse.click(point.x, point.y);
  await page.locator("#replica-increase").click();
  const scaled = await documentOf(page);
  expect(scaled.groups![0].instances).toContain("compute-api-replica-2");
  expect(scaled.groups![0].instances).toContain("web-client");
  expect(scaled.clusters[0].instances).toEqual([
    "compute-api",
    "compute-api-replica-2",
  ]);
});

test.describe("touch organizational controls", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("creates, edits and ungroups mixed nodes without horizontal overflow", async ({
    page,
  }) => {
    await world(page);
    await manageGroups(page);
    await page.locator('#group-members input[value="web-client"]').check();
    await page.locator('#group-members input[value="compute-api"]').check();
    await page.locator('#group-members input[value="db-data"]').check();
    await page.locator("#group-name").fill("Mixed services");
    await page.locator("#group-save").tap();
    await page.selectOption("#group-picker", "group-1");
    expect((await documentOf(page)).groups![0].instances).toEqual([
      "web-client",
      "compute-api",
      "db-data",
    ]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await page.locator("#group-ungroup").tap();
    expect((await documentOf(page)).instances).toHaveLength(4);
    expect((await documentOf(page)).connections).toHaveLength(3);
  });
});
