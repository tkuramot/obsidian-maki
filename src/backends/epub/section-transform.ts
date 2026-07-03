/**
 * Shared plumbing for section `data` transforms (epub-security's CSP meta,
 * epub-style-inline's link parking): parse one (X)HTML section, apply a
 * mutation, and reserialize preserving the media type.
 */

/** Media types of section documents the transforms apply to. */
export const SECTION_HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);

/** Returns the source unchanged when `mutate` reports nothing changed. */
export function transformSectionHtml(
  source: string,
  mediaType: string,
  mutate: (doc: Document) => boolean,
): string {
  const doc = new DOMParser().parseFromString(source, mediaType as DOMParserSupportedType);
  if (!mutate(doc)) return source;
  if (mediaType === "text/html") {
    return `<!DOCTYPE html>${doc.documentElement?.outerHTML ?? source}`;
  }
  return new XMLSerializer().serializeToString(doc);
}
