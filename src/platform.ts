import type { DatabaseNode } from "./design";
import { project } from "./database";

type Point = readonly [number, number];
export interface PlatformFootprint {
  elevation: number;
  contours: Point[][];
}
interface Edge {
  start: number;
  end: number;
  direction: number;
}

/** Union of the actual 288 × 150 rack feet, not a bounding box or convex hull.
 * Disconnected islands and holes remain empty; only coplanar bases can merge.
 * Runs on design changes, never in the animation loop.
 */
export function mergePlatformFootprints(
  nodes: readonly DatabaseNode[],
): PlatformFootprint[] {
  const levels = new Map<number, DatabaseNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.position.z);
    if (level) level.push(node);
    else levels.set(node.position.z, [node]);
  }
  const platforms: PlatformFootprint[] = [];
  for (const [elevation, group] of levels) {
    const rectangles = group.map(({ position }) => ({
      x0: position.x - 144,
      x1: position.x + 144,
      y0: position.y - 75,
      y1: position.y + 75,
    }));
    const xs = [...new Set(rectangles.flatMap((r) => [r.x0, r.x1]))].sort(
      (a, b) => a - b,
    );
    const ys = [...new Set(rectangles.flatMap((r) => [r.y0, r.y1]))].sort(
      (a, b) => a - b,
    );
    const xIndex = new Map(xs.map((x, i) => [x, i])),
      yIndex = new Map(ys.map((y, i) => [y, i]));
    const width = xs.length - 1,
      height = ys.length - 1,
      stride = xs.length;
    const occupied = new Uint8Array(width * height);
    for (const rectangle of rectangles) {
      const left = xIndex.get(rectangle.x0)!,
        right = xIndex.get(rectangle.x1)!;
      const top = yIndex.get(rectangle.y0)!,
        bottom = yIndex.get(rectangle.y1)!;
      for (let y = top; y < bottom; y++)
        occupied.fill(1, y * width + left, y * width + right);
    }
    const edges: Edge[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!occupied[y * width + x]) continue;
        const tl = y * stride + x,
          tr = tl + 1,
          bl = tl + stride,
          br = bl + 1;
        if (y === 0 || !occupied[(y - 1) * width + x])
          edges.push({ start: tl, end: tr, direction: 0 });
        if (x === width - 1 || !occupied[y * width + x + 1])
          edges.push({ start: tr, end: br, direction: 1 });
        if (y === height - 1 || !occupied[(y + 1) * width + x])
          edges.push({ start: br, end: bl, direction: 2 });
        if (x === 0 || !occupied[y * width + x - 1])
          edges.push({ start: bl, end: tl, direction: 3 });
      }
    const outgoing = new Map<number, number[]>();
    for (let i = 0; i < edges.length; i++) {
      const list = outgoing.get(edges[i].start);
      if (list) list.push(i);
      else outgoing.set(edges[i].start, [i]);
    }
    const visited = new Uint8Array(edges.length),
      contours: Point[][] = [];
    for (let first = 0; first < edges.length; first++) {
      if (visited[first]) continue;
      const points: Point[] = [];
      let current = first;
      do {
        const edge = edges[current];
        visited[current] = 1;
        points.push([
          xs[edge.start % stride],
          ys[Math.floor(edge.start / stride)],
        ]);
        if (edge.end === edges[first].start) break;
        const candidates = outgoing.get(edge.end)!;
        // Right turn first keeps corner-touching islands as separate contours.
        let next = -1;
        for (const direction of [
          (edge.direction + 1) % 4,
          edge.direction,
          (edge.direction + 3) % 4,
        ]) {
          next =
            candidates.find(
              (index) =>
                !visited[index] && edges[index].direction === direction,
            ) ?? -1;
          if (next !== -1) break;
        }
        if (next === -1) throw new Error("Could not close platform boundary.");
        current = next;
      } while (current !== first);
      contours.push(
        points.filter((point, i) => {
          const before = points[(i + points.length - 1) % points.length],
            after = points[(i + 1) % points.length];
          return (
            (point[0] - before[0]) * (after[1] - point[1]) !==
            (point[1] - before[1]) * (after[0] - point[0])
          );
        }),
      );
    }
    platforms.push({ elevation, contours });
  }
  return platforms.sort((a, b) => a.elevation - b.elevation);
}

export function createPlatforms(nodes: readonly DatabaseNode[]): SVGGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("platforms");
  for (const { elevation, contours } of mergePlatformFootprints(nodes)) {
    const platform = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    platform.classList.add("shared-platform");
    platform.dataset.elevation = String(elevation);
    let top = "",
      walls = "",
      screws = "";
    for (const contour of contours) {
      top +=
        "M" +
        contour
          .map(([x, y]) => project(x, y, elevation + 7).join(" "))
          .join("L") +
        "Z";
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i],
          b = contour[(i + 1) % contour.length],
          previous = contour[(i + contour.length - 1) % contour.length];
        if (b[0] < a[0] || b[1] > a[1]) {
          walls +=
            "M" +
            [
              project(...a, elevation),
              project(...b, elevation),
              project(...b, elevation + 7),
              project(...a, elevation + 7),
            ]
              .map((p) => p.join(" "))
              .join("L") +
            "Z";
        }
        const incoming = [a[0] - previous[0], a[1] - previous[1]],
          outgoing = [b[0] - a[0], b[1] - a[1]];
        const inLength = Math.hypot(...incoming),
          outLength = Math.hypot(...outgoing);
        if (
          incoming[0] * outgoing[1] - incoming[1] * outgoing[0] > 0 &&
          inLength >= 28 &&
          outLength >= 28
        ) {
          const x =
            a[0] -
            (incoming[0] / inLength) * 14 +
            (outgoing[0] / outLength) * 14;
          const y =
            a[1] -
            (incoming[1] / inLength) * 14 +
            (outgoing[1] / outLength) * 14;
          screws +=
            "M" +
            Array.from({ length: 12 }, (_, k) =>
              project(
                x + 3 * Math.cos((k * Math.PI) / 6),
                y + 3 * Math.sin((k * Math.PI) / 6),
                elevation + 7,
              ).join(" "),
            ).join("L") +
            "Z";
        }
      }
    }
    platform.innerHTML = `<path class="face platform-wall" d="${walls}"/><path class="face top platform-top" fill-rule="evenodd" d="${top}"/><path class="detail" d="${screws}"/>`;
    group.append(platform);
  }
  return group;
}
