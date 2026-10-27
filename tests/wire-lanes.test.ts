import { expect, test } from "vite-plus/test";
import { cableLane } from "../src/wire-lanes";

test("parallel lanes separate straight traffic while preserving shared socket leads", () => {
  const route = [
    [0, 0],
    [100, 0],
  ];
  const out = cableLane(route, 7),
    back = cableLane(route, -7);
  for (const lane of [out, back]) {
    expect(lane.points[0]).toEqual(route[0]);
    expect(lane.points.at(-1)).toEqual(route.at(-1));
    expect(lane.points[1][1]).toBe(0);
    expect(lane.points.at(-2)![1]).toBe(0);
    expect(lane.total).toBeGreaterThan(100);
  }
  expect(out.points[2][1]).toBe(7);
  expect(back.points[2][1]).toBe(-7);
});

test("bends offset continuously without moving logical ports or producing spikes", () => {
  const route = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const out = cableLane(route, 7),
    back = cableLane(route, -7);
  expect(out.points[3]).toEqual([93, 7]);
  expect(back.points[3]).toEqual([107, -7]);
  expect(out.points[4]).toEqual([93, 93]);
  expect(back.points[4]).toEqual([107, 107]);
  const hairpin = cableLane(
    [
      [0, 0],
      [100, 0],
      [0, 0],
    ],
    7,
  );
  expect(hairpin.points.every((point) => point.every(Number.isFinite))).toBe(
    true,
  );
});

test("single lanes retain the route and degenerate short routes stay finite", () => {
  expect(
    cableLane([
      [0, 0],
      [0, 0],
      [10, 0],
    ]).d,
  ).toBe("M0 0L10 0");
  expect(
    cableLane(
      [
        [0, 0],
        [2, 0],
      ],
      7,
    ).total,
  ).toBeGreaterThan(2);
  expect(cableLane([[5, 5]], 7).total).toBe(0);
  expect(() => cableLane([])).toThrow(/point/);
});
