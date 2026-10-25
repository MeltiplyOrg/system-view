/**
 * Orthogonal wire routing around world-space obstacles.
 *
 * Design links are drawn before the component artwork, so a route that cuts
 * through a platform or a cluster frame is hidden for that stretch. Routes are
 * restricted to world X/Y segments to match the isometric grid, and a blocked
 * direct L is replaced by a detour that clears the blockers by a fixed margin.
 *
 * The router is deterministic and geometric only: it never inspects the
 * document or the DOM, and it returns world-space points that the scene
 * projects once per render.
 */

/** A world-space point on a cable route. */
export interface RoutePoint {
  x: number;
  y: number;
}

/** Axis-aligned world-space obstacle. */
export interface RouteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Gap between a detour lane and the obstacle edge, in world units.
 *
 * One platform margin (36) keeps the wire visibly outside the dashed cluster
 * frame and clear of the platform walls without pushing it into the next
 * cluster column.
 */
export const ROUTE_CLEARANCE = 36;

/** Floating-point tolerance for boundary contact, which is allowed. */
const EPSILON = 1e-6;

/**
 * Whether an axis-aligned segment passes through an obstacle's interior.
 *
 * Touching an edge or corner is allowed: cluster ports sit on the frame, and a
 * lane generated at `edge - ROUTE_CLEARANCE` must not be treated as a hit.
 * Non-axis-aligned segments cannot occur in a generated route.
 */
function crossesRect(a: RoutePoint, b: RoutePoint, rect: RouteRect): boolean {
  const left = rect.x,
    right = rect.x + rect.width,
    top = rect.y,
    bottom = rect.y + rect.height;
  if (a.y === b.y) {
    if (a.y <= top + EPSILON || a.y >= bottom - EPSILON) return false;
    const low = Math.min(a.x, b.x),
      high = Math.max(a.x, b.x);
    return high > left + EPSILON && low < right - EPSILON;
  }
  if (a.x === b.x) {
    if (a.x <= left + EPSILON || a.x >= right - EPSILON) return false;
    const low = Math.min(a.y, b.y),
      high = Math.max(a.y, b.y);
    return high > top + EPSILON && low < bottom - EPSILON;
  }
  // Generated routes are orthogonal; this guard keeps an accidental diagonal
  // from being silently reported as clear.
  throw new Error("Wire route segment is not axis-aligned.");
}

/** Whether every segment of a route avoids all obstacle interiors. */
function isClear(
  points: readonly RoutePoint[],
  obstacles: readonly RouteRect[],
): boolean {
  for (let index = 1; index < points.length; index++) {
    for (const obstacle of obstacles) {
      if (crossesRect(points[index - 1], points[index], obstacle)) return false;
    }
  }
  return true;
}

/** Drop repeated points and collinear intermediates to keep the path simple. */
function compact(points: readonly RoutePoint[]): RoutePoint[] {
  const unique: RoutePoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    unique.push({ ...point });
    while (unique.length >= 3) {
      const a = unique[unique.length - 3],
        b = unique[unique.length - 2],
        c = unique[unique.length - 1];
      const collinear =
        (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (!collinear) break;
      unique.splice(unique.length - 2, 1);
    }
  }
  return unique;
}

/** Manhattan length of an orthogonal route. */
function routeLength(points: readonly RoutePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++)
    length +=
      Math.abs(points[index].x - points[index - 1].x) +
      Math.abs(points[index].y - points[index - 1].y);
  return length;
}

/**
 * Route an orthogonal cable between two anchors while avoiding obstacles.
 *
 * The direct X-then-Y corner is preferred because it matches the original
 * scene routing. If it is blocked, the Y-then-X corner is tried, then detour
 * lanes above, below, left, and right of the obstacles crossed by those two
 * direct paths. A lane is only accepted when the complete path is clear, and
 * the shortest clear candidate wins.
 *
 * @param start - World-space anchor the cable leaves (already outside any
 *   cluster frame when the endpoint is ported).
 * @param end - World-space anchor the cable reaches.
 * @param obstacles - Cluster frames and unclustered platform footprints.
 * @returns A compact path from `start` to `end`. When no candidate is clear,
 *   the direct X-then-Y path is returned so the scene still draws a cable.
 */
export function routeOrthogonal(
  start: RoutePoint,
  end: RoutePoint,
  obstacles: readonly RouteRect[],
): RoutePoint[] {
  const xThenY = compact([start, { x: end.x, y: start.y }, end]);
  if (isClear(xThenY, obstacles)) return xThenY;
  const yThenX = compact([start, { x: start.x, y: end.y }, end]);
  if (isClear(yThenX, obstacles)) return yThenX;

  const blockers = new Set<RouteRect>();
  for (const path of [xThenY, yThenX])
    for (let index = 1; index < path.length; index++)
      for (const obstacle of obstacles)
        if (crossesRect(path[index - 1], path[index], obstacle))
          blockers.add(obstacle);

  const candidates: RoutePoint[][] = [];
  for (const rect of blockers) {
    const top = rect.y - ROUTE_CLEARANCE,
      bottom = rect.y + rect.height + ROUTE_CLEARANCE,
      left = rect.x - ROUTE_CLEARANCE,
      right = rect.x + rect.width + ROUTE_CLEARANCE;
    candidates.push(
      compact([start, { x: start.x, y: top }, { x: end.x, y: top }, end]),
      compact([start, { x: start.x, y: bottom }, { x: end.x, y: bottom }, end]),
      compact([start, { x: left, y: start.y }, { x: left, y: end.y }, end]),
      compact([start, { x: right, y: start.y }, { x: right, y: end.y }, end]),
    );
  }

  let best: RoutePoint[] | undefined;
  let bestLength = Infinity;
  for (const candidate of candidates) {
    if (!isClear(candidate, obstacles)) continue;
    const length = routeLength(candidate);
    if (length < bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  return best ?? xThenY;
}
