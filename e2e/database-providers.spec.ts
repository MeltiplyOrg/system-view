import { expect, test } from "@playwright/test";

/** Database provider skins must be pickable and carry exactly one object mark. */
test("database providers print one exact mark and their accent", async ({
  page,
}) => {
  await page.goto("/");
  const database = page.locator('.scene-instance[data-instance-id="db-app"]');
  const box = await database.boundingBox();
  if (!box) throw new Error("Database instance not laid out.");
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.78);
  await expect(page.locator("#detail-title")).toHaveText(
    "Application database",
  );

  const options = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLOptionElement>(
        "#detail-provider option",
      ),
    ].map((option) => ({ value: option.value, label: option.textContent })),
  );
  expect(options).toEqual([
    { value: "", label: "Default" },
    { value: "postgresql", label: "PostgreSQL" },
    { value: "mysql", label: "MySQL" },
    { value: "sqlite", label: "SQLite" },
    { value: "mongodb", label: "MongoDB" },
  ]);

  for (const [id, color] of [
    ["postgresql", "#4169e1"],
    ["mysql", "#00758f"],
    ["sqlite", "#0f80cc"],
    ["mongodb", "#00ed64"],
  ] as const) {
    // Change the provider in-page so the badge is inspected before the raster
    // cache replaces the static vectors with a shared image.
    const state = await page.evaluate((provider) => {
      const select =
        document.querySelector<HTMLSelectElement>("#detail-provider")!;
      select.value = provider;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const instance = document.querySelector(
        '.scene-instance[data-instance-id="db-app"]',
      )!;
      const rack = instance.querySelector<SVGGElement>(".database-rack");
      return {
        selected: select.value,
        provider: rack?.dataset.rendererProvider,
        accent: rack
          ? getComputedStyle(rack).getPropertyValue("--cable-color").trim()
          : null,
        badges: instance.querySelectorAll(".rack-provider-badge").length,
        plates: instance.querySelectorAll(".brand-plate").length,
        logos: instance.querySelectorAll(".rack-provider-badge svg").length,
        svgs: instance.querySelectorAll("svg").length,
      };
    }, id);
    expect(state).toEqual({
      selected: id,
      provider: id,
      accent: color,
      badges: 1,
      plates: 1,
      logos: 1,
      svgs: 1,
    });
  }
});
