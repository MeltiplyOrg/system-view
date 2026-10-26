import { expect, test } from "@playwright/test";
import type { Design } from "../src/design";

/** The foreground controller must occlude the drive walls, not be cut through by them. */
test("storage controllers remain intact in default, S3 and R2 artwork", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.selectOption("#theme", "dark");
  const design: Design = {
    version: 1,
    name: "Storage depth",
    instances: [
      { id: "storage-default", placement: { x: -480, y: 0 } },
      {
        id: "storage-s3",
        provider: "amazon-s3",
        placement: { x: 0, y: 0 },
      },
      {
        id: "storage-r2",
        provider: "cloudflare-r2",
        placement: { x: 480, y: 0 },
      },
    ],
    connections: [],
    clusters: [],
  };
  await page.locator("#source").fill(JSON.stringify(design));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const images = page.locator(".scene-instance .component-raster");
  await expect(
    page.locator('[data-renderer-type][data-raster-ready="true"]'),
  ).toHaveCount(3);
  for (const theme of ["dark", "light"]) {
    if (theme === "light") {
      const previous = await images.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href")),
      );
      await page.selectOption("#theme", theme);
      await expect
        .poll(() =>
          images.evaluateAll(
            (nodes, urls) =>
              nodes.length === 3 &&
              nodes.every((node) => !urls.includes(node.getAttribute("href"))),
            previous,
          ),
        )
        .toBe(true);
    }
    for (const { id } of design.instances) {
      const pixels = await page
        .locator(`.scene-instance[data-instance-id="${id}"] .component-raster`)
        .evaluate(async (node) => {
          const image = new Image();
          image.src = node.getAttribute("href")!;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          // Two unobstructed points on the same flat controller recess, away from
          // its border, LEDs and fan. The upper point overlaps a farther drive wall.
          const pixel = (z: number) => {
            const x = ((101 - 53) * Math.sqrt(3)) / 2;
            const y = (101 + 53) / 2 - z;
            return [
              ...context.getImageData(
                Math.floor(
                  ((x - Number(node.getAttribute("x"))) * image.naturalWidth) /
                    Number(node.getAttribute("width")),
                ),
                Math.floor(
                  ((y - Number(node.getAttribute("y"))) * image.naturalHeight) /
                    Number(node.getAttribute("height")),
                ),
                1,
                1,
              ).data,
            ];
          };
          return { upper: pixel(80), lower: pixel(50) };
        });
      expect(pixels.lower[3]).toBe(255);
      expect(pixels.upper, `${id} controller occlusion in ${theme}`).toEqual(
        pixels.lower,
      );
    }
  }
});
