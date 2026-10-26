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
 * Load the three-replica database example through the picker.
 *
 * Boot now starts on the all-renderer web-app scene, so tests that depend on a
 * database cluster or ten database racks select this catalogue entry first.
 */
async function useDatabaseCluster(page: Page) {
  await openSidebar(page);
  await page.locator("#example").selectOption("horizontal-scaling");
  await page.getByRole("button", { name: "Close design sidebar" }).click();
  await expect(page.locator("#sidebar")).toBeHidden();
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
  test("renders the all-renderer boot scene until Design is expanded", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#scene")).toBeVisible();
    await expect(page.locator(".scene-instance")).toHaveCount(4);
    await expect(page.locator(".database-rack")).toHaveCount(1);
    await expect(page.locator(".connection")).toHaveCount(3);
    await expect(page.locator(".wire-label")).toHaveText([
      "HTTPS / JSON",
      "GET / SET",
      "SQL on miss",
    ]);
    await expect(page.locator(".cluster-label")).toHaveCount(0);
    await expect(page.locator(".cluster-frame")).toHaveCount(0);
    // The boot scene carries the provider skin so the default view exercises
    // provider artwork alongside all four renderer types.
    await expect(page.locator('[data-renderer-type="cache"]')).toHaveAttribute(
      "data-renderer-provider",
      "redis",
    );
    await expect(page.locator(".space-grid")).toHaveAttribute("d", /M/);
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Design" })).toBeVisible();
  });

  test("loads reference designs from the example picker", async ({ page }) => {
    await page.goto("/");
    await openSidebar(page);
    const picker = page.locator("#example");
    await expect(picker).toHaveValue("web-app");
    await expect(page.locator("#example-hint")).toContainText("request");

    await picker.selectOption("sharding");
    await expect(page.locator("#scene-title")).toHaveText("Database sharding");
    await expect(page.locator(".database-rack")).toHaveCount(3);
    await expect(page.locator(".connection")).toHaveCount(3);
    await expect(page.locator(".wire-label")).toHaveText([
      "keys 0-33%",
      "keys 34-66%",
      "keys 67-100%",
    ]);
    await expect(page.locator("#example-hint")).toContainText("shard");

    await picker.selectOption("microservices");
    await expect(page.locator("#scene-title")).toHaveText("Microservices");
    await expect(page.locator(".connection")).toHaveCount(5);
    await expect(page.locator(".wire-label")).toHaveText([
      "HTTPS",
      "gRPC",
      "gRPC",
      "SQL",
      "SQL",
    ]);

    await picker.selectOption("read-replicas");
    await expect(page.locator("#scene-title")).toHaveText("Read replicas");
    await expect(page.locator(".connection[data-to-cluster]")).toHaveCount(3);
    await expect(page.locator(".connection[data-cluster-id]")).toHaveCount(2);

    await page.locator("#reset").click();
    await expect(picker).toHaveValue("web-app");
    await expect(page.locator("#scene-title")).toHaveText("Simple web app");
  });

  test("promoting a database keeps its cluster in place", async ({ page }) => {
    await page.goto("/");
    await openSidebar(page);
    await page.locator("#example").selectOption("web-app");
    await page.locator("#panel-close").click();

    const point = await rackPoint(page);
    if (!point) throw new Error("No database rack found.");
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#detail-title")).toHaveText(
      "Application database",
    );
    await page.locator("#replica-increase").click();
    await page.locator("#replica-increase").click();
    await expect(page.locator("#detail-count")).toHaveText("3");
    await expect(page.locator(".scene-instance")).toHaveCount(6);
    await expect(
      page.locator('.connection[data-connection-id="cache-server->db-app"]'),
    ).toHaveAttribute("data-to-cluster", /.+/);

    // The promoted cluster must stay to the right of every node declared
    // before it, so the API reaches forward instead of crossing the frontend.
    const centers = await page.evaluate(() => {
      const center = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return {
        cluster: center(".cluster-frame"),
        web: center('[data-instance-id="web-frontend"]'),
        api: center('[data-instance-id="compute-api"]'),
        cache: center('[data-instance-id="cache-server"]'),
      };
    });
    expect(centers.cluster).toBeGreaterThan(centers.web);
    expect(centers.cluster).toBeGreaterThan(centers.api);
    expect(centers.cluster).toBeGreaterThan(centers.cache);
  });

  test("hovering a cluster reports its summary and follows the pointer", async ({
    page,
  }) => {
    await page.goto("/");
    await useDatabaseCluster(page);
    // Geometry must be measured after web fonts stop changing the card size.
    await page.evaluate(() => document.fonts.ready);
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

    // The leader anchors to the pointer; placement may move around overlay controls.
    const anchorBox = await tip.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(Math.abs(anchorBox.left - pointer.x)).toBeLessThan(1.5);
    expect(Math.abs(anchorBox.top - pointer.y)).toBeLessThan(1.5);

    // The anchor follows the pointer; the card may travel less at a viewport clamp.
    const movedPointer = { x: pointer.x + 20, y: pointer.y + 10 };
    await page.mouse.move(movedPointer.x, movedPointer.y);
    const movedCard = await card.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    const movedAnchor = await tip.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(Math.abs(movedAnchor.left - movedPointer.x)).toBeLessThan(1.5);
    expect(Math.abs(movedAnchor.top - movedPointer.y)).toBeLessThan(1.5);
    const stage = await page
      .locator(".stage")
      .evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(movedCard.left).toBeGreaterThanOrEqual(stage.left);
    expect(movedCard.top).toBeGreaterThanOrEqual(stage.top);
    expect(movedCard.right).toBeLessThanOrEqual(stage.right);
    expect(movedCard.bottom).toBeLessThanOrEqual(stage.bottom);

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
        angle: (Math.atan2(b, a) * 180) / Math.PI,
      };
    });
    expect(
      Math.abs(
        Number.parseFloat(leader.width) -
          Math.hypot(nearX - movedPointer.x, nearY - movedPointer.y),
      ),
    ).toBeLessThan(1.5);
    expect(Math.abs(leader.angle - expectedAngle)).toBeLessThan(1);

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
    await expect(page.locator("#example")).toHaveValue("");
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
    await expect(page.locator(".wire-label")).toHaveText("copies");
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
    await page.locator("#example").selectOption("horizontal-scaling");
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
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    const initial = await page.locator("#scene").getAttribute("viewBox");
    await page.mouse.click(point.x, point.y);

    await expect(page.locator("#detail")).toBeVisible();
    await expect(page.locator("#detail-title")).toHaveText(
      "Application database",
    );
    await expect(page.locator(".detail-replica")).toHaveCount(1);
    await expect(page.locator(".detail-link")).toHaveCount(1);
    await expect(page.locator("#callout")).toHaveClass(/visible/);

    // Sample the viewBox across the transition: a smooth pan produces several
    // distinct frames instead of one jump.
    const values = new Set<string>();
    for (let frame = 0; frame < 14; frame++) {
      await page.clock.runFor(16);
      values.add((await page.locator("#scene").getAttribute("viewBox")) ?? "");
    }
    expect(values.size).toBeGreaterThan(2);
    await expect
      .poll(() => page.locator("#scene").getAttribute("viewBox"))
      .not.toBe(initial);
    await page.clock.runFor(1600);

    // The target settles left of the panel.
    const geometry = await page.evaluate(() => ({
      calloutX: document.querySelector("#callout")?.getBoundingClientRect()
        .left,
      detailLeft: document.querySelector("#detail")?.getBoundingClientRect()
        .left,
    }));
    expect(geometry.calloutX).toBeLessThan(geometry.detailLeft! - 100);

    // The pinned callout ignores pointer movement inside the target.
    await page.clock.runFor(700);
    const pinned = await page
      .locator("#callout")
      .evaluate((element) => element.style.transform);
    await page.mouse.move(point.x + 20, point.y + 10);
    await page.clock.runFor(120);
    expect(
      await page
        .locator("#callout")
        .evaluate((element) => element.style.transform),
    ).toBe(pinned);
  });

  test("rapid replica edits preserve in-flight drops and remove replicas immediately", async ({
    page,
  }) => {
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    const result = await page.evaluate(() => {
      const increase =
        document.querySelector<HTMLButtonElement>("#replica-increase")!;
      const decrease =
        document.querySelector<HTMLButtonElement>("#replica-decrease")!;
      increase.click();
      const entry = document.querySelector(".instance-enter")!;
      const replica = entry.querySelector<SVGGElement>(".scene-instance")!;
      const id = replica.dataset.instanceId;
      const animation = entry.getAnimations()[0];
      animation.pause();
      animation.currentTime = 120;
      increase.click();
      const current = [
        ...document.querySelectorAll<SVGGElement>(".scene-instance"),
      ].find((element) => element.dataset.instanceId === id);
      const preserved =
        current === replica &&
        entry.getAnimations()[0] === animation &&
        animation.currentTime === 120;
      const consistent = () =>
        document.querySelectorAll(".scene-instance").length ===
        JSON.parse(
          document.querySelector<HTMLTextAreaElement>("#source")!.value,
        ).instances.length;
      let countsMatch = consistent();
      for (let i = 0; i < 12; i++) {
        increase.click();
        countsMatch &&= consistent();
      }
      const maximum = document.querySelector("#detail-count")!.textContent;
      for (let i = 0; i < 12; i++) {
        decrease.click();
        countsMatch &&= consistent();
      }
      return {
        preserved,
        countsMatch,
        maximum,
        minimum: document.querySelector("#detail-count")!.textContent,
        removed: !replica.isConnected,
      };
    });
    expect(result).toEqual({
      preserved: true,
      countsMatch: true,
      maximum: "10",
      minimum: "1",
      removed: true,
    });
  });

  test("rapid focus updates keep camera momentum instead of restarting ease-in", async ({
    page,
  }) => {
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    await page.goto("/");
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await page.clock.runFor(1600);
    const increase = page.locator("#replica-increase");
    await increase.evaluate((button) => (button as HTMLButtonElement).click());
    await page.clock.runFor(160);
    const logWidth = () =>
      page
        .locator("#scene")
        .evaluate((scene) =>
          Math.log(Number(scene.getAttribute("viewBox")!.split(" ")[2])),
        );
    const before = await logWidth();
    await page.clock.runFor(16);
    const atRetarget = await logWidth();
    await increase.evaluate((button) => (button as HTMLButtonElement).click());
    await page.clock.runFor(16);
    const after = await logWidth();
    expect(atRetarget - before).toBeGreaterThan(0);
    expect(after - atRetarget).toBeGreaterThan((atRetarget - before) * 0.5);
    await page.clock.runFor(3000);
    const settled = await page.locator("#scene").getAttribute("viewBox");
    await page.clock.runFor(1000);
    expect(await page.locator("#scene").getAttribute("viewBox")).toBe(settled);
    await increase.evaluate((button) => (button as HTMLButtonElement).click());
    await page.clock.runFor(80);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, -100);
    await page.clock.runFor(32);
    const manual = await page.locator("#scene").getAttribute("viewBox");
    await page.clock.runFor(1000);
    expect(await page.locator("#scene").getAttribute("viewBox")).toBe(manual);
  });

  test("ten-rack overview restores fine cable detail when zoomed in", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await useDatabaseCluster(page);
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await page.locator("#replica-increase").evaluate((button) => {
      for (let index = 0; index < 7; index++)
        (button as HTMLButtonElement).click();
    });
    await expect(page.locator(".scene-instance")).toHaveCount(10);
    const rackTraffic = page.locator(".database-rack .pulse").first();
    await expect(rackTraffic).toHaveCSS("display", "none");
    await expect(page.locator(".connection .pulse").first()).not.toHaveCSS(
      "display",
      "none",
    );
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, -1400);
    await expect(rackTraffic).not.toHaveCSS("display", "none");
    const rackMarks = page.locator("#rack-front .detail").first();
    await expect(rackMarks).not.toHaveCSS("display", "none");
    await expect(rackMarks).toHaveCSS("visibility", "visible");
    await expect(rackMarks).toHaveCSS("opacity", "1");
    await page.mouse.wheel(0, 1400);
    await expect(rackTraffic).toHaveCSS("display", "none");
    await expect(page.locator(".scene-instance")).toHaveCount(10);
  });

  test("prewarms overview racks and keeps their images through the first zoom", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await useDatabaseCluster(page);
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await page.locator("#replica-increase").evaluate((button) => {
      for (let index = 0; index < 7; index++)
        (button as HTMLButtonElement).click();
    });
    await expect(page.locator("#scene")).toHaveClass(/rack-overview/);
    await expect(
      page.locator('.database-rack[data-raster-ready="true"]'),
    ).toHaveCount(10);
    const result = await page.evaluate(() => {
      const rack = document.querySelector(
        '.database-rack[data-raster-ready="true"]',
      )!;
      const images = [...rack.querySelectorAll(".component-raster")];
      const hrefs = images.map((image) => image.getAttribute("href"));
      document.querySelector("#scene")!.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -1000,
          clientX: 400,
          clientY: 400,
          bubbles: true,
          cancelable: true,
        }),
      );
      const beforeRemoval = {
        reused: images.every(
          (image, index) =>
            image.isConnected && image.getAttribute("href") === hrefs[index],
        ),
        vectorCopies: rack.querySelectorAll(".rack-static").length,
        label: rack.querySelector(".instance-label")?.textContent,
      };
      const sourceUrls = new Set(
        [...document.querySelectorAll(".component-raster")].map((image) =>
          image.getAttribute("href"),
        ),
      );
      const decrease =
        document.querySelector<HTMLButtonElement>("#replica-decrease")!;
      const increase =
        document.querySelector<HTMLButtonElement>("#replica-increase")!;
      for (let count = 10; count > 1; count--) decrease.click();
      for (let count = 1; count < 10; count++) increase.click();
      return {
        ...beforeRemoval,
        sharedImages: sourceUrls.size,
        readdedReady: document.querySelectorAll('[data-raster-ready="true"]')
          .length,
        readdedReuse: [...document.querySelectorAll(".component-raster")].every(
          (image) => sourceUrls.has(image.getAttribute("href")),
        ),
      };
    });
    expect(result).toEqual({
      reused: true,
      vectorCopies: 0,
      label: "Database Rack 01",
      sharedImages: 2,
      readdedReady: 10,
      readdedReuse: true,
    });
  });

  test("close-range navigation culls offscreen racks without losing them", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await useDatabaseCluster(page);
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await page.locator("#replica-increase").evaluate((button) => {
      for (let index = 0; index < 7; index++)
        (button as HTMLButtonElement).click();
    });
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, -1800);
    await expect
      .poll(() =>
        page
          .locator(".instance-placement")
          .evaluateAll(
            (roots) =>
              roots.filter(
                (root) => getComputedStyle(root).visibility === "hidden",
              ).length,
          ),
      )
      .toBeGreaterThan(0);
    await expect(page.locator(".scene-instance")).toHaveCount(10);
    await page.mouse.wheel(0, 1800);
    await expect
      .poll(() =>
        page
          .locator(".instance-placement")
          .evaluateAll(
            (roots) =>
              roots.filter(
                (root) => getComputedStyle(root).visibility !== "hidden",
              ).length,
          ),
      )
      .toBe(10);
    await expect(page.locator(".scene-instance")).toHaveCount(10);
  });

  test("cached rack geometry changes palette with the theme and keeps labels live", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await useDatabaseCluster(page);
    const point = await rackPoint(page);
    if (!point) throw new Error("No rack point found.");
    await page.mouse.click(point.x, point.y);
    await page.locator("#replica-increase").evaluate((button) => {
      for (let index = 0; index < 7; index++)
        (button as HTMLButtonElement).click();
    });
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, -1000);
    const instanceId = await page
      .locator(".instance-placement")
      .evaluateAll(
        (roots) =>
          roots
            .find((root) => getComputedStyle(root).visibility !== "hidden")
            ?.querySelector<SVGGElement>(".scene-instance")?.dataset.instanceId,
      );
    expect(instanceId).toBeTruthy();
    const rack = page.locator(
      `.scene-instance[data-instance-id="${instanceId}"] .database-rack`,
    );
    await expect(rack).toHaveAttribute("data-raster-ready", "true");
    const fingerprint = () =>
      rack
        .locator('.component-raster[data-raster-layer="base"]')
        .evaluate(async (element) => {
          const source = (element as SVGImageElement).href.baseVal;
          const image = new Image();
          image.src = source;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 96;
          canvas.height = 128;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0, 96, 128);
          const pixels = context.getImageData(0, 0, 96, 128).data;
          let red = 0;
          let green = 0;
          let blue = 0;
          let painted = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] === 0) continue;
            red += pixels[index];
            green += pixels[index + 1];
            blue += pixels[index + 2];
            painted++;
          }
          // Mean paint color survives rerasterization at a different tier,
          // unlike a pixel-exact hash of antialiased edges.
          return painted === 0
            ? { red: 0, green: 0, blue: 0, painted }
            : {
                red: red / painted,
                green: green / painted,
                blue: blue / painted,
                painted,
              };
        });
    const dark = await fingerprint();
    expect(dark.painted).toBeGreaterThan(100);
    await page.locator("#detail-close").click();
    await expect(page.locator("#detail")).toBeHidden();
    await openSidebar(page);
    await page.selectOption("#theme", "light");
    await expect(rack).toHaveAttribute("data-raster-ready", "true");
    const light = await fingerprint();
    expect(light.red + light.green + light.blue).toBeGreaterThan(
      dark.red + dark.green + dark.blue + 60,
    );
    await expect(page.locator(".scene-instance .instance-label")).toHaveCount(
      10,
    );
    await page.selectOption("#theme", "dark");
    await expect
      .poll(async () => {
        const again = await fingerprint();
        return (
          light.red +
          light.green +
          light.blue -
          (again.red + again.green + again.blue)
        );
      })
      .toBeGreaterThan(60);
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

