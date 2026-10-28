/** Screen-projected path accumulated from successive simulation legs of one request branch. */
export interface Trail {
  points: [number, number][];
  lengths: number[];
  total: number;
}

/** Empty trail; callers append lanes as the simulation reveals each hop. */
export function createTrail(): Trail {
  return { points: [], lengths: [], total: 0 };
}

/**
 * Append a lane to a branch trail, bridging socket changes with one connector.
 * Duplicate consecutive points are dropped so zero-length segments cannot make
 * interpolation divide by zero. Mutates the caller-owned trail for 30Hz reuse.
 */
export function appendTrail(
  trail: Trail,
  lane: readonly (readonly number[])[],
): void {
  for (const point of lane) {
    const previous = trail.points.at(-1);
    if (previous && previous[0] === point[0] && previous[1] === point[1])
      continue;
    if (previous) {
      const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      trail.lengths.push(length);
      trail.total += length;
    }
    trail.points.push([point[0], point[1]]);
  }
}

/**
 * Point at a distance along the trail, clamped to its ends. Used to render a
 * fixed-velocity dot while the simulation clock runs at any time scale.
 */
export function pointOnTrail(trail: Trail, distance: number): [number, number] {
  const first = trail.points[0];
  if (!first) return [0, 0];
  if (distance <= 0 || trail.points.length === 1) return [...first];
  let remaining = distance;
  for (let index = 0; index < trail.lengths.length; index++) {
    const length = trail.lengths[index];
    if (remaining <= length || index === trail.lengths.length - 1) {
      const from = trail.points[index],
        to = trail.points[index + 1],
        ratio = length ? Math.min(1, remaining / length) : 0;
      return [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ];
    }
    remaining -= length;
  }
  return [...trail.points.at(-1)!];
}
