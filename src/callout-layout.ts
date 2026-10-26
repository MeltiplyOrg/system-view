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
