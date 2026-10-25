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
const oneInstance: Design = {
  version: 1,
  name: "Single rack",
  instances: [{ id: "db-only", label: "Only Rack" }],
  connections: [],
  clusters: [],
};
/** Two-instance document with a link and a cluster, used to verify file import. */
const imported: Design = {
  version: 1,
  name: "Imported layout",
  instances: [
    ...oneInstance.instances,
    { id: "db-second", label: "Second Rack" },
  ],
  connections: [
    { id: "copy", from: "db-only", to: "db-second", relation: "copies" },
  ],
  clusters: [
    {
      id: "imported-cluster",
      label: "Imported cluster",
      instances: ["db-only", "db-second"],
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

/**
 * Find a client point that hit-tests inside a rack.
 *
 * Rack groups reference shared `<use>` definitions, and Chromium reports stale
 * geometry for those groups, so Playwright's own bounding boxes cannot locate
 * them. Scanning painted pixels finds a point a real pointer can reach; the
 * second probe keeps the point clear of the rack edge for small movements.
 */
async function rackPoint(page: Page) {
  return page.evaluate(() => {
    const rect = document.querySelector("#scene")?.getBoundingClientRect();
    if (!rect) return null;
    for (let y = rect.top + 40; y < rect.bottom - 60; y += 12)
      for (let x = rect.left + 40; x < rect.right - 60; x += 12) {
        const rack = document
          .elementFromPoint(x, y)
          ?.closest?.(".database-rack");
        if (!rack) continue;
        const next = document
          .elementFromPoint(x + 20, y + 10)
          ?.closest?.(".database-rack");
        if (next === rack) return { x, y };
      }
    return null;
  });
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

  test("hovering an instance raises a corner-bracketed callout", async ({
    page,
  }) => {
    await page.goto("/");
    const tip = page.locator("#callout");
    const card = tip.locator(".callout-card");
    await expect(tip).not.toHaveClass(/visible/);

    // Instances overlap in projection; the nearest one is painted last, so its
    // center is the only one Playwright can hover without interception.
    // It belongs to the cluster, so the callout reports the cluster, not the
    // individual replica.
    const pointer = await rackPoint(page);
    if (!pointer) throw new Error("No rack point found.");
    await page.mouse.move(pointer.x, pointer.y);
    await expect(tip).toHaveClass(/visible/);
    await expect(card).toBeVisible();
    await expect(tip.locator(".callout-kind")).toHaveText("Cluster");
    await expect(tip.locator(".callout-name")).toHaveText("Database cluster");
    await expect(tip.locator(".callout-meta")).toHaveText("3 replicas");

    // Both the leader and the card follow the cursor: the wrapper sits on the
    // pointer and the card hangs 41.6px right and 24px up from it.
    const anchorBox = await tip.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(Math.abs(anchorBox.left - pointer.x)).toBeLessThan(1.5);
    expect(Math.abs(anchorBox.top - pointer.y)).toBeLessThan(1.5);

    const cardBox = await card.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(Math.abs(cardBox.x - (pointer.x + 41.6))).toBeLessThan(1.5);
    expect(
      Math.abs(cardBox.y + cardBox.height - (pointer.y - 64)),
    ).toBeLessThan(1.5);

    // Moving inside the same cluster carries the card with the cursor.
    const movedPointer = { x: pointer.x + 20, y: pointer.y + 10 };
    await page.mouse.move(movedPointer.x, movedPointer.y);
    const movedCard = await card.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(Math.abs(movedCard.x - (cardBox.x + 20))).toBeLessThan(1.5);
    expect(Math.abs(movedCard.y - (cardBox.y + 10))).toBeLessThan(1.5);

    // The leader ends on the card corner nearest the cursor.
    const corners = [
      [movedCard.left, movedCard.top],
      [movedCard.right, movedCard.top],
      [movedCard.left, movedCard.bottom],
      [movedCard.right, movedCard.bottom],
    ];
    const [nearX, nearY] = corners.reduce((best, corner) =>
      Math.hypot(corner[0] - movedPointer.x, corner[1] - movedPointer.y) <
      Math.hypot(best[0] - movedPointer.x, best[1] - movedPointer.y)
        ? corner
        : best,
    );
    const expectedAngle =
      (Math.atan2(nearY - movedPointer.y, nearX - movedPointer.x) * 180) /
      Math.PI;
    const leader = await tip.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      const matrix = style.transform.match(/matrix\(([^)]+)\)/)?.[1];
      const [a, b] = matrix?.split(",").map(Number) ?? [];
      return {
        width: style.width,
        height: style.height,
        angle: (Math.atan2(b, a) * 180) / Math.PI,
      };
    });
    expect(
      Math.abs(
        Number.parseFloat(leader.width) -
          Math.hypot(nearX - movedPointer.x, nearY - movedPointer.y),
      ),
    ).toBeLessThan(1.5);
    expect(leader.height).toBe("1px");
    expect(Math.abs(leader.angle - expectedAngle)).toBeLessThan(1);
    // A leader that is neither horizontal nor vertical reads as diagonal.
    expect(Math.abs(leader.angle)).toBeGreaterThan(5);
    expect(Math.abs(leader.angle)).toBeLessThan(85);

    // Only two opposing corners carry a border; the other sides stay open.
    const borders = await card.evaluate((element) => {
      const before = getComputedStyle(element, "::before");
      const after = getComputedStyle(element, "::after");
      return [
        before.borderTopWidth,
        before.borderLeftWidth,
        before.borderRightWidth,
        before.borderBottomWidth,
        after.borderTopWidth,
        after.borderLeftWidth,
        after.borderRightWidth,
        after.borderBottomWidth,
      ];
    });
    expect(borders).toEqual([
      "1px",
      "1px",
      "0px",
      "0px",
      "0px",
      "0px",
      "1px",
      "1px",
    ]);

    await page.mouse.move(4, 4);
    await expect(tip).not.toHaveClass(/visible/);
  });

  test("hovering a standalone instance reports the instance", async ({
    page,
  }) => {
    await page.goto("/");
    await openSidebar(page);
    await page.locator("#source").fill(JSON.stringify(oneInstance));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.locator("#panel-close").click();
    await expect(page.locator(".database-rack")).toHaveCount(1);

    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.move(point.x, point.y);
    const tip = page.locator("#callout");
    await expect(tip).toHaveClass(/visible/);
    await expect(tip.locator(".callout-kind")).toHaveText("Instance");
    await expect(tip.locator(".callout-name")).toHaveText("Only Rack");
    await expect(tip.locator(".callout-meta")).toHaveText("db-only");
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
    await page.locator("#source").fill(JSON.stringify(oneInstance));
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
      ...oneInstance,
      connections: [{ id: "bad", from: "db-only", to: "missing" }],
    };
    await page.locator("#source").fill(JSON.stringify(invalid));
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator("#message")).toContainText("unknown instance");
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
    expect(exported.instances).toHaveLength(3);
    expect(exported.instances[0]).toEqual({
      id: "db-01",
      label: "Database Rack 01",
    });
    expect(
      exported.instances.every(
        (instance) =>
          !Object.hasOwn(instance, "type") &&
          !Object.hasOwn(instance, "position") &&
          !Object.hasOwn(instance, "color"),
      ),
    ).toBe(true);
    expect(exported.clusters).toEqual([
      {
        label: "Database cluster",
        instances: ["db-01", "db-02", "db-03"],
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

test.describe("hover callout motion", () => {
  // The rest of the suite forces reduced motion; this block opts back in so
  // the staggered entry is exercised rather than skipped.
  test.use({ reducedMotion: "no-preference" });

  test("plays the staggered entry animation", async ({ page }) => {
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.move(point.x, point.y);
    const tip = page.locator("#callout");
    const card = tip.locator(".callout-card");
    await expect(card).toHaveCSS("animation-name", "tip-card");
    expect(
      await tip.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("tip-line");
    expect(
      await card.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("tip-corner");
  });
});

test.describe("instance selection", () => {
  // The camera glides unless reduced motion is requested, so this block opts
  // back in to prove the transition is animated rather than snapped.
  test.use({ reducedMotion: "no-preference" });

  test("clicking a target pins the callout, opens details, and pans the camera", async ({
    page,
  }) => {
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    const initial = await page.locator("#scene").getAttribute("viewBox");
    await page.mouse.click(point.x, point.y);

    await expect(page.locator("#detail")).toBeVisible();
    await expect(page.locator("#detail-kind")).toHaveText("Cluster");
    await expect(page.locator("#detail-title")).toHaveText("Database cluster");
    await expect(page.locator(".detail-replica")).toHaveCount(3);
    await expect(page.locator(".detail-link")).toHaveCount(2);
    await expect(page.locator("#callout")).toHaveClass(/visible/);

    // Sample the viewBox across the transition: a smooth pan produces several
    // distinct frames instead of one jump.
    const frames = await page.evaluate(async () => {
      const scene = document.querySelector("#scene");
      const values = new Set<string>();
      const start = performance.now();
      const { promise, resolve } = Promise.withResolvers<void>();
      const tick = () => {
        values.add(scene?.getAttribute("viewBox") ?? "");
        if (performance.now() - start < 220) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
      await promise;
      return values.size;
    });
    expect(frames).toBeGreaterThan(2);
    await expect
      .poll(() => page.locator("#scene").getAttribute("viewBox"))
      .not.toBe(initial);

    // Framing zooms in: the final viewBox is narrower than the fitted scene.
    const final = await page.locator("#scene").getAttribute("viewBox");
    const viewWidth = (value: string | null) => Number(value?.split(" ")[2]);
    expect(viewWidth(final)).toBeLessThan(viewWidth(initial));

    // The target settles left of the panel.
    const geometry = await page.evaluate(() => ({
      calloutX: document.querySelector("#callout")?.getBoundingClientRect()
        .left,
      detailLeft: document.querySelector("#detail")?.getBoundingClientRect()
        .left,
    }));
    expect(geometry.calloutX).toBeLessThan(geometry.detailLeft! - 100);

    // The pinned callout ignores pointer movement inside the target.
    await page.waitForTimeout(700);
    const pinned = await page
      .locator("#callout")
      .evaluate((element) => element.style.transform);
    await page.mouse.move(point.x + 20, point.y + 10);
    await page.waitForTimeout(120);
    expect(
      await page
        .locator("#callout")
        .evaluate((element) => element.style.transform),
    ).toBe(pinned);
  });

  test("Escape closes the detail panel and releases the callout", async ({
    page,
  }) => {
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#detail")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#detail")).toBeHidden();
    await expect(page.locator("#callout")).not.toHaveClass(/visible/);
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
