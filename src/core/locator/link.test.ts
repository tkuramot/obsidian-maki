import { describe, expect, it } from "vitest";
import type { DocumentRef, PdfLocator } from "../types";
import { EpubLocatorCodec } from "./epub-codec";
import {
  buildLink,
  highlightIdFor,
  parseAnnotationLink,
  parseSubpath,
  removeAnnotationLink,
  serializeSubpath,
} from "./link";
import { PdfLocatorCodec } from "./pdf-codec";

const paper: DocumentRef = { path: "paper.pdf", backend: "pdf" };
const book: DocumentRef = { path: "book.epub", backend: "epub" };

describe("buildLink (spec §6 golden examples)", () => {
  it("builds a PDF text-selection link with display and color", () => {
    expect(
      buildLink(
        paper,
        { page: "3", selection: "4,0,5,20", color: "yellow" },
        "paper, p.3",
      ),
    ).toBe("[[paper.pdf#page=3&selection=4,0,5,20&color=yellow|paper, p.3]]");
  });

  it("builds a PDF link without display or color", () => {
    expect(buildLink(paper, { page: "3", selection: "4,0,5,20" })).toBe(
      "[[paper.pdf#page=3&selection=4,0,5,20]]",
    );
  });

  it("builds a PDF rect link with an rgb color and no display", () => {
    expect(
      buildLink(paper, { page: "7", rect: "72,500,520,560", color: "0,200,120" }),
    ).toBe("[[paper.pdf#page=7&rect=72,500,520,560&color=0,200,120]]");
  });

  it("builds the EPUB CFI link of spec §6.4", () => {
    expect(
      buildLink(
        book,
        {
          epubcfi: "/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280",
          color: "yellow",
        },
        "book, ch.5",
      ),
    ).toBe(
      "[[book.epub#epubcfi=/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280&color=yellow|book, ch.5]]",
    );
  });

  it("omits the alias separator for an empty display", () => {
    expect(buildLink(paper, { page: "1", annotation: "1R" }, "")).toBe(
      "[[paper.pdf#page=1&annotation=1R]]",
    );
  });
});

describe("serializeSubpath / parseSubpath", () => {
  it("round-trips params", () => {
    const params = { page: "3", selection: "4,0,5,20", color: "0,200,120" };
    expect(parseSubpath(serializeSubpath(params))).toEqual(params);
  });

  it("ignores malformed pairs and keeps the last duplicate", () => {
    expect(parseSubpath("page=3&&junk&=5&color=red&color=blue")).toEqual({
      page: "3",
      color: "blue",
    });
  });

  it("keeps '=' inside values intact", () => {
    expect(parseSubpath("a=b=c")).toEqual({ a: "b=c" });
  });
});

describe("highlightIdFor", () => {
  const locator: PdfLocator = {
    backend: "pdf",
    page: 3,
    target: { kind: "text", begin: [4, 0], end: [5, 20] },
  };

  it("is canonical: same location, same id, regardless of extra keys", () => {
    const fromLink = PdfLocatorCodec.decode(
      parseSubpath("color=red&selection=4,0,5,20&page=3"),
    );
    expect(fromLink).not.toBeNull();
    expect(highlightIdFor(fromLink!, PdfLocatorCodec)).toBe(
      highlightIdFor(locator, PdfLocatorCodec),
    );
  });

  it("differs across backends and locations", () => {
    const other: PdfLocator = { ...locator, page: 4 };
    expect(highlightIdFor(other, PdfLocatorCodec)).not.toBe(
      highlightIdFor(locator, PdfLocatorCodec),
    );
    expect(
      highlightIdFor({ backend: "epub", cfi: "/6/4!/2:0" }, EpubLocatorCodec),
    ).toMatch(/^epub:/);
  });
});

describe("removeAnnotationLink (FR-7.3)", () => {
  const subpath = parseSubpath("page=3&selection=4,0,5,20&color=yellow");

  it("removes the link at the hinted line, keeping surrounding text", () => {
    const content = [
      "# Notes",
      "> [!quote] [[paper.pdf#page=3&selection=4,0,5,20&color=yellow|p.3]]",
      "> quoted text",
    ].join("\n");
    expect(removeAnnotationLink(content, subpath, 1)).toBe(
      ["# Notes", "> [!quote] ", "> quoted text"].join("\n"),
    );
  });

  it("matches key-order-insensitively and falls back to a full scan", () => {
    const content = "see [[paper.pdf#color=yellow&page=3&selection=4,0,5,20]] here";
    expect(removeAnnotationLink(content, subpath, 99)).toBe("see  here");
  });

  it("does not remove links with a different subpath", () => {
    const content = "[[paper.pdf#page=4&selection=4,0,5,20&color=yellow]]";
    expect(removeAnnotationLink(content, subpath)).toBeNull();
  });

  it("removes embeds and aliased links, only the matching one", () => {
    const content =
      "![[paper.pdf#page=3&selection=4,0,5,20&color=yellow|alias]] [[paper.pdf#page=9&rect=1,2,3,4]]";
    expect(removeAnnotationLink(content, subpath)).toBe(
      " [[paper.pdf#page=9&rect=1,2,3,4]]",
    );
  });

  it("removes a link whose alias contains brackets (template-generated)", () => {
    // Obsidian's grammar ends the link at the first `]]`, so an alias ending
    // in `]` keeps its last bracket outside the link; deletion mirrors that.
    const content =
      "see [[paper.pdf#page=3&selection=4,0,5,20&color=yellow|paper [3]]] here";
    expect(removeAnnotationLink(content, subpath)).toBe("see ] here");
    const mid = "note [[paper.pdf#page=3&selection=4,0,5,20&color=yellow|p. [3] f.]] x";
    expect(removeAnnotationLink(mid, subpath)).toBe("note  x");
  });

  it("deletes the link found elsewhere when the hint points at another line", () => {
    // The whole point of the two-phase scan: a stale hint that lands on a
    // real line with a *non-matching* link must not stop the deletion.
    const content = [
      "[[paper.pdf#page=9&rect=1,2,3,4]]",
      "prose",
      "[[paper.pdf#page=3&selection=4,0,5,20&color=yellow]]",
    ].join("\n");
    expect(removeAnnotationLink(content, subpath, 0)).toBe(
      ["[[paper.pdf#page=9&rect=1,2,3,4]]", "prose", ""].join("\n"),
    );
  });

  it("restarts at an inner [[ like Obsidian's parser", () => {
    const content =
      "x [[not a link [[paper.pdf#page=3&selection=4,0,5,20&color=yellow]] y";
    expect(removeAnnotationLink(content, subpath)).toBe("x [[not a link  y");
  });
});

describe("parseAnnotationLink", () => {
  it("classifies a subpath with params as an annotation and extracts the color", () => {
    expect(
      parseAnnotationLink("paper.pdf#page=3&selection=4,0,5,20&color=yellow"),
    ).toEqual({
      linkpath: "paper.pdf",
      params: { page: "3", selection: "4,0,5,20", color: "yellow" },
      color: "yellow",
    });
  });

  it("omits color when the param is absent", () => {
    expect(parseAnnotationLink("book.epub#epubcfi=/6/4!/2%3A0")).toEqual({
      linkpath: "book.epub",
      params: { epubcfi: "/6/4!/2%3A0" },
    });
  });

  it("rejects plain file links and heading/block references", () => {
    expect(parseAnnotationLink("paper.pdf")).toBeNull();
    expect(parseAnnotationLink("note.md#Some heading")).toBeNull();
    expect(parseAnnotationLink("note.md#^block-id")).toBeNull();
  });
});
