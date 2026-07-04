/**
 * CFI percent-encoding and `epubcfi( … )` wrapper handling.
 *
 * A raw CFI contains characters that conflict with link and subpath parsing,
 * so the persisted value is the CFI *body* (no wrapper), percent-encoded.
 * The core treats the CFI itself as an opaque string; resolution is the EPUB
 * backend's job.
 */

/**
 * Characters that must be percent-encoded in a persisted CFI value:
 * at least `% [ ] , & = # | ( ) :`.
 */
const RESERVED = new Set(["%", "[", "]", ",", "&", "=", "#", "|", "(", ")", ":"]);

/** Percent-encode the reserved characters of a raw (decoded) CFI body. */
export function encodeCfi(cfi: string): string {
  let out = "";
  for (const ch of cfi) {
    if (RESERVED.has(ch)) {
      const code = ch.codePointAt(0)!;
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Decode a percent-encoded CFI value back to the raw body.
 * Returns null when the input is not valid percent-encoding (a malformed
 * link must be skippable, never an exception).
 */
export function decodeCfi(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * The spine-item index a CFI's first step addresses, or null when the CFI
 * does not start with the conventional package step. Per the EPUB CFI spec,
 * `/6` is the package document's spine element and the next step's number is
 * twice the 1-based child position — so `/6/4…` addresses the second spine
 * item, index 1. Used as the coarse fallback when the exact passage no
 * longer resolves.
 */
export function spineSectionIndex(cfi: string): number | null {
  const match = /^\/6\/(\d+)/.exec(cfi);
  if (!match) return null;
  const step = Number(match[1]);
  if (step <= 0 || step % 2 !== 0) return null;
  return step / 2 - 1;
}

/** Wrap a CFI body in the standard `epubcfi( … )` form for the backend. */
export function wrapCfi(body: string): string {
  return `epubcfi(${body})`;
}

/** Strip the `epubcfi( … )` wrapper if present; otherwise return as-is. */
export function unwrapCfi(cfi: string): string {
  const match = /^epubcfi\((.*)\)$/.exec(cfi);
  return match ? match[1]! : cfi;
}
