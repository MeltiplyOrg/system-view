import { expect, test, type Page } from "@playwright/test";
import type { Design } from "../src/design";

test.use({ viewport: { width: 1440, height: 1000 } });

/** A clear manually placed graph keeps menu actions independent of boot examples. */
async function world(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").fill(
    JSON.stringify({
      version: 1,
      name: "Quick actions",
      instances: [
        { id: "web-start", placement: { x: -400, y: 0 } },
        { id: "branch-route", placement: { x: -120, y: 0 } },
        { id: "compute-api", placement: { x: 160, y: 0 } },
        { id: "db-data", placement: { x: 560, y: 0 } },
      ],
      connections: [{ from: "compute-api", to: "db-data" }],
    }),
  );
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await expect(
    page.locator('.scene-instance [data-raster-ready="true"]'),
  ).toHaveCount(4);
}

/** Real pointer targeting works both before and after rasterization, without application globals. */
async function point(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  return page
    .locator(`.scene-instance[data-instance-id="${id}"]`)
    .evaluate((node) => {
      const b = node.getBoundingClientRect();
      for (let y = b.top + 2; y < b.bottom; y += 3)
        for (let x = b.left + 2; x < b.right; x += 3)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error("Node has no visible hit target.");
    });
}

/** Native secondary-button events must open the menu without selecting or panning the node. */
async function context(page: Page, id: string): Promise<void> {
  const p = await point(page, id);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(
    page.getByRole("menu", { name: "World quick actions" }),
  ).toBeVisible();
}

/** The editor contains exactly the applied/exported world. */
async function documentOf(page: Page): Promise<Design> {
  return JSON.parse(await page.locator("#source").inputValue()) as Design;
}

test("right-click wiring keeps the clicked source, explicit branch ports and relationship validation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await world(page);
  const before = await documentOf(page);
  const camera = await page.locator("#scene").getAttribute("viewBox");
  await context(page, "web-start");
  await expect(page.locator("#scene")).toHaveAttribute("viewBox", camera!);
  expect(await documentOf(page)).toEqual(before);
  await page.getByRole("menuitem", { name: "Wire from this node…" }).click();
  await expect(page.locator("#build-from")).toHaveValue("web-start");
  await expect(
    page.locator('#build-to option[value="db-data"]'),
  ).toHaveJSProperty("disabled", true);
  const branch = await point(page, "branch-route");
  await page.mouse.click(branch.x, branch.y);
  expect((await documentOf(page)).connections).toContainEqual({
    id: "wire-1",
    from: "web-start",
    to: "branch-route",
  });
  await page.locator("#build-select").click();
  await page.locator("#build-toggle").click();
  await context(page, "branch-route");
  await page.getByRole("menuitem", { name: "Wire FALSE output…" }).click();
  await expect(page.locator("#build-from")).toHaveValue("branch-route");
  await expect(page.locator("#build-outlet")).toHaveValue("false");
  await page.selectOption("#build-to", "compute-api");
  await page.locator("#build-connect").click();
  expect((await documentOf(page)).connections).toContainEqual({
    id: "wire-2",
    from: "branch-route",
    to: "compute-api",
    outlet: "false",
    relation: "FALSE",
  });
  expect(errors).toEqual([]);
});

test("context multi-selection creates a group and group actions ungroup or delete exactly its members", async ({
  page,
}) => {
  await world(page);
  for (const id of ["web-start", "compute-api"]) {
    await context(page, id);
    await page.getByRole("menuitem", { name: "Add to selection" }).click();
  }
  await context(page, "web-start");
  await page
    .getByRole("menuitem", { name: "Group selected nodes (2)" })
    .click();
  const grouped = await documentOf(page);
  expect(grouped.groups![0].instances).toEqual(["web-start", "compute-api"]);
  await page.locator("#group-name").fill("App tier");
  await page.locator("#group-save").click();
  await page.locator("#build-toggle").click();
  await page.locator(".node-group-header-hit").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ungroup · keep nodes" }).click();
  const ungrouped = await documentOf(page);
  expect(ungrouped.groups).toEqual([]);
  expect(ungrouped.instances).toEqual(grouped.instances);
  expect(ungrouped.connections).toEqual(grouped.connections);

  await context(page, "web-start");
  await page.getByRole("menuitem", { name: "Add to selection" }).click();
  await context(page, "compute-api");
  await page.getByRole("menuitem", { name: "Add to selection" }).click();
  await context(page, "compute-api");
  await page
    .getByRole("menuitem", { name: "Delete selected nodes (2)" })
    .click();
  const deleted = await documentOf(page);
  expect(deleted.instances.map((node) => node.id)).toEqual([
    "branch-route",
    "db-data",
  ]);
  expect(deleted.connections).toEqual([]);
  expect(deleted.instances).toEqual(
    ungrouped.instances.filter((node) =>
      ["branch-route", "db-data"].includes(node.id),
    ),
  );
});

test("single-node deletion ignores another multi-selection and menu dismissal preserves selected nodes", async ({
  page,
}) => {
  await world(page);
  await page.locator("#build-groups").click();
  await page.locator('#group-members input[value="web-start"]').check();
  await page.locator('#group-members input[value="compute-api"]').check();
  await context(page, "web-start");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(
    page.locator('#group-members input[value="web-start"]'),
  ).toBeChecked();
  await expect(
    page.locator('#group-members input[value="compute-api"]'),
  ).toBeChecked();
  await context(page, "branch-route");
  await page
    .getByRole("menuitem", { name: "Delete node", exact: true })
    .click();
  expect((await documentOf(page)).instances.map((node) => node.id)).toEqual([
    "web-start",
    "compute-api",
    "db-data",
  ]);
  expect((await documentOf(page)).connections).toEqual([
    { from: "compute-api", to: "db-data" },
  ]);
});

test("background menus clamp to the viewport and support keyboard navigation without hijacking text inputs", async ({
  page,
}) => {
  await world(page);
  await page.mouse.click(1435, 910, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const b = (await menu.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(1440);
  expect(b.y + b.height).toBeLessThanOrEqual(1000);
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Fit world" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("menuitem", { name: "Select nodes to group…" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeHidden();
});
