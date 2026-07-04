/**
 * Snap element-node range endpoints to text positions — shared by both
 * backends' selection capture. Browsers often report a selection boundary as
 * (element, child index) — e.g. when dragging past the end of a line or
 * block — but both endpoint codecs need text positions: foliate's
 * `CFI.fromRange` drops offsets on element steps (producing inverted range
 * CFIs), and the PDF text-item walk only resolves nodes inside text spans.
 * Returns null when the range contains no text to snap to.
 */
export function snapToTextEndpoints(range: Range): Range | null {
  const startsInText = range.startContainer.nodeType === Node.TEXT_NODE;
  const endsInText = range.endContainer.nodeType === Node.TEXT_NODE;
  if (startsInText && endsInText) return range;

  const doc = range.commonAncestorContainer.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );
  let first: Text | null = null;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.length === 0 || !range.intersectsNode(text)) continue;
    first ??= text;
    last = text;
  }
  if (!first || !last) return null;

  const snapped = range.cloneRange();
  // A text node never straddles an element-node boundary, so an intersecting
  // one lies entirely inside the range on that side: snap to its outer edge.
  if (!startsInText) snapped.setStart(first, 0);
  if (!endsInText) snapped.setEnd(last, last.length);
  return snapped.collapsed ? null : snapped;
}
