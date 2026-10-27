import { expect, test, type Page } from "@playwright/test";

/** Deterministic manual simulation advancement crosses the same Step control used by learners. */
async function step(page: Page, count: number): Promise<void> {
  await page.locator("#traffic-step").evaluate((button, n) => {
    for (let i = 0; i < n; i++) (button as HTMLButtonElement).click();
  }, count);
}

/** Hit actual visible Users artwork, avoiding the fixed traffic HUD and transparent bounds. */
async function inspectUsers(page: Page): Promise<void> {
  const point = await page
    .locator('.scene-instance[data-instance-id="users-source"]')
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      for (let y = box.bottom - 12; y > box.top; y -= 8)
        for (let x = box.left + 8; x < box.right; x += 8)
          if (
            document.elementFromPoint(x, y)?.closest(".scene-instance") === node
          )
            return { x, y };
      throw new Error("Users artwork has no visible hit target.");
    });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#detail-title")).toHaveText("Users");
}

test("individual request identity travels through the boot journey without lighting the whole wire", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".connection.duplex")).toHaveCount(3);
  await expect(page.locator(".wire-response")).toHaveCount(3);
  await expect(page.locator(".request-marker")).toHaveCount(0);
  await step(page, 102);
  const first = page.locator('.request-marker[data-request-id="1"]');
  await expect(first).toHaveAttribute("data-connection-index", "0");
  const before = await first.getAttribute("cx");
  await step(page, 2);
  expect(await first.getAttribute("cx")).not.toBe(before);
  await step(page, 13);
  await expect(first).toHaveAttribute("data-connection-index", "1");
  await step(page, 15);
  await expect(first).toHaveAttribute("data-connection-index", "2");
  await step(page, 15);
  await expect(first).toHaveAttribute("data-direction", "response");
  await expect(first).toHaveAttribute("data-connection-index", "2");
  await expect(page.locator("#traffic-summary")).toContainText("0 delivered");
  const returning = await first.getAttribute("cx");
  await step(page, 2);
  expect(await first.getAttribute("cx")).not.toBe(returning);
  await step(page, 3);
  await expect(first).toHaveAttribute("data-connection-index", "1");
  await step(page, 5);
  await expect(first).toHaveAttribute("data-connection-index", "0");
  await step(page, 5);
  await expect(first).toHaveCount(0);
  await expect(page.locator("#traffic-summary")).toContainText("1 delivered");
  await expect(page.locator("#traffic-p95")).toHaveText("600ms");
  await expect(page.locator("#traffic-time")).toHaveText("sim 1.62s");
  await page.locator("#traffic-reset").click();
  await expect(page.locator(".request-marker")).toHaveCount(0);
});

test("Users detail HUD persists independent traffic and zero stops emissions", async ({
  page,
}) => {
  await page.goto("/");
  await inspectUsers(page);
  await expect(page.locator("#detail-capacity")).toBeHidden();
  await page.locator("#users-traffic-rps").fill("3");
  await page.getByRole("button", { name: "Set traffic", exact: true }).click();
  await expect(page.locator("#source-traffic-message")).toContainText("saved");
  await step(page, 110);
  await expect(page.locator("#traffic-summary")).toContainText("3 sent");
  const source = await page.locator("#source").inputValue();
  expect(
    JSON.parse(source).instances.find(
      (node: { id: string }) => node.id === "users-source",
    ).trafficRps,
  ).toBe(3);
  await page.locator("#users-traffic-rps").fill("0");
  await page.getByRole("button", { name: "Set traffic", exact: true }).click();
  await step(page, 20);
  await expect(page.locator(".request-marker")).toHaveCount(0);
  await expect(page.locator("#traffic-summary")).toContainText("0 sent");
});

