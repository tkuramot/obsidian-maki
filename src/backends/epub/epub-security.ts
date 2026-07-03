/**
 * EPUB script blocking: sections are arbitrary HTML/JS rendered in iframes
 * and MUST NOT execute scripts (the section iframes are same-origin with
 * Obsidian's node-integrated renderer, so a running book script means RCE).
 *
 * Three layers:
 * 1. The section iframes' sandbox has no `allow-scripts`: the foliate-js
 *    fork (vendor/foliate-js submodule) makes the sandbox configurable, and
 *    `MakiEpubView` sets `sandbox="allow-same-origin"` on `<foliate-view>`
 *    before `open()` — the upstream default would keep `allow-scripts`.
 * 2. Script *resources* are vetoed via the loader's `load` event.
 * 3. A `script-src 'none'` CSP meta is injected into each (X)HTML section
 *    before it becomes a blob URL. Inserting into <head> does not disturb
 *    CFI round-tripping — CFIs address <body> content and element indices
 *    inside <head> don't affect them.
 */

import type { FoliateBook } from "foliate-js/view.js";
import { SECTION_HTML_TYPES, transformSectionHtml } from "./section-transform";

const CSP = "script-src 'none'";

function injectCsp(source: string, mediaType: string): string {
  return transformSectionHtml(source, mediaType, (doc) => {
    const head = doc.querySelector("head");
    if (!head) return false;
    const meta = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", CSP);
    head.insertBefore(meta, head.firstChild);
    return true;
  });
}

/** Wire the script-blocking hooks into a parsed book's loader. */
export function hardenBook(book: FoliateBook): void {
  const target = book.transformTarget;
  if (!target) return;

  target.addEventListener("load", (event) => {
    const detail = (event as CustomEvent<{ isScript?: boolean; allow?: unknown }>).detail;
    if (detail?.isScript) detail.allow = false;
  });

  target.addEventListener("data", (event) => {
    const detail = (event as CustomEvent<{ data: unknown; type?: string }>).detail;
    if (!detail?.type || !SECTION_HTML_TYPES.has(detail.type)) return;
    const mediaType = detail.type;
    detail.data = Promise.resolve(detail.data).then((data) =>
      typeof data === "string" ? injectCsp(data, mediaType) : data,
    );
  });
}
