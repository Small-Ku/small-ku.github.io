type VerticalRect = Pick<DOMRectReadOnly, "top" | "height">;

/** Range boxes from fallback fonts can have different tops on the same line.
 * Compare their central vertical bands, not a fixed pixel top tolerance. */
export function shareVisualLine(a: VerticalRect, b: VerticalRect): boolean {
  const centerA = a.top + a.height / 2;
  const centerB = b.top + b.height / 2;
  return Math.abs(centerA - centerB) < Math.max(1, Math.min(a.height, b.height) / 2);
}
