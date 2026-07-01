/**
 * Link assembly and subpath (de)serialization — owned by the locator family
 * because it sits on the same persisted contract as the codecs (spec §6.1,
 * design §4.4).
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
 * Derive the stable id of the highlight a locator produces (design §3.3).
 * Built from the *canonical* encoding of the locator, so two subpaths that
 * decode to the same location (e.g. differing key order or extra keys such
 * as `color`) map to the same highlight.
 */
export function highlightIdFor(loc: Locator, codec: LocatorCodec): HighlightId {
  return `${loc.backend}:${serializeSubpath(codec.encode(loc))}`;
}
