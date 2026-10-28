/**
 * Cable caption geometry tests.
 *
 * The scene's DOM wiring is covered by Playwright; this pins the pure
 * midpoint/offset math that keeps every relation label attached to its
 * projected route.
 */
import { describe, expect, test } from "vite-plus/test";
import { cableLabelPoint } from "../src/scene";

type Path = readonly (readonly [number, number])[];

/** Round a point to three decimals so projected trig is easy to assert. */
const rounded = (point: readonly [number, number] | null): number[] | null =>
  point?.map((value) => Number(value.toFixed(3))) ?? null;

const horizontal: Path = [
    [0, 0],
    [100, 0],
  ],
  corner: Path = [
    [0, 0],
    [300, 0],
    [300, 100],
  ],
  diagonal: Path = [
    [0, 0],
    [100, 100],
  ],
  point: Path = [[5, 5]];

describe("cable relation labels", () => {
  test("centers on a straight cable and lifts above it", () => {
    expect(rounded(cableLabelPoint(horizontal, 10))).toEqual([50, -10]);
  });

  test("uses the whole projected path instead of the middle vertex", () => {
    expect(rounded(cableLabelPoint(corner, 10))).toEqual([200, -10]);
  });

  test("can place a caption away from the midpoint to avoid collisions", () => {
    expect(rounded(cableLabelPoint(corner, 10, 0.25))).toEqual([100, -10]);
    expect(rounded(cableLabelPoint(corner, 10, 0.8))).toEqual([290, 20]);
  });

  test("follows the normal on a sloped isometric segment", () => {
    const [x, y] = cableLabelPoint(diagonal, 10)!;
    expect(x).toBeCloseTo(57.071, 3);
    expect(y).toBeCloseTo(42.929, 3);
    expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(10, 3);
  });

  test("returns null for paths with no drawable segment", () => {
    expect(cableLabelPoint([], 10)).toBeNull();
    expect(cableLabelPoint(point, 10)).toBeNull();
    expect(cableLabelPoint([...point, ...point], 10)).toBeNull();
  });
});
