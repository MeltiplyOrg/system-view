import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Open the grouped commerce example through the Design picker. */
async function commerce(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.selectOption("#example", "ecommerce-checkout");
  await expect(page.locator("#scene-title")).toHaveText("E-commerce checkout");
  await page.locator("#panel-close").click();
  await expect(page.locator("#sidebar")).toBeHidden();
}

test("View mode hides editing chrome and labels the complete architecture", async ({
  page,
}) => {
  await commerce(page);
  await page.locator("#view-toggle").click();
  await expect(page.locator("body")).toHaveClass(/view-mode/);
  await expect(page.locator("#view-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#view-toggle")).toHaveText("Exit view");
  await expect(page.locator("#panel-toggle")).toBeHidden();
  await expect(page.locator(".build-dock")).toBeHidden();
  await expect(page.locator(".iso-credit")).toBeHidden();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator("#detail")).toBeHidden();

  const labels = page.locator(".architecture-label");
  await expect(labels).toHaveCount(20);
  await expect(labels.first()).toContainText("Edge · Users");
  await expect(labels.first()).toContainText("Shoppers");
  await expect(labels.nth(1)).toContainText("Edge · Web frontend");
  await expect(labels.nth(1)).toContainText("Storefront");
  await expect(labels.filter({ hasText: "Order service" })).toContainText(
    "Application · Compute server",
  );
  await expect(labels.filter({ hasText: "Fulfillment worker" })).toContainText(
    "Async work · Media worker",
  );

  const geometry = await page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>(".architecture-label"),
    ]
      .filter((label) => !label.hidden)
      .map((label) => ({
        box: label
          .querySelector<HTMLElement>(".architecture-label-card")!
          .getBoundingClientRect(),
        name: label.querySelector(".architecture-name")?.textContent ?? "",
      }));
    const nodes = [...document.querySelectorAll<SVGElement>(".scene-instance")]
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    const overlaps: string[] = [],
      covering: string[] = [];
    for (let first = 0; first < cards.length; first++)
      for (let second = first + 1; second < cards.length; second++)
        if (
          cards[first].box.left < cards[second].box.right &&
          cards[first].box.right > cards[second].box.left &&
          cards[first].box.top < cards[second].box.bottom &&
          cards[first].box.bottom > cards[second].box.top
        )
          overlaps.push(`${cards[first].name} / ${cards[second].name}`);
    for (const card of cards)
      if (
        nodes.some(
          (node) =>
            card.box.left < node.right &&
            card.box.right > node.left &&
            card.box.top < node.bottom &&
            card.box.bottom > node.top,
        )
      )
        covering.push(card.name);
    const content = nodes.reduce(
        (box, node) => ({
          left: Math.min(box.left, node.left),
          top: Math.min(box.top, node.top),
          right: Math.max(box.right, node.right),
          bottom: Math.max(box.bottom, node.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      ),
      center = {
        x: (content.left + content.right) / 2,
        y: (content.top + content.bottom) / 2,
      },
      centerOf = (box: DOMRect) => ({
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      }),
      sides = {
        left: cards.filter((card) => centerOf(card.box).x < center.x).length,
        right: cards.filter((card) => centerOf(card.box).x >= center.x).length,
        above: cards.filter((card) => centerOf(card.box).y < center.y).length,
        below: cards.filter((card) => centerOf(card.box).y >= center.y).length,
      };
    return {
      count: cards.length,
      overlaps,
      covering,
      inside: cards.every(
        ({ box }) =>
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight,
      ),
      sides,
    };
  });
  expect(geometry).toMatchObject({
    count: 20,
    overlaps: [],
    covering: [],
    inside: true,
  });
  expect(geometry.sides.left).toBeGreaterThan(0);
  expect(geometry.sides.right).toBeGreaterThan(0);
  expect(geometry.sides.above).toBeGreaterThan(0);
  expect(geometry.sides.below).toBeGreaterThan(0);

  await page.locator("#view-toggle").click();
  await expect(page.locator("body")).not.toHaveClass(/view-mode/);
  await expect(page.locator("#view-toggle")).toHaveText("View");
  await expect(page.locator("#panel-toggle")).toBeVisible();
  await expect(page.locator(".build-dock")).toBeVisible();
  await expect(labels).toHaveCount(0);
});

test("Escape leaves view mode and restores the design controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#view-toggle").click();
  await expect(page.locator("body")).toHaveClass(/view-mode/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/view-mode/);
  await expect(page.locator("#view-toggle")).toHaveText("View");
  await expect(page.locator("#panel-toggle")).toBeVisible();
});
