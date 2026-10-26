import { expect, test } from "vite-plus/test";
import { placeCallout } from "../src/callout-layout";

/** Actual media-entry geometry: viewport clamping alone put the card over the simulator header. */
test("keeps a top-edge tooltip readable without covering an overlay", () => {
  const header = { x: 16, y: 16, width: 390, height: 44 };
  const size = { width: 230, height: 100 };
  const result = placeCallout(
    { x: 74, y: 100 },
    size,
    { width: 1440, height: 1000 },
    [header],
  );
  const area =
    Math.max(
      0,
      Math.min(result.x + size.width, header.x + header.width) -
        Math.max(result.x, header.x),
    ) *
    Math.max(
      0,
      Math.min(result.y + size.height, header.y + header.height) -
        Math.max(result.y, header.y),
    );
  expect(area).toBe(0);
  expect(result.x).toBeGreaterThanOrEqual(0);
  expect(result.y).toBeGreaterThanOrEqual(0);
  expect(result.x + size.width).toBeLessThanOrEqual(1440);
  expect(result.y + size.height).toBeLessThanOrEqual(1000);
});

test("corner anchors stay inside a narrow viewport and avoid its header and footer", () => {
  const viewport = { width: 390, height: 844 },
    size = { width: 310, height: 120 };
  const blockers = [
    { x: 10, y: 10, width: 280, height: 44 },
    { x: 0, y: 744, width: 390, height: 100 },
  ];
  for (const anchor of [
    { x: 18, y: 18 },
    { x: 380, y: 18 },
    { x: 18, y: 830 },
    { x: 380, y: 830 },
  ]) {
    const result = placeCallout(anchor, size, viewport, blockers);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + size.width).toBeLessThanOrEqual(viewport.width);
    expect(result.y + size.height).toBeLessThanOrEqual(viewport.height);
    for (const block of blockers)
      expect(
        result.x >= block.x + block.width ||
          result.x + size.width <= block.x ||
          result.y >= block.y + block.height ||
          result.y + size.height <= block.y,
      ).toBe(true);
  }
});
