/** Stage-local CSS pixels; unlike world coordinates, these never pass through the isometric projection. */
export interface CalloutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}

/** A label card and the screen rectangle of the node it describes. */
export interface OverviewLabel {
  key: string;
  rect: CalloutRect;
  size: Size;
}

/** A placed overview card and the node edge its leader points to. */
export interface OverviewPlacement {
  key: string;
  x: number;
  y: number;
  anchor: Point;
}

const OVERVIEW_DIRECTIONS = [
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
] as const;
const OVERVIEW_RADII = [0, 12, 28, 48, 72, 100, 132, 170, 212] as const;

function overlapArea(first: CalloutRect, second: CalloutRect): number {
  return (
    Math.max(
      0,
      Math.min(first.x + first.width, second.x + second.width) -
        Math.max(first.x, second.x),
    ) *
    Math.max(
      0,
      Math.min(first.y + first.height, second.y + second.height) -
        Math.max(first.y, second.y),
    )
  );
}

function envelope(rects: readonly CalloutRect[]): CalloutRect {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The point on a node edge that faces the label direction. */
function edgeAnchor(rect: CalloutRect, direction: Point): Point {
  const centerX = rect.x + rect.width / 2,
    centerY = rect.y + rect.height / 2;
  return {
    x: centerX + direction.x * (rect.width / 2),
    y: centerY + direction.y * (rect.height / 2),
  };
}

/** Does the leader from an edge to the nearest card corner cross a node? */
export function leaderCrosses(
  anchor: Point,
  card: CalloutRect,
  obstacles: readonly CalloutRect[],
): number {
  const corners = [
    { x: card.x, y: card.y },
    { x: card.x + card.width, y: card.y },
    { x: card.x, y: card.y + card.height },
    { x: card.x + card.width, y: card.y + card.height },
  ];
  const target = corners.reduce((best, corner) =>
    Math.hypot(corner.x - anchor.x, corner.y - anchor.y) <
    Math.hypot(best.x - anchor.x, best.y - anchor.y)
      ? corner
      : best,
  );
  const x0 = Math.min(anchor.x, target.x),
    x1 = Math.max(anchor.x, target.x),
    y0 = Math.min(anchor.y, target.y),
    y1 = Math.max(anchor.y, target.y);
  let crossings = 0;
  for (const block of obstacles) {
    if (
      x1 <= block.x + 1 ||
      x0 >= block.x + block.width - 1 ||
      y1 <= block.y + 1 ||
      y0 >= block.y + block.height - 1
    )
      continue;
    const dx = target.x - anchor.x,
      dy = target.y - anchor.y;
    let start = 0,
      end = 1;
    const edge = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const ratio = q / p;
      if (p < 0) {
        if (ratio > end) return false;
        if (ratio > start) start = ratio;
      } else {
        if (ratio < start) return false;
        if (ratio < end) end = ratio;
      }
      return true;
    };
    if (
      edge(-dx, anchor.x - (block.x + 1)) &&
      edge(dx, block.x + block.width - 1 - anchor.x) &&
      edge(-dy, anchor.y - (block.y + 1)) &&
      edge(dy, block.y + block.height - 1 - anchor.y) &&
      start < end
    )
      crossings++;
  }
  return crossings;
}

/**
 * Place every overview card outward from its node, then let colliding cards
 * slide to the next side or radius. Cards never prefer a single corner: the
 * direction order starts on the side facing away from the architecture centre,
 * so the overview surrounds the drawing instead of stacking labels at top-right.
 */
