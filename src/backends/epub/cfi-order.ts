/**
 * CFI range-order guard. Lives in the EPUB backend (not the core) because it
 * is built on foliate's CFI functions — pure string code, but a vendored
 * dependency the core must not import.
 */

import { collapse, compare } from "foliate-js/epubcfi.js";

/**
 * A range CFI whose start sorts after its end can only resolve to a collapsed
 * DOM range, so it silently draws nothing; refuse it instead — both before
 * persisting (captureSelection) and when drawing links that already carry one.
 */
export function isInvertedRangeCfi(cfi: string): boolean {
  try {
    return compare(collapse(cfi), collapse(cfi, true)) > 0;
  } catch {
    return true; // unparseable ⇒ equally undrawable
  }
}
