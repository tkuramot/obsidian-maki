/**
 * Inline blob: stylesheets into EPUB section documents.
 *
 * Obsidian's renderer CSP is `style-src 'unsafe-inline' 'self'
 * https://fonts.googleapis.com`, and section iframes (blob: documents)
 * inherit it: the blob: URLs foliate's loader mints for
 * `<link rel="stylesheet">` (and `@import`) are blocked as stylesheets, so
 * books render unstyled. Inline `<style>` text is allowed, and plain
 * `fetch()` of a blob: URL is unrestricted (the policy has no
 * `connect-src`/`default-src`), so each blocked sheet is fetched from the
 * plugin context and mirrored as an inline `<style>`.
 *
 * Two steps: `parkSectionStylesheets` rewrites the links' `rel` at section
 * transform time so the document never even attempts the blocked load (no
 * CSP violation noise), and `SectionStyleInliner` mirrors the parked links
 * once the section document loads.
 *
 * CFI safety: only `<head>` is modified in place. A (nonconforming) link
 * outside `<head>` keeps its DOM position — its mirror is appended to
 * `<head>` instead — so body element indices, which CFIs address, never
 * shift.
 */

import type { FoliateBook } from "foliate-js/view.js";
import { SECTION_HTML_TYPES, transformSectionHtml } from "./section-transform";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** The rel a stylesheet link is parked under until its inline mirror. */
const PARKED_REL = "maki-stylesheet";
/**
 * blob: stylesheet links, minus alternate stylesheets (off by default —
 * mirroring one as `<style>` would wrongly always apply it).
 */
const BLOCKED_LINKS =
  'link[rel~="stylesheet" i][href^="blob:"]:not([rel~="alternate" i])';
/**
 * `@import "blob:…";` as foliate's `replaceCSS` rewrites it. Media-query
 * imports (`@import "…" print;`) are deliberately not matched: inlining
 * one would apply it unconditionally, so they stay blocked instead.
 */
const IMPORT_PATTERN = /@import\s+(?:url\(\s*)?["']?(blob:[^"')\s]+)["']?\s*\)?\s*;/gi;
const MAX_IMPORT_DEPTH = 4;

/**
 * Rewrite a section document's blocked stylesheet links to the parked `rel`.
 * Returns whether anything changed. Exported for its unit tests.
 */
export function parkStylesheetLinks(doc: Document): boolean {
  const links = Array.from(doc.querySelectorAll(BLOCKED_LINKS));
  for (const link of links) link.setAttribute("rel", PARKED_REL);
  return links.length > 0;
}

/**
 * Park each section's blocked stylesheet links at transform time: with a
 * non-stylesheet `rel` the document never attempts the load, so nothing
 * hits the CSP. Wire this next to `hardenBook`, before `open()`.
 */
export function parkSectionStylesheets(book: FoliateBook): void {
  const target = book.transformTarget;
  if (!target) return;
  target.addEventListener("data", (event) => {
    const detail = (event as CustomEvent<{ data: unknown; type?: string }>).detail;
    if (!detail?.type || !SECTION_HTML_TYPES.has(detail.type)) return;
    const mediaType = detail.type;
    detail.data = Promise.resolve(detail.data).then((data) => {
      if (typeof data !== "string") return data;
      return transformSectionHtml(data, mediaType, parkStylesheetLinks);
    });
  });
}

export class SectionStyleInliner {
  /** Sections share sheets via foliate's loader cache; fetch each once. */
  private readonly cache = new Map<string, Promise<string>>();

  /** Mirror every parked/blocked stylesheet link of a loaded section. */
  async apply(doc: Document): Promise<void> {
    const links = Array.from(
      doc.querySelectorAll<HTMLLinkElement>(
        `link[rel="${PARKED_REL}"], ${BLOCKED_LINKS}`,
      ),
    );
    await Promise.all(
      links.map(async (link) => {
        try {
          const css = await this.load(link.href, MAX_IMPORT_DEPTH);
          const style = doc.createElementNS(XHTML_NS, "style");
          const media = link.getAttribute("media");
          if (media) style.setAttribute("media", media);
          style.textContent = css;
          const head = doc.querySelector("head");
          if (head?.contains(link)) link.replaceWith(style);
          else head?.append(style);
        } catch (error) {
          console.debug("Maki[epub]: could not inline stylesheet", link.href, error);
        }
      }),
    );
  }

  private load(url: string, depth: number): Promise<string> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = fetch(url).then((response) => response.text());
      this.cache.set(url, pending);
    }
    return pending.then((css) => inlineCssImports(css, (u, d) => this.load(u, d), depth));
  }
}

/**
 * Replace each blob: `@import` with the css `load` resolves it to —
 * `@import` of a blob: URL is equally blocked when inlined, so the loader
 * recurses (bounded by `depth`). A failed load keeps the (dead) import
 * statement rather than corrupt the sheet. Pure given `load`; exported for
 * its unit tests.
 */
export async function inlineCssImports(
  css: string,
  load: (url: string, depth: number) => Promise<string>,
  depth: number,
): Promise<string> {
  if (depth <= 0) return css;
  const matches = [...css.matchAll(IMPORT_PATTERN)];
  if (matches.length === 0) return css;
  let result = "";
  let last = 0;
  for (const match of matches) {
    const [statement, url] = match;
    result += css.slice(last, match.index);
    last = match.index + statement.length;
    try {
      result += await load(url!, depth - 1);
    } catch {
      result += statement; // keep the (dead) import rather than corrupt the sheet
    }
  }
  return result + css.slice(last);
}
