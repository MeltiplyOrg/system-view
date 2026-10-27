/** Screen-projected route geometry; endpoints remain at the router's exact logical sockets. */
export interface CableLane {
  points: readonly (readonly number[])[];
  lengths: number[];
  total: number;
  d: string;
}

/**
 * Offset a routed polyline into a distinct cable lane, tapering back to the
 * shared sockets. Signed offsets produce outbound/return paths. Short tangential
 * socket leads preserve perpendicular border entry. Miter joins follow bends;
 * the cap prevents near-reversals from making unbounded spikes. No layout reads.
 */
export function cableLane(
  input: readonly (readonly number[])[],
  offset = 0,
): CableLane {
  if (!input.length) throw new Error("A wire route needs at least one point.");
  let points = input.filter(
    (point, i) =>
      !i || point[0] !== input[i - 1][0] || point[1] !== input[i - 1][1],
  );
  if (offset && points.length > 1) {
    const directions = points.slice(1).map((point, i) => {
      const dx = point[0] - points[i][0],
        dy = point[1] - points[i][1],
        length = Math.hypot(dx, dy);
      return { x: dx / length, y: dy / length, length };
    });
    const first = points[0],
      last = points.at(-1)!,
      a = directions[0],
      b = directions.at(-1)!;
    const leadA = Math.min(14, a.length / 4),
      leadB = Math.min(14, b.length / 4);
    const inner = points.slice(1, -1).map((point, i) => {
      const before = directions[i],
        after = directions[i + 1];
      const nx = -before.y - after.y,
        ny = before.x + after.x;
      const denominator = 1 + before.x * after.x + before.y * after.y;
      const miter = Math.min(2.5, 1 / Math.max(0.4, denominator)) * offset;
      return [point[0] + nx * miter, point[1] + ny * miter];
    });
    points = [
      first,
      [first[0] + a.x * leadA, first[1] + a.y * leadA],
      [
        first[0] + a.x * leadA * 2 - a.y * offset,
        first[1] + a.y * leadA * 2 + a.x * offset,
      ],
      ...inner,
      [
        last[0] - b.x * leadB * 2 - b.y * offset,
        last[1] - b.y * leadB * 2 + b.x * offset,
      ],
      [last[0] - b.x * leadB, last[1] - b.y * leadB],
      last,
    ];
  }
  const lengths = points
    .slice(1)
    .map((point, i) =>
      Math.hypot(point[0] - points[i][0], point[1] - points[i][1]),
    );
  return {
    points,
    lengths,
    total: lengths.reduce((sum, length) => sum + length, 0),
    d: points.map((point, i) => `${i ? "L" : "M"}${point.join(" ")}`).join(""),
  };
}
