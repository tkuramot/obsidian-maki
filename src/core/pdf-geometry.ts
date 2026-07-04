/**
 * `PdfGeometry` — the pure math of PDF text-range highlighting:
 * `(text item boxes, begin, end) → merged rects`.
 *
 * Only *acquiring* the boxes and *injecting* the resulting rectangles into
 * the DOM are humble (PDF adapter). Character positions within an item are
 * approximated proportionally to the character count — the same approximation
 * the text layer itself uses for hit-testing.
 */

/** PDF coordinates: origin bottom-left, y grows upward. */
export type Rect = [left: number, bottom: number, right: number, top: number];

/** One text item of a page's text layer, reduced to what the math needs. */
export interface TextItemBox {
  rect: Rect;
  text: string;
}

/**
 * The shape of a pdf.js `getTextContent()` item, reduced to what the math
 * needs (structural — the adapter's `PdfJsTextItem` satisfies it).
 */
export interface PdfTextItemLike {
  /** pdf.js transform matrix; indices 4/5 are the item origin. */
  transform: readonly number[];
  width: number;
  height: number;
  str: string;
}

/** getTextContent items → the boxes `selectionRects` consumes. */
export function toItemBoxes(items: readonly PdfTextItemLike[]): TextItemBox[] {
  return items.map((item) => {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    return { rect: [x, y, x + item.width, y + item.height], text: item.str };
  });
}

/** Tolerance for treating two rects as being on the same line. */
const LINE_EPSILON = 0.5;

/**
 * Compute the highlight rectangles for a text range addressed as
 * `(item index, character offset)` pairs. Best-effort: out-of-range input
 * yields an empty result, never an exception (drawing must not throw).
 */
export function selectionRects(
  items: readonly TextItemBox[],
  begin: [item: number, offset: number],
  end: [item: number, offset: number],
): Rect[] {
  const [beginItem, beginOffset] = begin;
  const [endItem, endOffset] = end;
  if (beginItem > endItem) return [];
  if (beginItem < 0 || endItem >= items.length) return [];

  const rects: Rect[] = [];
  for (let i = beginItem; i <= endItem; i++) {
    const item = items[i];
    if (!item || item.text.length === 0) continue;
    const from = i === beginItem ? beginOffset : 0;
    const to = i === endItem ? endOffset : item.text.length;
    const clampedFrom = Math.max(0, Math.min(from, item.text.length));
    const clampedTo = Math.max(0, Math.min(to, item.text.length));
    if (clampedFrom >= clampedTo) continue;

    const [left, bottom, right, top] = item.rect;
    const width = right - left;
    const x0 = left + (width * clampedFrom) / item.text.length;
    const x1 = left + (width * clampedTo) / item.text.length;
    rects.push([x0, bottom, x1, top]);
  }
  return mergeRects(rects);
}

/**
 * Merge rects that sit on the same line (equal bottom/top within a small
 * tolerance) and touch or overlap horizontally, so a multi-item line becomes
 * one rectangle.
 */
export function mergeRects(rects: readonly Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const merged: Rect[] = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last[1] - rect[1]) <= LINE_EPSILON &&
      Math.abs(last[3] - rect[3]) <= LINE_EPSILON &&
      rect[0] <= last[2] + LINE_EPSILON
    ) {
      last[2] = Math.max(last[2], rect[2]);
    } else {
      merged.push([...rect]);
    }
  }
  return merged;
}
