/**
 * `PdfLocatorCodec` — Locator ↔ subpath params for the PDF backend.
 * The keys reuse Obsidian's native PDF subpath conventions so
 * links stay interoperable with Obsidian itself and obsidian-pdf-plus.
 */

import type { Locator, PdfLocator, SubpathParams } from "../types";
import type { LocatorCodec } from "./codec";

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

function parseSelection(value: string): PdfLocator["target"] | null {
  const parts = value.split(",").map(parseInteger);
  if (parts.length !== 4 || parts.some((p) => p === null || p < 0)) return null;
  const [beginItem, beginOffset, endItem, endOffset] = parts as [number, number, number, number];
  return { kind: "text", begin: [beginItem, beginOffset], end: [endItem, endOffset] };
}

function parseRect(value: string): PdfLocator["target"] | null {
  const parts = value.split(",").map(parseNumber);
  if (parts.length !== 4 || parts.some((p) => p === null)) return null;
  return { kind: "rect", rect: parts as [number, number, number, number] };
}

export const PdfLocatorCodec: LocatorCodec = {
  encode(loc: Locator): SubpathParams {
    if (loc.backend !== "pdf") {
      throw new Error(`PdfLocatorCodec cannot encode a '${loc.backend}' locator`);
    }
    // Insertion order defines the serialized key order: page first, then the
    // target key, matching the spec's golden examples.
    const params: SubpathParams = { page: String(loc.page) };
    switch (loc.target.kind) {
      case "text":
        params["selection"] = [...loc.target.begin, ...loc.target.end].join(",");
        break;
      case "rect":
        params["rect"] = loc.target.rect.join(",");
        break;
      case "annotation":
        params["annotation"] = loc.target.id;
        break;
    }
    return params;
  },

  decode(params: SubpathParams): Locator | null {
    const page = params["page"] !== undefined ? parseInteger(params["page"]) : null;
    if (page === null || page < 1) return null;

    let target: PdfLocator["target"] | null = null;
    if (params["selection"] !== undefined) {
      target = parseSelection(params["selection"]);
    } else if (params["rect"] !== undefined) {
      target = parseRect(params["rect"]);
    } else if (params["annotation"] !== undefined && params["annotation"] !== "") {
      target = { kind: "annotation", id: params["annotation"] };
    }
    if (!target) return null;

    return { backend: "pdf", page, target };
  },
};
