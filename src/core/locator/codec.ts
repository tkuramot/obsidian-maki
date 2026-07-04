/**
 * `LocatorCodec` — a dispatch type, not a port.
 *
 * There are two implementations (PDF, EPUB), but the core never swaps one
 * behaviour contract for another; it only picks the codec for a given
 * backend, via a `Record<BackendId, LocatorCodec>`.
 *
 * The encoded form is the persisted link subpath stored in users' notes —
 * a stable data contract. Both codecs must round-trip:
 * `decode(encode(x)) === x`.
 */

import type { BackendId, Locator, SubpathParams } from "../types";

export type LocatorCodec = {
  /** Locator → subpath params (e.g. `{page, selection}` or `{epubcfi}`). */
  encode(loc: Locator): SubpathParams;
  /**
   * Subpath params → locator, or null when the params do not describe a
   * decodable location (skip, never throw).
   */
  decode(params: SubpathParams): Locator | null;
};

/** How the core selects a codec: one value per backend. */
export type Codecs = Record<BackendId, LocatorCodec>;

/**
 * Encode-side guard shared by all codecs: a codec handed a foreign backend's
 * locator is a programming error (decode, by contrast, returns null — links
 * are data and must never throw).
 */
export function expectBackend<B extends BackendId>(
  loc: Locator,
  backend: B,
  codecName: string,
): Extract<Locator, { backend: B }> {
  if (loc.backend !== backend) {
    throw new Error(`${codecName} cannot encode a '${loc.backend}' locator`);
  }
  return loc as Extract<Locator, { backend: B }>;
}
