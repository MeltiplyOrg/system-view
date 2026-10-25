/**
 * Cluster port geometry tests.
 *
 * External links must terminate on the dashed cluster frame edge facing the
 * other endpoint. These cases pin the ray/edge selection, the lone-port
 * midpoint, and the equal, centered fan used when several cables share a side.
 */
import { describe, expect, test } from "vite-plus/test";
import type { PlacedCluster } from "../src/layout";
import { clusterPort, clusterPortSlot } from "../src/scene";

const cluster: PlacedCluster = {
  id: "users",
  label: "Users",
  bounds: { x: -144, y: -75, width: 288, height: 326 },
};

describe("cluster ports", () => {
  test("centers horizontal ports on the facing frame edge", () => {
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: -420, y: 0 })).toEqual({
      x: -180,
      y: 88,
      edge: "left",
    });
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: 420, y: 0 })).toEqual({
      x: 180,
      y: 88,
      edge: "right",
    });
  });

  test("picks the nearest edge for a diagonal or vertical target", () => {
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: 420, y: 420 })).toEqual({
      x: 180,
      y: 88,
      edge: "right",
    });
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: 0, y: -420 })).toEqual({
      x: 0,
      y: -111,
      edge: "top",
    });
  });

  test("centers a lone link regardless of which member it leaves from", () => {
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: -420, y: 0 })).toEqual(
      clusterPort(cluster, { x: 0, y: 200 }, { x: -420, y: 200 }),
    );
  });

  test("divides a shared side into equal, centered slots", () => {
    const left = [0, 1, 2].map((index) =>
        clusterPortSlot(cluster, "left", index, 3),
      ),
      right = [0, 1].map((index) =>
        clusterPortSlot(cluster, "right", index, 2),
      ),
      bottom = [0, 1, 2].map((index) =>
        clusterPortSlot(cluster, "bottom", index, 3),
      );

    // Left/right edges span y=-111..287 (expanded by the frame margin).
    expect(left.map(({ x }) => x)).toEqual([-180, -180, -180]);
    expect(left[0].y).toBeCloseTo(-44.667, 2);
    expect(left[1].y).toBeCloseTo(88, 5);
    expect(left[2].y).toBeCloseTo(220.667, 2);
    expect(left[0].y + left[2].y).toBeCloseTo(left[1].y * 2, 5);
    expect(right.map(({ x }) => x)).toEqual([180, 180]);
    expect(right[0].y).toBeCloseTo(-11.5, 5);
    expect(right[1].y).toBeCloseTo(187.5, 5);
    expect((right[0].y + right[1].y) / 2).toBeCloseTo(88, 5);

    // Top/bottom edges span x=-180..180 and divide at their segment midpoints.
    expect(bottom.map(({ y }) => y)).toEqual([287, 287, 287]);
    expect(bottom.map(({ x }) => x)).toEqual([-120, 0, 120]);
  });

  test("clamps a slot to the available side", () => {
    expect(clusterPortSlot(cluster, "left", 9, 2)).toEqual(
      clusterPortSlot(cluster, "left", 1, 2),
    );
    expect(clusterPortSlot(cluster, "left", 0, 0)).toEqual({
      x: -180,
      y: 88,
      edge: "left",
    });
  });

  test("keeps every port outside the rack footprint", () => {
    for (const target of [
      { x: -420, y: 0 },
      { x: 420, y: 0 },
      { x: 0, y: -420 },
      { x: 0, y: 420 },
      { x: 420, y: 420 },
    ]) {
      const port = clusterPort(cluster, { x: 0, y: 0 }, target);
      expect(
        port.x <= cluster.bounds.x ||
          port.x >= cluster.bounds.x + cluster.bounds.width ||
          port.y <= cluster.bounds.y ||
          port.y >= cluster.bounds.y + cluster.bounds.height,
      ).toBe(true);
    }
  });

  test("returns the member for a degenerate ray", () => {
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      edge: null,
    });
  });
});
