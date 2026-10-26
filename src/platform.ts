import { project } from "./database";
import type { PlacedInstance } from "./design";
import { instanceFootprint, isWireJunction } from "./layout";

/** A world-space X/Y vertex; platform contours never carry elevation. */
type Point = readonly [number, number];

/**
 * One merged base at a single elevation.
 *
 * `contours` are closed loops in world coordinates. Outer loops have positive
 * signed area and holes negative (using the shoelace convention); SVG uses
 * `fill-rule="evenodd"` so either direction renders correctly.
 */
export interface PlatformFootprint {
  elevation: number;
  contours: Point[][];
}

/**
 * A directed boundary segment in the compressed occupancy grid.
 *
 * `start`/`end` are flattened vertex indices (`y * stride + x`). `direction`
 * is 0=right, 1=down, 2=left, 3=up in world coordinates, which lets contour
 * tracing prefer the correct right turn at ambiguous corners.
 */
interface Edge {
  start: number;
  end: number;
  direction: number;
}

/**
 * Resolve a compressed-grid coordinate index.
 *
 * Every rectangle edge must appear in the coordinate table established above.
 * A miss indicates an internal construction bug, so failing loudly is safer
 * than silently producing an open contour.
 */
function coordinateIndex(
  map: ReadonlyMap<number, number>,
  key: number,
): number {
  const index = map.get(key);
  if (index === undefined)
    throw new Error(`Platform boundary coordinate not indexed: ${key}`);
  return index;
}

/**
 * Union the actual rack feet and provider footprints at each elevation.
 *
 * Disconnected islands and enclosed holes remain empty; only coplanar,
 * touching/overlapping bases merge. This is a true union, not a bounding box
 * or convex hull, so distant racks never connect across empty space. Each
 * footprint is a rectangle centered on `position` with the half extents from
 * `instanceFootprint` — the shared 288 × 150 rack foot by default, or the
 * provider's own shape (the Redis cache is square).
 *
 * The algorithm coordinate-compresses rectangle edges, fills a bit grid,
 * emits only boundary edges, then traces directed loops with a right-turn
 * preference. The right turn keeps diagonally touching islands separate
 * instead of pinching them into one self-touching contour. Collinear vertices
 * are dropped to reduce SVG path size.
 *
 * Runs once per design change, never inside the animation loop.
 *
 * @param instances - Validated instances; position, type, and provider drive
 *   the footprint.
 * @returns Platforms sorted by ascending elevation; empty for no instances.
 * @throws Error only if an internal lookup or contour closure invariant fails.
 */
export function mergePlatformFootprints(
  instances: readonly PlacedInstance[],
): PlatformFootprint[] {
  // Elevation is exact: racks on different floors must not share a base, and
  // inputs are validated numbers, so no epsilon merge is appropriate.
  const levels = new Map<number, PlacedInstance[]>();
  for (const instance of instances) {
    if (isWireJunction(instance.type)) continue;
    const level = levels.get(instance.position.z);
    if (level) level.push(instance);
    else levels.set(instance.position.z, [instance]);
  }

  const platforms: PlatformFootprint[] = [];
  for (const [elevation, group] of levels) {
    const rectangles = group.map(({ position, type, provider }) => {
      const { halfWidth, halfDepth } = instanceFootprint(type, provider);
      return {
        x0: position.x - halfWidth,
        x1: position.x + halfWidth,
        y0: position.y - halfDepth,
        y1: position.y + halfDepth,
      };
    });

    // Compression keeps the occupancy grid proportional to distinct edges
    // rather than to arbitrary world coordinates or off-screen space.
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

    // Half-open intervals avoid double-filling shared rectangle edges.
    for (const rectangle of rectangles) {
      const left = coordinateIndex(xIndex, rectangle.x0),
        right = coordinateIndex(xIndex, rectangle.x1);
      const top = coordinateIndex(yIndex, rectangle.y0),
        bottom = coordinateIndex(yIndex, rectangle.y1);
      for (let y = top; y < bottom; y++)
        occupied.fill(1, y * width + left, y * width + right);
    }

    // Emit boundary edges in clockwise order (top→right→bottom→left). The
    // filled cells stay on the right side of travel, which makes the
    // right-turn rule below produce simple, disambiguated contours.
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

    // Index outgoing edges by start vertex for O(1) contour following.
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
        const candidates = outgoing.get(edge.end);
        if (!candidates)
          throw new Error(`Unclosed platform boundary at ${edge.end}`);

        // Right turn first keeps corner-touching islands as separate loops.
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

      // Remove collinear vertices; the cross product is zero for a straight
      // run. This is purely geometric cleanup and does not change the shape.
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

/**
 * Render all merged footprints as one SVG group.
 *
 * The compound top path uses `evenodd` so enclosed holes stay open. Side walls
 * are emitted only for boundary edges whose outward normal faces the camera;
 * decorative screws sit on long convex corners. The result is static markup
 * with no listeners, created fresh for each design render.
 */
export function createPlatforms(
  instances: readonly PlacedInstance[],
): SVGGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("platforms");

  for (const { elevation, contours } of mergePlatformFootprints(instances)) {
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
      // The top face is one even-odd subpath per contour, including holes.
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

        // Only edges moving left or down in world space face the viewer.
        // Others are hidden behind the top face or the rack volume.
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

        // A screw belongs only on a convex corner with enough rail length on
        // both sides; the cross product tests turn direction.
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
