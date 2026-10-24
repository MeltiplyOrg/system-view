/**
 * Browser-level contract tests for the built site.
 *
 * Covers the minimal viewport, overlay stability, pan/zoom controls, JSON and
 * file round-trips, WCAG scans, and the mobile overlay. These run against
 * production output through Playwright's web server.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Design } from "../src/design";

/** Smallest valid document used to prove apply/import replace the scene. */
const oneRack: Design = {
  version: 1,
  name: "Single rack",
  nodes: [{ id: "db-only", label: "Only Rack" }],
  connections: [],
  clusters: [],
};
/** Two-node document with a link and a cluster, used to verify file import. */
const imported: Design = {
  version: 1,
  name: "Imported layout",
  nodes: [...oneRack.nodes, { id: "db-second", label: "Second Rack" }],
  connections: [
    { id: "copy", from: "db-only", to: "db-second", relation: "copies" },
  ],
  clusters: [
    {
      id: "imported-cluster",
      label: "Imported cluster",
      nodes: ["db-only", "db-second"],
    },
  ],
};

/**
 * Open the overlay and wait for its final visual state.
 *
 * Waiting for both visibility and opacity prevents later color/DOM scans from
 * observing the slide-in transition, which would make assertions timing-based.
 */
async function openSidebar(page: Page) {
  await page.getByRole("button", { name: "Design" }).click();
  const sidebar = page.locator("#sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("opacity", "1");
}

test.describe("minimal isometric canvas", () => {
  test("renders only the grid until Design is expanded", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#scene")).toBeVisible();
    await expect(page.locator(".database-rack")).toHaveCount(3);
    await expect(page.locator(".connection")).toHaveCount(2);
    await expect(page.locator(".cluster-label")).toHaveText("Database cluster");
    await expect(page.locator(".cluster-frame")).toHaveCount(1);
    await expect(page.locator(".cluster-frame")).toHaveAttribute(
      "data-cluster-id",
      "cluster-1",
    );
    await expect(page.locator(".space-grid")).toHaveAttribute("d", /M/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Design" })).toBeVisible();
  });

  test("the expanded sidebar is an overlay that never moves the scene", async ({
    page,
  }) => {
    await page.goto("/");
    const geometry = () =>
      page.evaluate(() => ({
        viewBox: document.querySelector("#scene")?.getAttribute("viewBox"),
        sceneWidth: document.querySelector("#scene")?.getBoundingClientRect()
          .width,
        stageScroll: document.querySelector(".stage")?.scrollLeft,
      }));
    const before = await geometry();
    await openSidebar(page);
    await expect(page.locator("#panel-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await geometry()).toEqual(before);
    await page.getByRole("button", { name: "Close design sidebar" }).click();
    await expect(page.locator("#sidebar")).toBeHidden();
    expect(await geometry()).toEqual(before);
  });

  test("wheel zooms, drag pans, and Fit restores the view", async ({
    page,
  }) => {
    await page.goto("/");
    const viewBox = () => page.locator("#scene").getAttribute("viewBox");
    const initial = await viewBox();
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -300);
    await expect.poll(viewBox).not.toBe(initial);
    const zoomed = await viewBox();
    await page.mouse.down();
    await page.mouse.move(780, 470, { steps: 8 });
    await page.mouse.up();
    await expect.poll(viewBox).not.toBe(zoomed);
    await openSidebar(page);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.getByRole("button", { name: "Close design sidebar" }).click();
    await expect.poll(viewBox).toBe(initial);
  });

  test("switches light, dark, and system themes", async ({ page }) => {
    await page.goto("/");
    await openSidebar(page);
    await page.selectOption("#theme", "light");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(236, 239, 239)",
    );
    await page.selectOption("#theme", "dark");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(12, 14, 16)",
    );
    await page.selectOption("#theme", "system");
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute("data-theme"),
      ),
    ).toBe(false);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(12, 14, 16)",
    );
  });

  test("applies valid JSON, imports a file, and preserves the scene on errors", async ({
    page,
  }) => {
    await page.goto("/");
    await openSidebar(page);
    await page.locator("#source").fill(JSON.stringify(oneRack));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".database-rack")).toHaveCount(1);
    await expect(page.locator(".cluster-label")).toHaveCount(0);
    await expect(page.locator(".cluster-frame")).toHaveCount(0);
    await expect(page.locator("#scene-title")).toHaveText("Single rack");

    await page.locator("#file").setInputFiles({
      name: "imported.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect(page.locator(".database-rack")).toHaveCount(2);
    await expect(page.locator(".connection")).toHaveCount(1);
    await expect(page.locator(".cluster-label")).toHaveText("Imported cluster");
    await expect(page.locator(".cluster-frame")).toHaveCount(1);
    await expect(page.locator(".cluster-frame")).toHaveAttribute(
      "data-cluster-id",
      "imported-cluster",
    );

    const invalid = {
      ...oneRack,
      connections: [{ id: "bad", from: "db-only", to: "missing" }],
    };
    await page.locator("#source").fill(JSON.stringify(invalid));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator("#message")).toContainText("unknown node");
    await expect(page.locator("#message")).toHaveClass(/error/);
    await expect(page.locator("#scene-title")).toHaveText("Imported layout");
    await expect(page.locator(".database-rack")).toHaveCount(2);
  });

  test("exports the applied JSON document", async ({ page }) => {
    await page.goto("/");
    await openSidebar(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("system-design.json");
    const path = await download.path();
    if (!path) throw new Error("Download did not produce a local file.");
    const exported = JSON.parse(readFileSync(path, "utf8")) as Design;
    expect(exported.name).toBe("Horizontal scaling");
    expect(exported.nodes).toHaveLength(3);
    expect(exported.nodes[0]).toEqual({
      id: "db-01",
      label: "Database Rack 01",
    });
    expect(
      exported.nodes.every(
        (node) =>
          !Object.hasOwn(node, "type") &&
          !Object.hasOwn(node, "position") &&
          !Object.hasOwn(node, "color"),
      ),
    ).toBe(true);
    expect(exported.clusters).toEqual([
      {
        label: "Database cluster",
        nodes: ["db-01", "db-02", "db-03"],
      },
    ]);
  });

  test("has no serious accessibility violations in either state", async ({
    page,
  }) => {
    await page.goto("/");
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
    expect(await scan()).toEqual([]);
    await openSidebar(page);
    expect(await scan()).toEqual([]);
  });
});

