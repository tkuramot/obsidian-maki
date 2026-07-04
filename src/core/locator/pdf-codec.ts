/**
 * `PdfLocatorCodec` — Locator ↔ subpath params for the PDF backend.
 * The keys reuse Obsidian's native PDF subpath conventions so
 * links stay interoperable with Obsidian itself and obsidian-pdf-plus.
 */

import type { Locator, PdfLocator, SubpathParams } from "../types";
import { expectBackend, type LocatorCodec } from "./codec";

/** Strict integer parse: the whole string must be a base-10 integer. */
function parseInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Strict finite-number parse (rect coordinates may be fractional). */
function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A text selection's `(item index, char offset)` endpoint pair. */
export interface SelectionEndpoints {
  begin: [item: number, offset: number];
  end: [item: number, offset: number];
}

/**
 * Parse the native `selection=` value — `beginItem,beginOffset,endItem,endOffset`,
 * four non-negative integers (Obsidian's own convention). Order is *not*
 * validated: an inverted persisted selection still decodes (it just draws
 * nothing); live capture rejects it via `isForwardTextRange` instead.
 */
export function parseSelectionEndpoints(value: string): SelectionEndpoints | null {
  const parts = value.split(",").map((part) => parseInteger(part.trim()));
  if (parts.length !== 4 || parts.some((p) => p === null || p < 0)) return null;
  const [bi, bo, ei, eo] = parts as [number, number, number, number];
  return { begin: [bi, bo], end: [ei, eo] };
}

/** Whether `begin` addresses a position strictly before `end` (a non-collapsed forward range). */
export function isForwardTextRange(
  begin: [item: number, offset: number],
  end: [item: number, offset: number],
): boolean {
  return begin[0] < end[0] || (begin[0] === end[0] && begin[1] < end[1]);
}

function parseSelection(value: string): PdfLocator["target"] | null {
  const endpoints = parseSelectionEndpoints(value);
  return endpoints ? { kind: "text", begin: endpoints.begin, end: endpoints.end } : null;
}

function parseRect(value: string): PdfLocator["target"] | null {
  const parts = value.split(",").map(parseNumber);
  if (parts.length !== 4 || parts.some((p) => p === null)) return null;
  return { kind: "rect", rect: parts as [number, number, number, number] };
}

export const PdfLocatorCodec: LocatorCodec = {
  encode(loc: Locator): SubpathParams {
    const pdf = expectBackend(loc, "pdf", "PdfLocatorCodec");
    // Insertion order defines the serialized key order: page first, then the
    // target key, matching the spec's golden examples.
    const params: SubpathParams = { page: String(pdf.page) };
    switch (pdf.target.kind) {
      case "text":
        params.selection = [...pdf.target.begin, ...pdf.target.end].join(",");
        break;
      case "rect":
        params.rect = pdf.target.rect.join(",");
        break;
      case "annotation":
        params.annotation = pdf.target.id;
        break;
    }
    return params;
  },

  decode(params: SubpathParams): Locator | null {
    const page = params.page !== undefined ? parseInteger(params.page) : null;
    if (page === null || page < 1) return null;

    // Target keys take strict precedence (selection > rect > annotation): a
    // link should carry exactly one target, so a *present but malformed*
    // higher-precedence key means the whole locator is undecodable — it never
    // falls through to a lower-precedence key.
    let target: PdfLocator["target"] | null = null;
    if (params.selection !== undefined) {
      target = parseSelection(params.selection);
    } else if (params.rect !== undefined) {
      target = parseRect(params.rect);
    } else if (params.annotation !== undefined && params.annotation !== "") {
      target = { kind: "annotation", id: params.annotation };
    }
    if (!target) return null;

    return { backend: "pdf", page, target };
  },
};
