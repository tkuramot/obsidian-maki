/**
 * Hand-written, minimal declarations for foliate-js `epubcfi.js` — only
 * the surface Maki's EPUB adapter uses (see view.d.ts for how these are
 * wired to the `vendor/foliate-js` submodule, and the drift caveat).
 */

/** Collapse a (possibly range) CFI to its start point — or its end with `toEnd`. */
export function collapse(cfi: string, toEnd?: boolean): string;

/** Standard CFI ordering: negative, zero or positive as `a` sorts before, with or after `b`. */
export function compare(a: string, b: string): number;
