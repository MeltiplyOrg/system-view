import { expect, test } from "@playwright/test";

/**
 * The media example packs three branch fittings and long merge routes close
 * together. This guards the rendered result rather than internal route lists:
 * independent cables must not hide inside one another and captions must remain
 * readable.
 */
test("media example separates branch ports, cables and captions", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#panel-toggle").click();
  await page.selectOption("#example", "media-processing");
  await expect(page.locator("#scene-title")).toHaveText(
    "Media processing web app",
  );
  await page.locator("#panel-close").click();

  const result = await page.evaluate(() => {
    const wires = [
      ...document.querySelectorAll<SVGGElement>(".connection"),
    ].map((group) => ({
      id: group.dataset.connectionId ?? "",
      path: group.querySelector<SVGPathElement>(".wire")!,
    }));
    const sampled = wires.map(({ id, path }) => {
      const length = path.getTotalLength();
      const count = Math.max(2, Math.ceil(length / 10));
      const points: [number, number][] = [];
      for (let index = 0; index <= count; index++) {
        const point = path.getPointAtLength((length * index) / count);
        points.push([point.x, point.y]);
      }
      return { id, points };
    });
    const overlappingCables: [string, string][] = [];
    for (let a = 0; a < sampled.length; a++)
      for (let b = a + 1; b < sampled.length; b++) {
        let close = 0;
        for (const first of sampled[a].points)
          for (const second of sampled[b].points)
            if (Math.hypot(first[0] - second[0], first[1] - second[1]) < 2.5)
              close++;
        if (close > 2) overlappingCables.push([sampled[a].id, sampled[b].id]);
      }

    const labels = [
      ...document.querySelectorAll<SVGTextElement>(".wire-label"),
    ].map((label) => ({
      text: label.textContent ?? "",
      box: label.getBoundingClientRect(),
    }));
    const overlappingLabels: [string, string][] = [];
    for (let a = 0; a < labels.length; a++)
      for (let b = a + 1; b < labels.length; b++)
        if (
          labels[a].box.left < labels[b].box.right &&
          labels[a].box.right > labels[b].box.left &&
          labels[a].box.top < labels[b].box.bottom &&
          labels[a].box.bottom > labels[b].box.top
        )
          overlappingLabels.push([labels[a].text, labels[b].text]);

    const start = (id: string) =>
      wires.find((wire) => wire.id === id)?.path.getAttribute("d") ?? "";
    return {
      overlappingCables,
      overlappingLabels,
      playStart: start("branch-action->cdn-media"),
      uploadStart: start("branch-action->compute-api"),
    };
  });

  expect(result.overlappingCables).toEqual([]);
  expect(result.overlappingLabels).toEqual([]);
  expect(result.playStart).not.toBe(result.uploadStart);
});
