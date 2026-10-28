import { expect, test } from "vite-plus/test";
import {
  appendTrail,
  createTrail,
  pointOnTrail,
  type Trail,
} from "../src/traffic-trails";

const at = (trail: Trail, distance: number) => {
  const point = pointOnTrail(trail, distance);
  return point.map((value) => Number(value.toFixed(3)));
};

test("appended legs accumulate distance and bridge socket changes", () => {
  const trail = createTrail();
  appendTrail(trail, [
    [0, 0],
    [100, 0],
  ]);
  appendTrail(trail, [
    [100, 0],
    [100, 50],
  ]);
  expect(trail.points).toEqual([
    [0, 0],
    [100, 0],
    [100, 50],
  ]);
  expect(trail.total).toBe(150);
  expect(at(trail, 0)).toEqual([0, 0]);
  expect(at(trail, 50)).toEqual([50, 0]);
  expect(at(trail, 100)).toEqual([100, 0]);
  expect(at(trail, 125)).toEqual([100, 25]);
  expect(at(trail, 999)).toEqual([100, 50]);
});

test("new lanes bridge a different socket without duplicating shared points", () => {
  const trail = createTrail();
  appendTrail(trail, [
    [0, 0],
    [10, 0],
  ]);
  appendTrail(trail, [
    [20, 0],
    [30, 0],
  ]);
  expect(trail.points).toEqual([
    [0, 0],
    [10, 0],
    [20, 0],
    [30, 0],
  ]);
  expect(trail.total).toBe(30);
  expect(at(trail, 20)).toEqual([20, 0]);
  appendTrail(trail, [
    [30, 0],
    [30, 5],
  ]);
  expect(trail.total).toBe(35);
});

test("empty, single-point and zero-length trails stay finite", () => {
  const trail = createTrail();
  expect(pointOnTrail(trail, 10)).toEqual([0, 0]);
  appendTrail(trail, [[7, 9]]);
  expect(at(trail, 100)).toEqual([7, 9]);
  expect(trail.total).toBe(0);
  appendTrail(trail, [
    [7, 9],
    [7, 9],
  ]);
  expect(trail.points).toHaveLength(1);
  expect(at(trail, 1)).toEqual([7, 9]);
});
