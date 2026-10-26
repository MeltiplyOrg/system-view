import { expect, test, type Page } from "@playwright/test";
import type { Design } from "../src/design";

test.use({ viewport: { width: 1440, height: 1000 } });

/** Use the portable editor, not application globals, to frame a small routing graph. */
async function routingWorld(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.locator("#source").fill(
    JSON.stringify({
      version: 1,
      name: "Compact routing",
      instances: [
        { id: "web-start", placement: { x: -400, y: 0 } },
        { id: "branch-check", placement: { x: 0, y: 0 } },
        { id: "compute-high", placement: { x: 400, y: -240 } },
        { id: "compute-low", placement: { x: 400, y: 240 } },
        { id: "merge-results", placement: { x: 800, y: 0 } },
        { id: "db-data", placement: { x: 1200, y: 0 } },
      ],
    }),
  );
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await expect(
    page.locator("[data-renderer-type][data-raster-ready='true']"),
  ).toHaveCount(6);
}

/** Compare the actual cable endpoints with a junction's model origin at wire elevation. */
async function endpointGaps(page: Page, id: string): Promise<number[]> {
  return page.locator("#scene").evaluate((svg, nodeId) => {
    const node = svg.querySelector<SVGGElement>(
      `.scene-instance[data-instance-id="${nodeId}"]`,
    )!;
    const point = new DOMPoint(0, -4).matrixTransform(node.getCTM()!);
    return [...svg.querySelectorAll<SVGGElement>(".connection")].flatMap(
      (edge) => {
        const wire = edge.querySelector<SVGPathElement>(".wire")!;
        const connection = edge.dataset.connectionId!;
        const [from, to] = connection.split("->");
        if (from !== nodeId && to !== nodeId) return [];
        const endpoint = wire.getPointAtLength(
          from === nodeId ? 0 : wire.getTotalLength(),
        );
        const actual = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(
          wire.getCTM()!,
        );
        return [Math.hypot(point.x - actual.x, point.y - actual.y)];
      },
    );
  }, id);
}

/** Real pointer hits exercise the live target, including after the static body is rasterized. */
async function hit(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page
    .locator(`.scene-instance[data-instance-id="${id}"]`)
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      for (let y = box.top + 2; y < box.bottom; y += 3)
        for (let x = box.left + 2; x < box.right; x += 3)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error("Node has no visible hit target.");
    });
}

