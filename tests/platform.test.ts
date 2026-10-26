/**
 * Platform-union tests. They assert real footprint topology (islands, holes,
 * L-shapes, elevation separation), not only that a path string was emitted.
 */
import { expect, test } from "vite-plus/test";
import type { PlacedInstance } from "../src/design";
import { mergePlatformFootprints } from "../src/platform";

/** Minimal validated instance with a centered 288 × 150 foot. */
function rack(id: string, x: number, y: number, z = 0): PlacedInstance {
  return {
    id,
    type: "database-rack",
    label: id,
    color: "#ff9d52",
    position: { x, y, z },
  };
}
/**
 * Shoelace signed area. Positive means an outer contour; negative is a hole.
 * Tests use the sign to prove the ring case stays hollow.
 */
function area(contour: readonly (readonly [number, number])[]): number {
  return (
    contour.reduce((sum, p, i) => {
      const q = contour[(i + 1) % contour.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2
  );
}

test("overlapping feet form one seamless base while cabinets have breathing room", () => {
  const platforms = mergePlatformFootprints([
    rack("a", 0, 0),
    rack("b", 0, 128),
    rack("c", 0, 256),
  ]);
  expect(platforms).toHaveLength(1);
  expect(platforms[0].contours).toEqual([
    [
      [-144, -75],
      [144, -75],
      [144, 331],
      [-144, 331],
    ],
  ]);
  expect(area(platforms[0].contours[0])).toBe(288 * 406);
});

test("distant racks stay on separate islands rather than filling their bounding box", () => {
  const [platform] = mergePlatformFootprints([
    rack("a", 0, 0),
    rack("b", 1000, 0),
  ]);
  expect(platform.contours).toHaveLength(2);
  expect(platform.contours.reduce((sum, c) => sum + area(c), 0)).toBe(
    2 * 288 * 150,
  );
});

test("an L-shaped group keeps the empty corner and removes shared interior edges", () => {
  const [platform] = mergePlatformFootprints([
    rack("a", 0, 0),
    rack("b", 288, 0),
    rack("c", 0, 150),
  ]);
  expect(platform.contours).toHaveLength(1);
  expect(platform.contours[0]).toHaveLength(6);
  expect(area(platform.contours[0])).toBe(3 * 288 * 150);
});

test("a ring retains its hole instead of covering the empty center", () => {
  const instances: PlacedInstance[] = [];
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      if (x !== 1 || y !== 1)
        instances.push(rack(`${x}-${y}`, 288 * x, 150 * y));
  const [platform] = mergePlatformFootprints(instances);
  expect(platform.contours).toHaveLength(2);
  expect(platform.contours.map(area).sort((a, b) => a - b)).toEqual([
    -288 * 150,
    864 * 450,
  ]);
});

test("corner-touching feet remain distinct closed outlines", () => {
  const [platform] = mergePlatformFootprints([
    rack("a", 0, 0),
    rack("b", 288, 150),
  ]);
  expect(platform.contours).toHaveLength(2);
  expect(platform.contours.map(area)).toEqual([288 * 150, 288 * 150]);
});

test("overlapping bases at different elevations never merge", () => {
  const platforms = mergePlatformFootprints([
    rack("a", 0, 0),
    rack("b", 0, 0, 100),
  ]);
  expect(platforms.map((p) => p.elevation)).toEqual([0, 100]);
  expect(platforms.map((p) => p.contours.map(area))).toEqual([
    [288 * 150],
    [288 * 150],
  ]);
});

test("routing junctions never create or bridge machine platforms", () => {
  const gate = { ...rack("branch-route", 160, 0), type: "branch" as const };
  const merge = { ...rack("merge-route", 400, 0), type: "merge" as const };
  expect(mergePlatformFootprints([gate, merge])).toEqual([]);
  const machines = [rack("left", 0, 0), rack("right", 560, 0)];
  expect(mergePlatformFootprints([...machines, gate, merge])).toEqual(
    mergePlatformFootprints(machines),
  );
});
