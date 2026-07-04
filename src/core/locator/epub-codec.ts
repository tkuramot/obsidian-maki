/**
 * `EpubLocatorCodec` — Locator ↔ subpath params for the EPUB backend.
 * The persisted value is the CFI body, unwrapped and
 * percent-encoded; the in-memory `EpubLocator.cfi` is unwrapped and decoded.
 */

import type { Locator, SubpathParams } from "../types";
import { decodeCfi, encodeCfi } from "./cfi";
import { expectBackend, type LocatorCodec } from "./codec";

export const EpubLocatorCodec: LocatorCodec = {
  encode(loc: Locator): SubpathParams {
    const epub = expectBackend(loc, "epub", "EpubLocatorCodec");
    return { epubcfi: encodeCfi(epub.cfi) };
  },

  decode(params: SubpathParams): Locator | null {
    const encoded = params["epubcfi"];
    if (encoded === undefined || encoded === "") return null;
    const cfi = decodeCfi(encoded);
    if (cfi === null || cfi === "") return null;
    return { backend: "epub", cfi };
  },
};
