// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inlineCssImports, parkStylesheetLinks } from "./epub-style-inline";

describe("parkStylesheetLinks", () => {
  function parse(head: string): Document {
    return new DOMParser().parseFromString(
      `<html><head>${head}</head><body></body></html>`,
      "text/html",
    );
  }

  it("parks blob: stylesheet links and reports the change", () => {
    const doc = parse('<link rel="stylesheet" href="blob:app://x/1">');
    expect(parkStylesheetLinks(doc)).toBe(true);
    expect(doc.querySelector("link")!.getAttribute("rel")).toBe("maki-stylesheet");
  });

  it("leaves non-blob and alternate stylesheets alone", () => {
    const doc = parse(
      '<link rel="stylesheet" href="https://example.com/a.css">' +
        '<link rel="alternate stylesheet" href="blob:app://x/2">',
    );
    expect(parkStylesheetLinks(doc)).toBe(false);
    const rels = Array.from(doc.querySelectorAll("link"), (l) => l.getAttribute("rel"));
    expect(rels).toEqual(["stylesheet", "alternate stylesheet"]);
  });
});

describe("inlineCssImports", () => {
  const sheets: Record<string, string> = {
    "blob:app://x/a": "p { color: red; }",
    "blob:app://x/b": '@import "blob:app://x/a";\nb { color: blue; }',
    "blob:app://x/loop": '@import "blob:app://x/loop";',
  };
  const load = (url: string, depth: number): Promise<string> => {
    const css = sheets[url];
    if (css === undefined) return Promise.reject(new Error(`no sheet: ${url}`));
    return inlineCssImports(css, load, depth);
  };

  it("passes css without imports through unchanged", () => {
    return expect(inlineCssImports("p { color: red; }", load, 4)).resolves.toBe(
      "p { color: red; }",
    );
  });

  it("replaces each blob: import with the loaded sheet, in place", async () => {
    const css = '@import "blob:app://x/a";\nh1 { font-weight: bold; }';
    await expect(inlineCssImports(css, load, 4)).resolves.toBe(
      "p { color: red; }\nh1 { font-weight: bold; }",
    );
  });

  it("recurses into nested imports via the loader", async () => {
    await expect(inlineCssImports('@import url("blob:app://x/b");', load, 4)).resolves.toBe(
      "p { color: red; }\nb { color: blue; }",
    );
  });

  it("stops at the depth limit instead of looping on circular imports", async () => {
    const out = await inlineCssImports('@import "blob:app://x/loop";', load, 4);
    // The self-import survives as a (dead) statement once depth runs out.
    expect(out).toContain('@import "blob:app://x/loop";');
  });

  it("keeps a media-query import blocked (never inlined unconditionally)", async () => {
    const css = '@import "blob:app://x/a" print;';
    await expect(inlineCssImports(css, load, 4)).resolves.toBe(css);
  });

  it("keeps the dead import statement when its sheet fails to load", async () => {
    const css = '@import "blob:app://x/missing"; p { color: red; }';
    await expect(inlineCssImports(css, load, 4)).resolves.toBe(css);
  });
});