test.describe("provider switching safety", () => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`switches provider with bounded motion and ${reducedMotion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto("/");
      const cache = page.locator(
        '.scene-instance[data-instance-id="cache-server"]',
      );
      await expect(cache.locator('[data-raster-ready="true"]')).toHaveCount(1);
      const box = await cache.boundingBox();
      if (!box) throw new Error("Cache instance not laid out.");
      await page.mouse.click(
        box.x + box.width * 0.35,
        box.y + box.height * 0.78,
      );
      await expect(page.locator("#detail-provider")).toHaveValue("redis");
      await expect(page.locator("#scene")).not.toHaveClass(/navigating/);
      const viewport = await page.locator("#scene").getAttribute("viewBox");
      if (!viewport) throw new Error("Missing scene viewport.");

      // Inspect the same task as the change event: final geometry must already
      // be mounted, not deferred until an animation frame or timeout.
      const immediate = await page.evaluate(() => {
        const select =
          document.querySelector<HTMLSelectElement>("#detail-provider")!;
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const node = document.querySelector<SVGGElement>(
          '.scene-instance[data-instance-id="cache-server"]',
        )!;
        const body = node.querySelector<SVGGElement>("[data-renderer-type]")!;
        return {
          provider: body.dataset.rendererProvider ?? "",
          copies: document.querySelectorAll(
            '.scene-instance[data-instance-id="cache-server"]',
          ).length,
          transient: document.querySelectorAll(
            ".transformer-rig,.transformer-waiting",
          ).length,
          bodyAnimations: body.getAnimations().length,
          bodyTransform: getComputedStyle(body).transform,
          replicasDropping: node.closest(".instance-enter") !== null,
        };
      });
      expect(immediate).toEqual({
        provider: "",
        copies: 1,
        transient: reducedMotion === "reduce" ? 0 : 1,
        bodyAnimations: 0,
        bodyTransform: "none",
        replicasDropping: false,
      });
      await expect(cache.locator(".cache")).toHaveAttribute(
        "data-raster-ready",
        "true",
      );
      if (reducedMotion === "no-preference")
        await expect(cache.locator(".transformer-rig")).toHaveCount(1);
      await expect(
        page.locator(".transformer-rig,.transformer-waiting"),
      ).toHaveCount(0, { timeout: 1500 });
      await expect(page.locator("#scene")).toHaveAttribute("viewBox", viewport);
      await page.selectOption("#detail-provider", "redis");
      await expect(cache.locator(".cache")).toHaveAttribute(
        "data-renderer-provider",
        "redis",
      );
      await expect(cache.locator(".cache")).toHaveAttribute(
        "data-raster-ready",
        "true",
      );
      if (reducedMotion === "no-preference")
        await expect(cache.locator(".transformer-rig")).toHaveCount(1);
      await expect(
        page.locator(".transformer-rig,.transformer-waiting"),
      ).toHaveCount(0, { timeout: 1500 });
      await expect(page.locator("#scene")).toHaveAttribute("viewBox", viewport);
      await expect(page.locator("#detail-title")).toHaveText("Cache server");
    });
  }

  test("rapid cluster provider changes keep only the final ten cabinets", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const cache = page.locator(
      '.scene-instance[data-instance-id="cache-server"]',
    );
    const box = await cache.boundingBox();
    if (!box) throw new Error("Cache instance not laid out.");
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.78);
    await page.locator("#replica-increase").evaluate((button) => {
      for (let index = 0; index < 9; index++)
        (button as HTMLButtonElement).click();
    });
    await expect(
      page.locator(
        '.scene-instance [data-renderer-type="cache"][data-raster-ready="true"]',
      ),
    ).toHaveCount(10);
    await page.evaluate(() => {
      const stats = { peakRigs: 0, peakWaiting: 0 };
      (
        window as Window & { transformerStats?: typeof stats }
      ).transformerStats = stats;
      new MutationObserver(() => {
        stats.peakRigs = Math.max(
          stats.peakRigs,
          document.querySelectorAll(".transformer-rig").length,
        );
        stats.peakWaiting = Math.max(
          stats.peakWaiting,
          document.querySelectorAll(".transformer-waiting").length,
        );
      }).observe(document.querySelector("#scene")!, {
        childList: true,
        subtree: true,
      });
    });
    await page.selectOption("#detail-provider", "");
    await expect(page.locator(".transformer-rig")).toHaveCount(3);
    await expect(
      page.locator(".transformer-rig,.transformer-waiting"),
    ).toHaveCount(0, { timeout: 5000 });
    await page.selectOption("#detail-provider", "redis");
    await expect(page.locator(".transformer-rig")).toHaveCount(3);
    const final = await page.evaluate(() => {
      const select =
        document.querySelector<HTMLSelectElement>("#detail-provider")!;
      // Interrupt three active rigs and their queued replicas in the same task.
      // Old jobs must release their pixels instead of stacking choreography.
      for (const provider of ["", "redis", ""]) {
        select.value = provider;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const nodes = [
        ...document.querySelectorAll<SVGGElement>(
          '.scene-instance[data-instance-id^="cache-server"]',
        ),
      ];
      return {
        ids: nodes.map((node) => node.dataset.instanceId),
        providers: nodes.map(
          (node) =>
            node.querySelector<SVGGElement>("[data-renderer-type]")!.dataset
              .rendererProvider ?? "",
        ),
        transient: document.querySelectorAll(
          ".transformer-rig,.transformer-waiting",
        ).length,
        drops: nodes.filter((node) => node.closest(".instance-enter")).length,
      };
    });
    expect(final.ids).toHaveLength(10);
    expect(new Set(final.ids).size).toBe(10);
    expect(final.providers).toEqual(Array(10).fill(""));
    expect(final.transient).toBeLessThanOrEqual(10);
    expect(final.drops).toBe(0);
    await expect(
      page.locator(
        '.scene-instance [data-renderer-type="cache"][data-raster-ready="true"]',
      ),
    ).toHaveCount(10);
    await expect(page.locator("#detail-provider")).toHaveValue("");
    await expect(
      page.locator(".transformer-rig,.transformer-waiting"),
    ).toHaveCount(0, { timeout: 5000 });
    const stats = await page.evaluate(
      () =>
        (
          window as Window & {
            transformerStats?: { peakRigs: number; peakWaiting: number };
          }
        ).transformerStats!,
    );
    expect(stats.peakRigs).toBe(3);
    expect(stats.peakWaiting).toBeLessThanOrEqual(10);
    await expect(
      page.locator(
        '.scene-instance [data-renderer-type="cache"][style*="visibility: hidden"]',
      ),
    ).toHaveCount(0);
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
