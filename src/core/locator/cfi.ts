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

/** Wrap a CFI body in the standard `epubcfi( … )` form for the backend. */
export function wrapCfi(body: string): string {
  return `epubcfi(${body})`;
}

/** Strip the `epubcfi( … )` wrapper if present; otherwise return as-is. */
export function unwrapCfi(cfi: string): string {
  const match = /^epubcfi\((.*)\)$/.exec(cfi);
  return match ? match[1]! : cfi;
}