test("overload queues at 100%, then a tail-latency breach crashes and Reset clears live state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const design = JSON.parse(await page.locator("#source").inputValue());
  design.instances.find(
    (node: { id: string }) => node.id === "users-source",
  ).trafficRps = 10;
  design.instances.find(
    (node: { id: string }) => node.id === "compute-api",
  ).capacityRps = 1;
  await page.locator("#source").fill(JSON.stringify(design));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await step(page, 40);
  expect(
    Number(await page.locator("#traffic-queued").textContent()),
  ).toBeGreaterThan(0);
  const loads = await page
    .locator(".node-status-layer [role=meter]")
    .evaluateAll((meters) =>
      meters.map((meter) => Number(meter.getAttribute("aria-valuenow"))),
    );
  expect(loads.every((load) => load <= 100)).toBe(true);
  expect(loads).toContain(100);
  await step(page, 200);
  await expect(page.locator("#traffic-health")).toContainText("system crashed");
  await expect(page.locator("#traffic-health")).toContainText("p95 > 1000ms");
  await expect(page.locator("#traffic-p95")).toHaveText("1500ms");
  await expect(page.locator("#traffic-error-rate")).toHaveText("0.0%");
  await expect(page.locator("#traffic-toggle")).toBeDisabled();
  await expect(page.locator("#traffic-step")).toBeDisabled();
  const stopped = await page.locator("#traffic-summary").textContent();
  await step(page, 10);
  await expect(page.locator("#traffic-summary")).toHaveText(stopped!);
  await page.locator("#traffic-reset").click();
  await expect(page.locator("#traffic-queued")).toHaveText("0");
  await expect(page.locator("#traffic-p95")).toHaveText("—");
  await expect(page.locator("#traffic-step")).toBeEnabled();
});

test("editable p99 crash limits survive reset and can restart a healthy simulation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Crash limits", { exact: true }).click();
  await page.locator("#traffic-p95-limit").fill("60000");
  await page.locator("#traffic-p99-limit").fill("500");
  await page.locator("#traffic-error-limit").fill("100");
  await page
    .getByRole("button", { name: "Apply limits & reset", exact: true })
    .click();
  await step(page, 162);
  await expect(page.locator("#traffic-health")).toContainText("p99 > 500ms");
  await page.locator("#traffic-reset").click();
  await expect(page.locator("#traffic-p99-limit")).toHaveValue("500");
  await page.locator("#traffic-p99-limit").fill("60000");
  await page
    .getByRole("button", { name: "Apply limits & reset", exact: true })
    .click();
  await step(page, 162);
  await expect(page.locator("#traffic-p95")).toHaveText("600ms");
  await expect(page.locator("#traffic-p99")).toHaveText("600ms");
  await expect(page.locator("#traffic-health")).toHaveText("system healthy");
});

test("failed root calls breach the error-rate limit independently of latency", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const design = JSON.parse(await page.locator("#source").inputValue());
  design.connections = [];
  await page.locator("#source").fill(JSON.stringify(design));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await step(page, 100);
  await expect(page.locator("#traffic-health")).toContainText(
    "error rate > 5%",
  );
  await expect(page.locator("#traffic-error-rate")).toHaveText("100.0%");
  await expect(page.locator("#traffic-toggle")).toBeDisabled();
});

test("slow-motion playback changes wall-clock pace, never simulated latency or source rate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#traffic-speed")).toHaveValue("0.1");
  await step(page, 102);
  await expect(page.locator("#traffic-time")).toHaveText("sim 1.02s");
  await page.selectOption("#traffic-speed", "10");
  await expect(page.locator("#traffic-time")).toHaveText("sim 1.02s");
  await step(page, 60);
  await expect(page.locator("#traffic-time")).toHaveText("sim 1.62s");
  await expect(page.locator("#traffic-p95")).toHaveText("600ms");
  await expect(page.locator("#traffic-summary")).toContainText("1 sent");
  await page.locator("#traffic-reset").click();
  await page.selectOption("#traffic-speed", "1");
  await page.locator("#traffic-toggle").click();
  await expect(page.locator("#traffic-summary")).toContainText("1 delivered");
  await page.locator("#traffic-toggle").click();
  await expect(page.locator("#traffic-p95")).toHaveText("600ms");
});

test("0.1× Run immediately shows a legible request and retains it while the node processes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#traffic-toggle").click();
  const first = page.locator('.request-marker[data-request-id="1"]');
  await expect(first).toHaveCount(1);
  const size = await first.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(8);
  await expect(first).toHaveAttribute("data-phase", "processing");
  await page.locator("#traffic-toggle").click();
  await expect(first).toHaveAttribute("data-phase", "processing");
  await expect(page.locator("#traffic-summary")).toContainText("1 sent");
  await page.locator("#traffic-reset").click();
  await expect(page.locator(".request-marker")).toHaveCount(0);
});
