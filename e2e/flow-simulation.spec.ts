import { expect, test, type Page } from "@playwright/test";
import type { Design } from "../src/design";

test.use({ viewport: { width: 1440, height: 1000 } });

/** Load the example through its destructive-action confirmation before controlling simulation time. */
async function mediaWorld(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#simulate-toggle").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#flow-media-example").click();
  await expect(
    page.locator('[data-renderer-type][data-raster-ready="true"]'),
  ).toHaveCount(16);
  const time = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.selectOption("#flow-speed", "16");
}

/** Only immutable request input/output is inspected; the simulator is not exposed as a testing global. */
async function output(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(
    (await page.locator("#flow-data-out").textContent()) ?? "null",
  ) as Record<string, unknown>;
}

/** Find painted pixels after Locate moves the actual model out from under overlays. */
async function hit(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page
    .locator(`.scene-instance[data-instance-id="${id}"]`)
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      for (let y = box.top + 4; y < box.bottom; y += 5)
        for (let x = box.left + 4; x < box.right; x += 5)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error("Located node has no painted hit surface.");
    });
}

test("runs, pauses, steps and inspects media branches without rebuilding the world", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mediaWorld(page);
  const images = await page
    .locator(".component-raster")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  await page.locator("#flow-run").click();
  await page.locator("#flow-pause").click();
  await expect(page.locator("#flow-status")).toHaveText("Paused");
  await page.locator("#flow-step").click();
  await expect(page.locator("#flow-summary")).toContainText("0.5s");
  await expect(page.locator("#flow-trace button")).toHaveCount(3);
  await page.locator("#flow-pause").click();
  await page.clock.runFor(1200);
  await expect(page.locator("#flow-summary")).toContainText("1/1 complete");
  expect(await output(page)).toMatchObject({
    persistedBy: "db-media",
    branches: expect.any(Array),
  });
  await expect(
    page.locator('#flow-trace button[title="worker-encoder"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#flow-trace button[title="compute-image"]'),
  ).toHaveCount(0);
  const settled = await page.locator("#flow-summary").textContent();
  await page.clock.runFor(5000);
  expect(await page.locator("#flow-summary").textContent()).toBe(settled);

  await page.selectOption("#flow-preset", "image");
  await page.locator("#flow-run").click();
  await page.clock.runFor(1200);
  await expect(page.locator("#flow-summary")).toContainText("2/2 complete");
  await expect(
    page.locator('#flow-trace button[title="compute-image"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#flow-trace button[title="worker-encoder"]'),
  ).toHaveCount(0);
  await page.selectOption("#flow-preset", "playback");
  await page.locator("#flow-run").click();
  await page.clock.runFor(1000);
  expect(await output(page)).toMatchObject({
    cache: "miss",
    readFrom: "storage-delivery",
  });
  await page.locator("#flow-run").click();
  await page.clock.runFor(1000);
  expect(await output(page)).toMatchObject({
    cache: "hit",
    handledBy: "compute-cached",
  });
  await expect(
    page.locator(
      '.connection.flow-traced[data-connection-id="branch-cache->compute-cached"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.connection.flow-traced[data-connection-id="branch-cache->storage-delivery"]',
    ),
  ).toHaveCount(0);
  expect(
    await page
      .locator(".component-raster")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
  ).toEqual(images);
  await expect(page.locator(".scene-instance")).toHaveCount(16);
  await page.locator("#flow-reset").click();
  await expect(page.locator("#flow-trace button")).toHaveCount(0);
  await expect(page.locator("#scene")).not.toHaveClass(/flow-on/);
  expect(errors).toEqual([]);
});

test("edited numeric conditions change request routing and logical controls do not offer replicas", async ({
  page,
}) => {
  await mediaWorld(page);
  await page.locator("#flow-run").click();
  await page.clock.runFor(1200);
  await page.locator('#flow-trace button[title="branch-media"]').click();
  await page.locator("#flow-locate").click();
  await page.clock.runFor(1000);
  const point = await hit(page, "branch-media");
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#replica-increase")).toBeHidden();
  await expect(page.locator("#replica-increase")).toBeDisabled();
  await page.locator("#node-condition-field").fill("sizeMB");
  await page.selectOption("#node-condition-operator", "greater-than");
  await page.selectOption("#node-value-type", "number");
  await page.locator("#node-condition-value").fill("not-a-number");
  await page.locator("#flow-node-save").click();
  let design = JSON.parse(await page.locator("#source").inputValue()) as Design;
  expect(
    design.instances.find((node) => node.id === "branch-media")!.condition!
      .field,
  ).toBe("mediaType");
  await page.locator("#node-condition-value").fill("50");
  await page.locator("#flow-node-save").click();
  design = JSON.parse(await page.locator("#source").inputValue()) as Design;
  expect(
    design.instances.find((node) => node.id === "branch-media")!.condition,
  ).toEqual({ field: "sizeMB", operator: "greater-than", value: 50 });
  await page.locator("#flow-run").click();
  await page.clock.runFor(1200);
  await expect(
    page.locator('#flow-trace button[title="compute-image"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#flow-trace button[title="worker-encoder"]'),
  ).toHaveCount(0);
});

