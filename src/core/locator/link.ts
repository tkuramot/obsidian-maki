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

/**
 * The subpath key carrying the highlight color. Written by
 * `AnnotationService` when a link is created and read back when links are
 * projected as highlights — part of the persisted contract.
 */
export const COLOR_PARAM_KEY = "color";

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

/** The annotation-relevant parts of a raw link target (`path#subpath`). */
export interface AnnotationLinkTarget {
  /** The link path before `#`, still unresolved (resolution is Obsidian's). */
  linkpath: string;
  params: SubpathParams;
  /** The `color` param, when present. */
  color?: string;
}

/**
 * Classify a raw link target as an annotation link: it must carry a subpath
 * with at least one `key=value` param. Returns null for plain file links and
 * heading/block references — those are not annotations.
 */
export function parseAnnotationLink(rawLink: string): AnnotationLinkTarget | null {
  const hash = rawLink.indexOf("#");
  if (hash < 0) return null;
  const params = parseSubpath(rawLink.slice(hash + 1));
  if (Object.keys(params).length === 0) return null;
  const target: AnnotationLinkTarget = { linkpath: rawLink.slice(0, hash), params };
  const color = params[COLOR_PARAM_KEY];
  if (color !== undefined) target.color = color;
  return target;
}

/** Key-order-insensitive equality of two subpath maps. */
function sameParams(a: SubpathParams, b: SubpathParams): boolean {
  const aKeys = Object.keys(a);
  return aKeys.length === Object.keys(b).length && aKeys.every((k) => a[k] === b[k]);
}

/**
 * Remove the annotation link matching `subpath` from note content — the pure
 * decision behind delete-from-preview; `ObsidianNoteWriter` only wraps it in
 * `vault.process`. Tries the line hint first, then the whole content, so a
 * stale hint still deletes the right link. Matching is key-order-insensitive.
 * Returns the new content, or null when nothing matched (caller leaves the
 * note untouched).
 *
 * Link boundaries follow Obsidian's grammar: a link ends at the *first* `]]`
 * (inner `[[` rejected), and the alias may hold single brackets. An alias
 * ending in `]` keeps that bracket out of the link, so deletion leaves the
 * stray bracket behind — exactly as Obsidian renders it.
 */
export function removeAnnotationLink(
  content: string,
  subpath: SubpathParams,
  lineHint?: number,
): string | null {
  const lines = content.split("\n");

  const removeFrom = (index: number): boolean => {
    const line = lines[index];
    if (line === undefined) return false;
    let cursor = 0;
    while (true) {
      const open = line.indexOf("[[", cursor);
      if (open < 0) return false;
      const close = line.indexOf("]]", open + 2);
      if (close < 0) return false;
      const inner = line.slice(open + 2, close);
      if (inner.includes("[[")) {
        cursor = open + 2; // like Obsidian, restart at the inner bracket
        continue;
      }
      cursor = close + 2;
      const pipe = inner.indexOf("|");
      const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
      const hash = target.indexOf("#");
      if (hash < 0) continue;
      if (!sameParams(parseSubpath(target.slice(hash + 1)), subpath)) continue;
      const start = open > 0 && line[open - 1] === "!" ? open - 1 : open; // embed prefix
      lines[index] = line.slice(0, start) + line.slice(close + 2);
      return true;
    }
  };

  if (lineHint !== undefined && removeFrom(lineHint)) return lines.join("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i === lineHint) continue;
    if (removeFrom(i)) return lines.join("\n");
  }
  return null;
}
