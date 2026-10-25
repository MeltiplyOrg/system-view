import { describe, expect, test } from "vite-plus/test";
import { assemblyCuts, assemblyPose } from "../src/assembly";

describe("layer-by-layer assembly", () => {
  test("seats lower sections before starting higher sections", () => {
    for (const count of [5, 6, 7]) {
      let previousSettled = 0;
      for (let frame = 0; frame <= 120; frame++) {
        const pose = assemblyPose(frame / 120, count);
        expect(pose.settled).toBeGreaterThanOrEqual(previousSettled);
        expect(pose.settled).toBeLessThanOrEqual(count);
        if (pose.active !== null) expect(pose.active).toBe(pose.settled);
        previousSettled = pose.settled;
      }
      expect(previousSettled).toBe(count);
    }
  });

  test("moves only the next section through a short downward seating stroke", () => {
    const count = 6;
    for (let layer = 0; layer < count; layer++) {
      const entering = assemblyPose((layer + 0.05) / count, count);
      const seating = assemblyPose((layer + 0.5) / count, count);
      const locked = assemblyPose((layer + 0.9) / count, count);
      expect(entering.active).toBe(layer);
      expect(seating.active).toBe(layer);
      expect(entering.lift).toBeGreaterThanOrEqual(-9);
      expect(seating.lift).toBeGreaterThan(entering.lift);
      expect(seating.lift).toBeLessThan(0);
      expect(locked).toEqual({ settled: layer + 1, active: null, lift: 0 });
    }
  });

  test("starts empty, ends complete, and reverses in top-down order", () => {
    expect(assemblyPose(-1, 5)).toEqual({ settled: 0, active: null, lift: 0 });
    expect(assemblyPose(1.5, 5)).toEqual({ settled: 5, active: null, lift: 0 });
    const removingTop = assemblyPose(0.9, 5);
    expect(removingTop.settled).toBe(4);
    expect(removingTop.active).toBe(4);
    expect(assemblyPose(0.1, 5).active).toBe(0);
  });

  test("keeps base and roof separate with bounded section counts for cabinet heights", () => {
    for (const height of [82, 155, 224, 400]) {
      const cuts = assemblyCuts({
        x: -76,
        y: -74,
        z: 16,
        width: 152,
        depth: 148,
        height,
      });
      expect(cuts[0]).toBeGreaterThanOrEqual(16);
      expect(cuts.at(-1)).toBeLessThan(16 + height);
      expect(cuts.length + 1).toBeGreaterThanOrEqual(5);
      expect(cuts.length + 1).toBeLessThanOrEqual(7);
      for (let i = 1; i < cuts.length; i++)
        expect(cuts[i]).toBeGreaterThan(cuts[i - 1]);
    }
  });
});