test("wires and executes an arbitrary conditional graph through typed native outputs", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").fill(
    JSON.stringify({
      version: 1,
      name: "Custom route",
      instances: [
        "web-start",
        "branch-check",
        "compute-low",
        "compute-high",
        "db-data",
      ],
    }),
  );
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await page.locator("#build-wire").click();
  await page.selectOption("#build-from", "web-start");
  await expect(
    page.locator('#build-to option[value="db-data"]'),
  ).toHaveJSProperty("disabled", true);
  await expect(
    page.locator('.scene-frame[data-cluster-id="instance:db-data"]'),
  ).toHaveClass(/wire-target-invalid/);
  await page.selectOption("#build-to", "branch-check");
  await page.locator("#build-connect").click();
  for (const [port, target] of [
    ["true", "compute-high"],
    ["false", "compute-low"],
  ]) {
    await page.selectOption("#build-from", "branch-check");
    await page.selectOption("#build-outlet", port);
    await page.selectOption("#build-to", target);
    await page.locator("#build-connect").click();
  }
  await page.locator("#simulate-toggle").click();
  await page.selectOption("#flow-preset", "image");
  await page.selectOption("#flow-speed", "16");
  await page.locator("#flow-run").click();
  await expect(page.locator("#flow-summary")).toContainText("1/1 complete");
  expect(await output(page)).toMatchObject({
    mediaType: "image",
    handledBy: "compute-low",
  });
  await expect(
    page.locator('.connection.flow-traced[data-connection-id="wire-3"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.connection.flow-traced[data-connection-id="wire-2"]'),
  ).toHaveCount(0);
});

test("builds a load balancer and routes a burst through exactly one backend per request", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").fill(
    JSON.stringify({
      version: 1,
      name: "Balanced web app",
      instances: [
        { id: "web-client", placement: { x: -480, y: 0 } },
        { id: "compute-a", placement: { x: 240, y: -200 } },
        { id: "compute-b", placement: { x: 240, y: 200 } },
      ],
    }),
  );
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.locator('[data-category="load-balancer"]').click();
  await page
    .getByRole("button", { name: "Build Load balancer", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".build-placement")).not.toHaveClass(
    /placement-invalid/,
  );
  await page.keyboard.press("Enter");
  await expect(
    page.locator(
      '.scene-instance[data-instance-id="lb-1"] [data-raster-ready="true"]',
    ),
  ).toBeVisible();
  await page.locator("#build-wire").click();
  for (const [from, to] of [
    ["web-client", "lb-1"],
    ["lb-1", "compute-a"],
    ["lb-1", "compute-b"],
  ]) {
    await page.selectOption("#build-from", from);
    await page.selectOption("#build-to", to);
    await page.locator("#build-connect").click();
  }
  await page.locator("#simulate-toggle").click();
  await page.selectOption("#flow-speed", "16");
  await page.locator("#flow-burst").click();
  await expect(page.locator("#flow-summary")).toContainText("10/10 complete");
  const backends: unknown[] = [];
  for (let request = 1; request <= 10; request++) {
    await page.selectOption("#flow-request", String(request));
    const data = await output(page);
    expect(data.balancedBy).toBe("lb-1");
    backends.push(data.handledBy);
    await expect(page.locator("#flow-trace button")).toHaveCount(3);
  }
  expect(backends).toEqual([
    "compute-a",
    "compute-b",
    "compute-a",
    "compute-b",
    "compute-a",
    "compute-b",
    "compute-a",
    "compute-b",
    "compute-a",
    "compute-b",
  ]);
  await expect(
    page.locator('.connection.flow-traced[data-connection-id="wire-3"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.connection.flow-traced[data-connection-id="wire-2"]'),
  ).toHaveCount(0);
});

test("media tooltips reserve provider space and stay clear of simulator controls", async ({
  page,
}) => {
  await mediaWorld(page);
  await page.locator("#simulate-toggle").click();
  await page.clock.runFor(100);
  const queue = await hit(page, "queue-encoding");
  await page.mouse.move(queue.x, queue.y);
  const overlap = await page.locator("#callout").evaluate((root) => {
    const badge = root
      .querySelector(".callout-provider")!
      .getBoundingClientRect();
    const name = root.querySelector(".callout-name")!.getBoundingClientRect();
    const meta = root.querySelector(".callout-meta")!.getBoundingClientRect();
    const area = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return area(badge, name) + area(badge, meta);
  });
  expect(overlap).toBe(0);
  const client = await hit(page, "web-media");
  await page.mouse.move(client.x, client.y);
  const geometry = await page.locator(".callout-card").evaluate((card) => {
    const a = card.getBoundingClientRect(),
      b = document.querySelector(".flow-panel")!.getBoundingClientRect();
    return {
      overlap:
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
      inside:
        a.left >= 0 &&
        a.top >= 0 &&
        a.right <= innerWidth &&
        a.bottom <= innerHeight,
    };
  });
  expect(geometry).toEqual({ overlap: 0, inside: true });
});
