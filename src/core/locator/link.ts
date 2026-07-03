/**
 * Link assembly and subpath (de)serialization — owned by the locator family
 * because it sits on the same persisted contract as the codecs.
 *
 * Values are stored raw: each codec is responsible for encoding values that
 * need it (only the CFI does; PDF values use commas natively, per Obsidian's
 * own conventions).
 */

import type { DocumentRef, HighlightId, Locator, SubpathParams } from "../types";
import type { LocatorCodec } from "./codec";

/** `{page: "3", selection: "4,0,5,20"}` → `page=3&selection=4,0,5,20`. */
export function serializeSubpath(params: SubpathParams): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * `page=3&selection=4,0,5,20` → `{page: "3", selection: "4,0,5,20"}`.
 * Pairs without `=` and empty keys are ignored; a duplicate key keeps the
 * last occurrence (URLSearchParams-like).
 */
export function parseSubpath(subpath: string): SubpathParams {
  const params: SubpathParams = {};
  for (const pair of subpath.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    params[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return params;
}

/** Assemble the full annotation link: `[[path#subpath|display]]`. */
export function buildLink(
  ref: DocumentRef,
  params: SubpathParams,
  display?: string,
): string {
  const subpath = serializeSubpath(params);
  const alias = display !== undefined && display !== "" ? `|${display}` : "";
  return `[[${ref.path}#${subpath}${alias}]]`;
}

/**
 * Derive the stable id of the highlight a locator produces.
 * Built from the *canonical* encoding of the locator, so two subpaths that
 * decode to the same location (e.g. differing key order or extra keys such
 * as `color`) map to the same highlight.
 */
export function highlightIdFor(loc: Locator, codec: LocatorCodec): HighlightId {
  return `${loc.backend}:${serializeSubpath(codec.encode(loc))}`;
}

/** Key-order-insensitive equality of two subpath maps. */
function sameParams(a: SubpathParams, b: SubpathParams): boolean {
  const aKeys = Object.keys(a);
  return aKeys.length === Object.keys(b).length && aKeys.every((k) => a[k] === b[k]);
}

/**
 * Remove the annotation link matching `subpath` from note content
 * (delete-from-preview edits the source note; markdown stays the source of
 * truth). The decision logic is pure and lives here; `ObsidianNoteWriter`
 * only wraps it in `vault.process`.
 *
 * The line hint (the indexed link's position) is tried first, then the whole
 * content, so a stale hint still deletes the right link. Matching is
 * key-order-insensitive over the parsed subpath. Returns the new content, or
 * null when no link matched (callers then leave the note untouched).
 */
export function removeAnnotationLink(
  content: string,
  subpath: SubpathParams,
  lineHint?: number,
): string | null {
  const lines = content.split("\n");
  const wikilink = /!?\[\[([^\[\]]+)\]\]/g;

  const removeFrom = (index: number): boolean => {
    const line = lines[index];
    if (line === undefined) return false;
    for (const match of line.matchAll(wikilink)) {
      const inner = match[1]!;
      const pipe = inner.indexOf("|");
      const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
      const hash = target.indexOf("#");
      if (hash < 0) continue;
      if (!sameParams(parseSubpath(target.slice(hash + 1)), subpath)) continue;
      lines[index] = line.slice(0, match.index) + line.slice(match.index + match[0].length);
      return true;
    }
    return false;
  };

  if (lineHint !== undefined && removeFrom(lineHint)) return lines.join("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i === lineHint) continue;
    if (removeFrom(i)) return lines.join("\n");
  }
  return null;
}
