import { expect, test } from "@playwright/test";
import type { Design } from "../src/design";

/** Requested public products, not inferred from the registry under test. */
const providers = [
  ["cloudflare", "Cloudflare CDN"],
  ["cloudfront", "Amazon CloudFront"],
  ["google-cloud-cdn", "Google Cloud CDN"],
  ["azure-front-door", "Azure Front Door"],
  ["fastly", "Fastly"],
  ["akamai", "Akamai"],
  ["bunny", "bunny.net"],
  ["cdn77", "CDN77"],
  ["keycdn", "KeyCDN"],
  ["alibaba-cloud-cdn", "Alibaba Cloud CDN"],
] as const;

/** Independent CDN nodes share product pixels without being exposed as machine replicas. */
test("all CDN providers persist on independent edges and share product artwork", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.selectOption("#example", "cdn-delivery");
  const design = JSON.parse(
    await page.locator("#source").inputValue(),
  ) as Design;
  design.instances.push(
    { id: "cdn-west", label: "West edge" },
    { id: "cdn-east", label: "East edge" },
  );
  design.clusters = [];
  await page.locator("#source").fill(JSON.stringify(design));
  await page.locator("#apply").click();
  await page.locator("#panel-close").click();
  await expect(
    page.locator('[data-renderer-type="cdn"][data-raster-ready="true"]'),
  ).toHaveCount(3);
  /** Find a painted hit surface again after a provider changes the silhouette. */
  const selectEdge = async () => {
    const hit = await page
      .locator('.scene-instance[data-instance-id="cdn-edge"]')
      .evaluate((node) => {
        const box = node.getBoundingClientRect();
        for (let y = box.top + 4; y < box.bottom; y += 6)
          for (let x = box.left + 4; x < box.right; x += 6)
            if (
              document.elementFromPoint(x, y)?.closest(".scene-instance") ===
              node
            )
              return { x, y };
        throw new Error("CDN has no visible hit target");
      });
    await page.mouse.click(hit.x, hit.y);
  };
  await selectEdge();
  const picker = page.locator("#detail-provider");
  await expect(picker).toBeVisible();
  const options = await picker
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => [
        (node as HTMLOptionElement).value,
        node.textContent,
      ]),
    );
  expect(options).toEqual([["", "Default"], ...providers]);
  const seen = new Set<string>();
  for (const [id, label] of providers) {
    // Capture the printed mark synchronously, before cached pixels replace vectors.
    const badges = await picker.evaluate((select, provider) => {
      (select as HTMLSelectElement).value = provider;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return [
        ...document.querySelectorAll(
          '.scene-instance[data-instance-id="cdn-edge"] [data-renderer-type="cdn"]',
        ),
      ].map((node) => ({
        marks: node.querySelectorAll(".cdn-provider-badge svg").length,
        name: node.closest(".scene-instance")!.getAttribute("aria-label"),
        modelFills: [
          ...node.querySelectorAll(".cdn-provider-badge svg path"),
        ].map((path) => getComputedStyle(path).fill),
        tooltipFills: [
          ...document.querySelectorAll("#callout .callout-provider svg path"),
        ].map((path) => getComputedStyle(path).fill),
      }));
    }, id);
    expect(badges).toHaveLength(1);
    for (const badge of badges) {
      expect(badge.marks).toBe(1);
      expect(badge.name).toContain(label);
      expect(badge.tooltipFills).toEqual(badge.modelFills);
    }
    // Provider edits affect only the selected edge. JSON can explicitly configure the other independent PoPs.
    await page.locator("#detail-close").click();
    await page.getByRole("button", { name: "Design", exact: true }).click();
    const configured = JSON.parse(
      await page.locator("#source").inputValue(),
    ) as Design;
    expect(
      configured.instances.find((node) => node.id === "cdn-edge")!.provider,
    ).toBe(id);
    for (const node of configured.instances)
      if (node.id.startsWith("cdn-")) node.provider = id;
    await page.locator("#source").fill(JSON.stringify(configured));
    await page.locator("#apply").click();
    await page.locator("#panel-close").click();
    const skins = page.locator(
      `[data-renderer-type="cdn"][data-renderer-provider="${id}"][data-raster-ready="true"]`,
    );
    await expect(skins).toHaveCount(3);
    const urls = await skins
      .locator(".component-raster")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!));
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(1);
    expect(seen.has(urls[0])).toBe(false);
    seen.add(urls[0]);
    const exported = JSON.parse(
      await page.locator("#source").inputValue(),
    ) as Design;
    expect(
      exported.instances
        .filter(({ id }) => id.startsWith("cdn-"))
        .map(({ provider }) => provider),
    ).toEqual([id, id, id]);
    expect(exported.connections).toEqual(design.connections);
    await expect(page.locator(".connection")).toHaveCount(2);
    await expect(
      page.locator(".transformer-rig,.transformer-waiting"),
    ).toHaveCount(0);
    await selectEdge();
  }
  await page.locator("#detail-close").click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.selectOption("#theme", "light");
  await page.locator("#fit").click();
  await expect
    .poll(async () => {
      const urls = await page
        .locator('[data-renderer-type="cdn"] .component-raster')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href")!),
        );
      return (
        urls.length === 3 &&
        new Set(urls).size === 1 &&
        urls.every((url) => !seen.has(url))
      );
    })
    .toBe(true);
  await page.locator("#panel-close").click();
  await selectEdge();
  await picker.selectOption("");
  await expect(
    page.locator('[data-renderer-type="cdn"][data-renderer-provider]'),
  ).toHaveCount(2);
  const restored = JSON.parse(
    await page.locator("#source").inputValue(),
  ) as Design;
  expect(
    restored.instances.find((node) => node.id === "cdn-edge")!.provider,
  ).toBeUndefined();
  expect(
    restored.instances
      .filter((node) => node.id === "cdn-west" || node.id === "cdn-east")
      .map((node) => node.provider),
  ).toEqual(["alibaba-cloud-cdn", "alibaba-cloud-cdn"]);
  await expect(page.locator(".connection")).toHaveCount(2);
});