export function placeOverviewLabels(
  labels: readonly OverviewLabel[],
  viewport: Size,
  obstacles: readonly CalloutRect[],
  reserved: readonly CalloutRect[],
): OverviewPlacement[] {
  if (!labels.length) return [];
  const content = envelope(labels.map((label) => label.rect)),
    center = {
      x: content.x + content.width / 2,
      y: content.y + content.height / 2,
    };
  const placed: CalloutRect[] = [];
  const results = new Map<string, OverviewPlacement>();
  const margin = 12,
    gap = 10;
  const ordered = [...labels].sort(
    (first, second) =>
      first.rect.y - second.rect.y || first.rect.x - second.rect.x,
  );
  for (const label of ordered) {
    const centerX = label.rect.x + label.rect.width / 2,
      centerY = label.rect.y + label.rect.height / 2,
      outwardX = centerX - center.x,
      outwardY = centerY - center.y,
      outwardLength = Math.hypot(outwardX, outwardY) || 1,
      directions = [...OVERVIEW_DIRECTIONS]
        .map((direction) => ({
          direction,
          outward:
            (direction.x * outwardX + direction.y * outwardY) / outwardLength,
        }))
        .sort(
          (first, second) =>
            second.outward - first.outward ||
            first.direction.x - second.direction.x ||
            first.direction.y - second.direction.y,
        );
    let bestScore = Infinity,
      best: OverviewPlacement | null = null;
    for (const [rank, direction] of directions.entries()) {
      const { direction: dir } = direction;
      const anchor = edgeAnchor(label.rect, dir);
      for (const radius of OVERVIEW_RADII) {
        const rawX =
          anchor.x +
          (dir.x > 0
            ? gap
            : dir.x < 0
              ? -label.size.width - gap
              : -label.size.width / 2) +
          dir.x * radius;
        const rawY =
          anchor.y +
          (dir.y > 0
            ? gap
            : dir.y < 0
              ? -label.size.height - gap
              : -label.size.height / 2) +
          dir.y * radius;
        const x = Math.min(
            Math.max(margin, viewport.width - margin - label.size.width),
            Math.max(margin, rawX),
          ),
          y = Math.min(
            Math.max(margin, viewport.height - margin - label.size.height),
            Math.max(margin, rawY),
          ),
          card = { x, y, width: label.size.width, height: label.size.height },
          cardCenter = {
            x: x + label.size.width / 2,
            y: y + label.size.height / 2,
          };
        let nodeOverlap = 0,
          cardOverlap = 0;
        for (const block of obstacles) nodeOverlap += overlapArea(card, block);
        for (const block of placed) cardOverlap += overlapArea(card, block);
        for (const block of reserved) cardOverlap += overlapArea(card, block);
        const score =
          nodeOverlap * 10_000 +
          cardOverlap * 10_000 +
          leaderCrosses(anchor, card, obstacles) * 800 +
          Math.hypot(rawX - x, rawY - y) * 100 +
          Math.hypot(cardCenter.x - centerX, cardCenter.y - centerY) +
          (1 - direction.outward) * 600 +
          rank * 4 +
          radius * 0.2;
        if (score < bestScore) {
          bestScore = score;
          best = { key: label.key, x, y, anchor };
        }
      }
    }
    // Every label has at least one candidate, so the loop always sets `best`.
    placed.push({
      x: best!.x,
      y: best!.y,
      width: label.size.width,
      height: label.size.height,
    });
    results.set(label.key, best!);
  }
  return labels.map((label) => results.get(label.key)!);
}

/**
 * Place a CSS-sized tooltip inside the viewport, preferring above-right and
 * avoiding overlay rectangles. When no collision-free placement fits, choose
 * the least-covered candidate. Geometry is pure; pointer movement reads no DOM.
 */
export function placeCallout(
  anchor: Point,
  card: Size,
  viewport: Size,
  blockers: readonly CalloutRect[],
): Point {
  const margin = 12,
    gap = 8,
    offsetX = 41.6,
    offsetY = 64;
  const maxX = Math.max(margin, viewport.width - margin - card.width);
  const maxY = Math.max(margin, viewport.height - margin - card.height);
  const preferredX = Math.min(maxX, Math.max(margin, anchor.x + offsetX));
  const preferredY = Math.min(
    maxY,
    Math.max(margin, anchor.y - offsetY - card.height),
  );
  let bestX = preferredX,
    bestY = preferredY,
    bestOverlap = Infinity,
    bestDistance = Infinity;
  for (let candidate = 0; candidate < 4 + blockers.length * 4; candidate++) {
    let x: number, y: number;
    if (candidate < 4) {
      x = candidate % 2 ? anchor.x - offsetX - card.width : anchor.x + offsetX;
      y = candidate < 2 ? anchor.y - offsetY - card.height : anchor.y + offsetY;
    } else {
      const block = blockers[Math.floor((candidate - 4) / 4)];
      switch ((candidate - 4) % 4) {
        case 0:
          x = block.x + block.width + gap;
          y = preferredY;
          break;
        case 1:
          x = block.x - card.width - gap;
          y = preferredY;
          break;
        case 2:
          x = preferredX;
          y = block.y + block.height + gap;
          break;
        default:
          x = preferredX;
          y = block.y - card.height - gap;
          break;
      }
    }
    x = Math.min(maxX, Math.max(margin, x));
    y = Math.min(maxY, Math.max(margin, y));
    let overlap = 0;
    for (const block of blockers)
      overlap +=
        Math.max(
          0,
          Math.min(x + card.width, block.x + block.width) -
            Math.max(x, block.x),
        ) *
        Math.max(
          0,
          Math.min(y + card.height, block.y + block.height) -
            Math.max(y, block.y),
        );
    const dx = x - preferredX,
      dy = y - preferredY,
      distance = dx * dx + dy * dy;
    if (
      overlap < bestOverlap ||
      (overlap === bestOverlap && distance < bestDistance)
    ) {
      bestX = x;
      bestY = y;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  return { x: bestX, y: bestY };
}
