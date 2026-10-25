/**
 * Orthogonal wire routing tests.
 *
 * These pin the visible contract of the router: direct corners stay simple,
 * blocked cables detour around platform/cluster rectangles by the documented
 * clearance, and a degenerate column still finds a sideways lane.
 */
import { describe, expect, test } from "vite-plus/test";
import { ROUTE_CLEARANCE, routeOrthogonal } from "../src/routing";

/** Cache frame from the 10-replica simple-web-app layout. */
const cacheFrame = { x: 660, y: -111, width: 692, height: 926 };

describe("wire routing", () => {
  test("keeps the original X-then-Y corner when nothing blocks it", () => {
    expect(routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 100 }, [])).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  test("detours above a blocking cluster by the clearance", () => {
    const route = routeOrthogonal({ x: 420, y: 0 }, { x: 1382, y: 352 }, [
      cacheFrame,
    ]);
    expect(route).toEqual([
      { x: 420, y: 0 },
      { x: 420, y: cacheFrame.y - ROUTE_CLEARANCE },
      { x: 1382, y: cacheFrame.y - ROUTE_CLEARANCE },
      { x: 1382, y: 352 },
    ]);
  });

  test("takes a sideways lane when both endpoints share a column", () => {
    const blocker = { x: -50, y: 40, width: 100, height: 20 };
    const route = routeOrthogonal({ x: 0, y: 0 }, { x: 0, y: 100 }, [blocker]);
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: blocker.x - ROUTE_CLEARANCE, y: 0 },
      { x: blocker.x - ROUTE_CLEARANCE, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  test("leaves an unrelated obstacle untouched", () => {
    expect(
      routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 100 }, [
        { x: 200, y: 200, width: 50, height: 50 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });
});
