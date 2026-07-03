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
 * CFI safety: only `<head>` is modified in place. A (nonconforming) link
 * outside `<head>` keeps its DOM position — its mirror is appended to
 * `<head>` instead — so body element indices, which CFIs address, never
 * shift.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
/**
 * `@import "blob:…";` as foliate's `replaceCSS` rewrites it. Media-query
 * imports (`@import "…" print;`) are deliberately not matched: inlining
 * one would apply it unconditionally, so they stay blocked instead.
 */
const IMPORT_PATTERN = /@import\s+(?:url\(\s*)?["']?(blob:[^"')\s]+)["']?\s*\)?\s*;/gi;
const MAX_IMPORT_DEPTH = 4;

export class SectionStyleInliner {
  /** Sections share sheets via foliate's loader cache; fetch each once. */
  private readonly cache = new Map<string, Promise<string>>();

  /** Mirror every blocked stylesheet link of a loaded section document. */
  async apply(doc: Document): Promise<void> {
    const links = Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet" i][href^="blob:"]'),
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
    return pending.then((css) => this.inlineImports(css, depth));
  }

  /** `@import` of a blob: URL is equally blocked when inlined; recurse. */
  private async inlineImports(css: string, depth: number): Promise<string> {
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
        result += await this.load(url!, depth - 1);
      } catch {
        result += statement; // keep the (dead) import rather than corrupt the sheet
      }
    }
    return result + css.slice(last);
  }
}
