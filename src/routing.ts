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
 * Centerline distance below which two parallel wire segments read as one cable.
 * Duplex request/response lanes are 14 units apart, so that pair is allowed;
 * independent links must keep at least this gap to stay visually distinct.
 */
const WIRE_SEPARATION = 14;

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
 * Collinear overlap length between two axis-aligned segments, or zero when
 * they cross perpendicularly or stay farther apart than a distinct cable.
 */
function segmentOverlap(
  a: RoutePoint,
  b: RoutePoint,
  c: RoutePoint,
  d: RoutePoint,
): number {
  if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < WIRE_SEPARATION)
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
    );
  if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < WIRE_SEPARATION)
    return Math.max(
      0,
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
    );
  return 0;
}

/**
 * Length of collinear overlap between one route and already-routed cables.
 * Perpendicular crossings are free; only parallel segments closer than
 * `WIRE_SEPARATION` count, so independent links cannot hide inside one another.
 */
function collinearOverlap(
  points: readonly RoutePoint[],
  avoid: readonly (readonly RoutePoint[])[],
): number {
  let overlap = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    for (const route of avoid)
      for (let other = 1; other < route.length; other++)
        overlap += segmentOverlap(a, b, route[other - 1], route[other]);
  }
  return overlap;
}

/**
 * Thin blocker lanes only for existing segments that the direct candidates
 * would actually share. Adding every wire segment would explode the candidate
 * set on dense diagrams and produce needless detours.
 */
function existingCableRects(
  avoid: readonly (readonly RoutePoint[])[],
  direct: readonly (readonly RoutePoint[])[],
): RouteRect[] {
  const rects: RouteRect[] = [];
  for (const route of avoid)
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1],
        b = route[index];
      const shared = direct.some((path) => {
        for (let other = 1; other < path.length; other++)
          if (segmentOverlap(a, b, path[other - 1], path[other]) > EPSILON)
            return true;
        return false;
      });
      if (!shared) continue;
      if (a.y === b.y)
        rects.push({
          x: Math.min(a.x, b.x),
          y: a.y - 1,
          width: Math.abs(b.x - a.x),
          height: 2,
        });
      else
        rects.push({
          x: a.x - 1,
          y: Math.min(a.y, b.y),
          width: 2,
          height: Math.abs(b.y - a.y),
        });
    }
  return rects;
}

/**
 * Route an orthogonal cable between two anchors while avoiding obstacles and
 * already-routed cables.
 *
 * Direct X-then-Y stays preferred when it is clear and does not overlap an
 * existing route. Otherwise the Y-then-X corner and lanes around blocked
 * obstacles/cables are scored: minimum collinear overlap first, then shortest
 * clear path. Perpendicular crossings remain allowed because they read as
 * crossings, not merged cables.
 *
 * @param start - World-space anchor the cable leaves (already outside any
 *   cluster frame when the endpoint is ported).
 * @param end - World-space anchor the cable reaches.
 * @param obstacles - Cluster frames and unclustered platform footprints.
 * @param avoid - Routes already drawn in this render, used to reject long
 *   parallel corridors.
 * @returns A compact path from `start` to `end`. When no candidate is clear,
 *   the direct X-then-Y path is returned so the scene still draws a cable.
 */
export function routeOrthogonal(
  start: RoutePoint,
  end: RoutePoint,
  obstacles: readonly RouteRect[],
  avoid: readonly (readonly RoutePoint[])[] = [],
): RoutePoint[] {
  const xThenY = compact([start, { x: end.x, y: start.y }, end]),
    yThenX = compact([start, { x: start.x, y: end.y }, end]),
    xClear = isClear(xThenY, obstacles),
    yClear = isClear(yThenX, obstacles);
  if (xClear && collinearOverlap(xThenY, avoid) === 0) return xThenY;
  if (yClear && collinearOverlap(yThenX, avoid) === 0) return yThenX;
  if (!avoid.length) {
    if (xClear) return xThenY;
    if (yClear) return yThenX;
  }

  const blockers = new Set<RouteRect>();
  for (const path of [xThenY, yThenX])
    for (let index = 1; index < path.length; index++)
      for (const obstacle of obstacles)
        if (crossesRect(path[index - 1], path[index], obstacle))
          blockers.add(obstacle);
  for (const rect of existingCableRects(avoid, [xThenY, yThenX]))
    blockers.add(rect);

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
  // Clear direct paths remain candidates when a detour cannot beat their overlap.
  if (xClear) candidates.push(xThenY);
  if (yClear) candidates.push(yThenX);

  let best: RoutePoint[] | undefined;
  let bestOverlap = Infinity;
  let bestLength = Infinity;
  for (const candidate of candidates) {
    if (!isClear(candidate, obstacles)) continue;
    const overlap = collinearOverlap(candidate, avoid),
      length = routeLength(candidate);
    if (
      overlap < bestOverlap ||
      (overlap === bestOverlap && length < bestLength)
    ) {
      best = candidate;
      bestOverlap = overlap;
      bestLength = length;
    }
  }
  return best ?? xThenY;
}