test.describe("mobile overlay", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("pinch zooms the canvas", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP touch input is Chromium-only.");

    await page.goto("/");
    const viewBox = () => page.locator("#scene").getAttribute("viewBox");
    const initial = await viewBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; y: number }[],
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point, id) => ({
          ...point,
          id,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        })),
      });

    // Spread two contacts around the canvas center; the viewBox must shrink
    // (zoom in) even though the page itself has pinch-zoom disabled by the
    // canvas touch-action.
    await touch("touchStart", [
      { x: 150, y: 420 },
      { x: 240, y: 420 },
    ]);
    await touch("touchMove", [
      { x: 110, y: 420 },
      { x: 280, y: 420 },
    ]);
    await touch("touchEnd", []);

    await expect.poll(viewBox).not.toBe(initial);
  });

  test("fits the canvas and sidebar without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto("/");
    await openSidebar(page);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      stageScroll: document.querySelector(".stage")?.scrollLeft,
      sceneWidth: document.querySelector("#scene")?.getBoundingClientRect()
        .width,
      sidebarWidth: document.querySelector("#sidebar")?.getBoundingClientRect()
        .width,
    }));
    expect(layout.width).toBe(390);
    expect(layout.overflow).toBe(false);
    expect(layout.stageScroll).toBe(0);
    expect(layout.sceneWidth).toBe(390);
    expect(layout.sidebarWidth).toBeLessThanOrEqual(374);
  });
});
