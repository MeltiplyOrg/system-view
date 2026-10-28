import { expect, test } from "vite-plus/test";
import {
  leaderCrosses,
  placeCallout,
  placeOverviewLabels,
} from "../src/callout-layout";

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

/** Four corner nodes with one label each; cards must not cover any node. */
test("overview labels surround their nodes without covering artwork", () => {
  const viewport = { width: 1200, height: 800 },
    nodes = [
      { x: 250, y: 140, width: 90, height: 70 },
      { x: 850, y: 140, width: 90, height: 70 },
      { x: 250, y: 590, width: 90, height: 70 },
      { x: 850, y: 590, width: 90, height: 70 },
    ],
    labels = nodes.map((rect, index) => ({
      key: `node-${index}`,
      rect,
      size: { width: 150, height: 50 },
    })),
    reserved = [{ x: 1060, y: 16, width: 120, height: 40 }],
    placements = placeOverviewLabels(labels, viewport, nodes, reserved);
  expect(placements).toHaveLength(4);
  for (const placement of placements) {
    const card = {
      x: placement.x,
      y: placement.y,
      width: 150,
      height: 50,
    };
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
    expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
    for (const node of nodes)
      expect(
        card.x + card.width <= node.x ||
          card.x >= node.x + node.width ||
          card.y + card.height <= node.y ||
          card.y >= node.y + node.height,
      ).toBe(true);
    expect(
      card.x + card.width <= reserved[0].x ||
        card.x >= reserved[0].x + reserved[0].width ||
        card.y + card.height <= reserved[0].y ||
        card.y >= reserved[0].y + reserved[0].height,
    ).toBe(true);
  }
  for (let first = 0; first < placements.length; first++)
    for (let second = first + 1; second < placements.length; second++)
      expect(
        placements[first].x + 150 <= placements[second].x ||
          placements[first].x >= placements[second].x + 150 ||
          placements[first].y + 50 <= placements[second].y ||
          placements[first].y >= placements[second].y + 50,
      ).toBe(true);
  const placed = placements.map((placement) => ({
    x: placement.x,
    y: placement.y,
  }));
  expect(placed[0].x).toBeLessThan(nodes[0].x);
  expect(placed[1].x).toBeGreaterThan(nodes[1].x);
  expect(placed[2].y).toBeGreaterThan(nodes[2].y);
  expect(placed[3].x).toBeGreaterThan(nodes[3].x);
});

test("overview handles empty input and a label at the content centre", () => {
  expect(placeOverviewLabels([], { width: 800, height: 600 }, [], [])).toEqual(
    [],
  );
  const center = { x: 350, y: 250, width: 100, height: 80 };
  const [placement] = placeOverviewLabels(
    [{ key: "center", rect: center, size: { width: 140, height: 50 } }],
    { width: 800, height: 600 },
    [center],
    [],
  );
  expect(placement.key).toBe("center");
  expect(placement.x).toBeGreaterThanOrEqual(0);
  expect(placement.y).toBeGreaterThanOrEqual(0);
  expect(placement.x + 140).toBeLessThanOrEqual(800);
  expect(placement.y + 50).toBeLessThanOrEqual(600);
});

test("leaders detect crossings in both directions and ignore parallel misses", () => {
  const block = { x: 40, y: 40, width: 20, height: 20 };
  expect(
    leaderCrosses({ x: 0, y: 50 }, { x: 100, y: 40, width: 10, height: 20 }, [
      block,
    ]),
  ).toBe(1);
  expect(
    leaderCrosses({ x: 100, y: 50 }, { x: 0, y: 40, width: 10, height: 20 }, [
      block,
    ]),
  ).toBe(1);
  expect(
    leaderCrosses({ x: 50, y: 0 }, { x: 40, y: 100, width: 20, height: 10 }, [
      block,
    ]),
  ).toBe(1);
  expect(
    leaderCrosses({ x: 50, y: 0 }, { x: 50, y: 100, width: 10, height: 10 }, [
      block,
    ]),
  ).toBe(1);
  expect(
    leaderCrosses({ x: 20, y: 50 }, { x: 40, y: 50, width: 10, height: 10 }, [
      block,
    ]),
  ).toBe(0);
  expect(
    leaderCrosses({ x: 0, y: 0 }, { x: 100, y: 0, width: 10, height: 10 }, [
      block,
    ]),
  ).toBe(0);
  expect(
    leaderCrosses({ x: 0, y: 50 }, { x: 100, y: 40, width: 10, height: 20 }, [
      { x: 40, y: 90, width: 20, height: 20 },
    ]),
  ).toBe(0);
});
