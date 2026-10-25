/**
 * Cluster port geometry tests.
 *
 * External links must terminate at the center of the dashed cluster frame edge
 * facing the other endpoint instead of a rack inside it. These cases pin the
 * ray/edge selection and the edge-midpoint used for every ported endpoint.
 */
import { describe, expect, test } from "vite-plus/test";
import type { PlacedCluster } from "../src/layout";
import { clusterPort } from "../src/scene";

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

  test("gives every member link the same centered port", () => {
    expect(clusterPort(cluster, { x: 0, y: 0 }, { x: -420, y: 0 })).toEqual(
      clusterPort(cluster, { x: 0, y: 200 }, { x: -420, y: 200 }),
    );
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
