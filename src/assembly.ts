import type { TransformerEnvelope } from "./transformer-model";

/** Only the next section moves. Every section below it is already seated. */
export interface AssemblyPose {
  settled: number;
  active: number | null;
  lift: number;
}

/**
 * Bottom-to-top assembly in normalized time. A section seats from nine model
 * units above its final position, then holds before the next section starts.
 * No opacity, scale, rotation, bounce, or simultaneous flying sections.
 * The same timeline reversed removes the source from the top down.
 */
export function assemblyPose(progress: number, count: number): AssemblyPose {
  if (progress <= 0) return { settled: 0, active: null, lift: 0 };
  if (progress >= 1) return { settled: count, active: null, lift: 0 };
  const position = progress * count;
  const layer = Math.floor(position);
  const travel = (position - layer) / 0.78;
  if (travel >= 1) return { settled: layer + 1, active: null, lift: 0 };
  return { settled: layer, active: layer, lift: -9 * (1 - travel) ** 3 };
}

/**
 * Base, three to five stacked body sections, then cap. Cabinet height determines
 * density, not its provider identity or the provider it is replacing. The cap
 * includes all roof artwork and fins above the envelope's front top edge.
 */
export function assemblyCuts(e: TransformerEnvelope): readonly number[] {
  const sections = Math.max(3, Math.min(5, Math.round(e.height / 38)));
  const base = e.z,
    roof = e.z + e.height - 8;
  return Array.from(
    { length: sections + 1 },
    (_, i) => base + ((roof - base) * i) / sections,
  );
}
