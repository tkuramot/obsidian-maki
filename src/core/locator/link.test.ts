import { describe, expect, it } from "vitest";
import type { DocumentRef, PdfLocator } from "../types";
import { EpubLocatorCodec } from "./epub-codec";
import { buildLink, highlightIdFor, parseSubpath, serializeSubpath } from "./link";
import { PdfLocatorCodec } from "./pdf-codec";

const paper: DocumentRef = { path: "paper.pdf", backend: "pdf" };
const book: DocumentRef = { path: "book.epub", backend: "epub" };

describe("buildLink (spec §6 golden examples)", () => {
  it("builds a PDF text-selection link with display and color", () => {
    expect(
      buildLink(paper, { page: "3", selection: "4,0,5,20", color: "yellow" }, "paper, p.3"),
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
