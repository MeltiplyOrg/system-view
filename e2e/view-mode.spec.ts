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
    const overlaps: string[] = [];
    for (let first = 0; first < cards.length; first++)
      for (let second = first + 1; second < cards.length; second++)
        if (
          cards[first].box.left < cards[second].box.right &&
          cards[first].box.right > cards[second].box.left &&
          cards[first].box.top < cards[second].box.bottom &&
          cards[first].box.bottom > cards[second].box.top
        )
          overlaps.push(`${cards[first].name} / ${cards[second].name}`);
    return {
      count: cards.length,
      overlaps,
      inside: cards.every(
        ({ box }) =>
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight,
      ),
    };
  });
  expect(geometry).toEqual({ count: 20, overlaps: [], inside: true });

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