test("compact junctions attach cables without platform-sized gaps and stay attached after a move", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await routingWorld(page);
  await page.locator("#panel-toggle").click();
  const design = JSON.parse(
    await page.locator("#source").inputValue(),
  ) as Design;
  design.connections = [
    { from: "web-start", to: "branch-check" },
    { from: "branch-check", to: "compute-high", outlet: "true" },
    { from: "branch-check", to: "compute-low", outlet: "false" },
    { from: "compute-high", to: "merge-results" },
    { from: "compute-low", to: "merge-results" },
    { from: "merge-results", to: "db-data" },
  ];
  await page.locator("#source").fill(JSON.stringify(design));
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  for (const id of ["branch-check", "merge-results"]) {
    const gaps = await endpointGaps(page, id);
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) expect(gap).toBeLessThan(0.05);
  }
  const departures = await page
    .locator('.connection[data-connection-id^="branch-check->"] .wire')
    .evaluateAll((wires) =>
      wires.map((node) => {
        const wire = node as SVGPathElement;
        const start = wire.getPointAtLength(0),
          next = wire.getPointAtLength(8);
        const length = Math.hypot(next.x - start.x, next.y - start.y);
        return {
          x: (next.x - start.x) / length,
          y: (next.y - start.y) / length,
        };
      }),
    );
  expect(departures).toHaveLength(2);
  expect(
    departures[0].x * departures[1].x + departures[0].y * departures[1].y,
  ).toBeLessThan(0.75);
  await expect(page.locator(".scene-frame")).toHaveCount(4);
  const gate = await page
    .locator('[data-instance-id="branch-check"]')
    .boundingBox();
  const machine = await page
    .locator('[data-instance-id="compute-high"]')
    .boundingBox();
  expect(gate!.width).toBeLessThan(machine!.width / 3);
  await expect(page.locator("#simulate-toggle")).toHaveCount(0);

  const point = await hit(page, "branch-check");
  await page.mouse.move(point.x, point.y);
  const handle = page.locator(".drag-anchor");
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  expect(box.x).toBeGreaterThan(gate!.x + gate!.width / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 + 35,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = JSON.parse(
    await page.locator("#source").inputValue(),
  ) as Design;
  expect(
    moved.instances.find((node) => node.id === "branch-check")!.placement,
  ).not.toEqual({ x: 0, y: 0 });
  for (const gap of await endpointGaps(page, "branch-check"))
    expect(gap).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test("edits junction routing rules and wires true/false routes without an execution panel", async ({
  page,
}) => {
  await routingWorld(page);
  const point = await hit(page, "branch-check");
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#replica-increase")).toBeHidden();
  await page.locator("#node-condition-field").fill("sizeMB");
  await page.selectOption("#node-condition-operator", "greater-than");
  await page.selectOption("#node-value-type", "number");
  await page.locator("#node-condition-value").fill("invalid");
  await page.locator("#flow-node-save").click();
  await expect(page.locator("#flow-node-message")).toContainText(
    "finite numeric",
  );
  await page.locator("#node-condition-value").fill("50");
  await page.locator("#flow-node-save").click();
  let design = JSON.parse(await page.locator("#source").inputValue()) as Design;
  expect(
    design.instances.find((node) => node.id === "branch-check")!.condition,
  ).toEqual({ field: "sizeMB", operator: "greater-than", value: 50 });
  await page.locator("#detail-close").click();
  await page.locator("#panel-toggle").click();
  await page.locator("#fit").click();
  await page.locator("#panel-close").click();
  const merge = await hit(page, "merge-results");
  await page.mouse.click(merge.x, merge.y);
  await page.selectOption("#node-merge-mode", "any");
  await page.locator("#flow-node-save").click();
  design = JSON.parse(await page.locator("#source").inputValue()) as Design;
  expect(
    design.instances.find((node) => node.id === "merge-results")!.mergeMode,
  ).toBe("any");
  await page.locator("#build-wire").click();
  await page.selectOption("#build-from", "web-start");
  await expect(
    page.locator('#build-to option[value="db-data"]'),
  ).toHaveJSProperty("disabled", true);
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
  design = JSON.parse(await page.locator("#source").inputValue()) as Design;
  expect(design.connections).toMatchObject([
    { id: "wire-1", from: "web-start", to: "branch-check" },
    { id: "wire-2", from: "branch-check", to: "compute-high", outlet: "true" },
    { id: "wire-3", from: "branch-check", to: "compute-low", outlet: "false" },
  ]);
});

test("media tooltips keep provider badges clear of text and stay inside the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.selectOption("#example", "media-processing");
  await page.locator("#panel-close").click();
  const point = await hit(page, "queue-encoding");
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("#callout")).toHaveClass(/visible/);
  const geometry = await page.locator("#callout").evaluate((root) => {
    const badge = root
      .querySelector(".callout-provider")!
      .getBoundingClientRect();
    const name = root.querySelector(".callout-name")!.getBoundingClientRect();
    const meta = root.querySelector(".callout-meta")!.getBoundingClientRect();
    const card = root.querySelector(".callout-card")!.getBoundingClientRect();
    const area = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      overlap: area(badge, name) + area(badge, meta),
      inside:
        card.left >= 0 &&
        card.top >= 0 &&
        card.right <= innerWidth &&
        card.bottom <= innerHeight,
    };
  });
  expect(geometry).toEqual({ overlap: 0, inside: true });
});
