/**
 * Physical cabinet envelope in the renderer's existing model coordinates.
 * This is per-artwork metadata, never a source/target provider-pair preset.
 * Its projected front/side contour defines stacked base-to-roof sections.
 */
export interface TransformerEnvelope {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

/**
 * Borrowed, decoded static pixels from the shared component cache. Capturing
 * never encodes another bitmap or expands a detailed SVG tree. The owner must
 * release the lease on completion, cancellation, timeout, or removal.
 */
export interface TransformerSnapshot {
  images: readonly SVGImageElement[];
  release(): void;
}
