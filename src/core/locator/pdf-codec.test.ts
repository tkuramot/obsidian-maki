import { describe, expect, it } from "vitest";
import type { Locator, PdfLocator } from "../types";
import { describeCodecContract } from "./codec-contract";
import {
  isForwardTextRange,
  parseSelectionEndpoints,
  PdfLocatorCodec,
} from "./pdf-codec";

const textLocator: PdfLocator = {
  backend: "pdf",
  page: 3,
  target: { kind: "text", begin: [4, 0], end: [5, 20] },
};

const rectLocator: PdfLocator = {
  backend: "pdf",
  page: 7,
  target: { kind: "rect", rect: [72, 500, 520, 560] },
};

const annotationLocator: PdfLocator = {
  backend: "pdf",
  page: 12,
  target: { kind: "annotation", id: "123R" },
};

describeCodecContract("PdfLocatorCodec", PdfLocatorCodec, [
  textLocator,
  rectLocator,
  annotationLocator,
]);

describe("PdfLocatorCodec.encode", () => {
  it("produces the spec §6.3 golden params for a text selection", () => {
    expect(PdfLocatorCodec.encode(textLocator)).toEqual({
      page: "3",
      selection: "4,0,5,20",
    });
  });

  it("produces the spec §6.3 golden params for a rect", () => {
    expect(PdfLocatorCodec.encode(rectLocator)).toEqual({
      page: "7",
      rect: "72,500,520,560",
    });
  });

  it("keys page before the target key (persisted order)", () => {
    expect(Object.keys(PdfLocatorCodec.encode(textLocator))).toEqual([
      "page",
      "selection",
    ]);
  });

  it("preserves fractional rect coordinates", () => {
    const loc: PdfLocator = {
      backend: "pdf",
      page: 1,
      target: { kind: "rect", rect: [72.5, 500.25, 520, 560] },
    };
    expect(PdfLocatorCodec.encode(loc).rect).toBe("72.5,500.25,520,560");
  });

  it("rejects a non-PDF locator (programmer error)", () => {
    const epub: Locator = { backend: "epub", cfi: "/6/4!/2:0" };
    expect(() => PdfLocatorCodec.encode(epub)).toThrow();
  });
});

describe("PdfLocatorCodec.decode", () => {
  it("decodes the spec's example subpaths", () => {
    expect(
      PdfLocatorCodec.decode({ page: "3", selection: "4,0,5,20", color: "yellow" }),
    ).toEqual(textLocator);
    expect(PdfLocatorCodec.decode({ page: "7", rect: "72,500,520,560" })).toEqual(
      rectLocator,
    );
    expect(PdfLocatorCodec.decode({ page: "12", annotation: "123R" })).toEqual(
      annotationLocator,
    );
  });

  it("returns null when page is missing, non-integer, or < 1", () => {
    expect(PdfLocatorCodec.decode({ selection: "4,0,5,20" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "x", selection: "4,0,5,20" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3.5", selection: "4,0,5,20" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "0", selection: "4,0,5,20" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "-1", selection: "4,0,5,20" })).toBeNull();
  });

  it("returns null for malformed selections", () => {
    expect(PdfLocatorCodec.decode({ page: "3", selection: "4,0,5" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3", selection: "4,0,5,x" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3", selection: "4,0,5,-2" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3", selection: "" })).toBeNull();
  });

  it("returns null for malformed rects", () => {
    expect(PdfLocatorCodec.decode({ page: "3", rect: "72,500,520" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3", rect: "72,500,520,NaN" })).toBeNull();
  });

  it("returns null when the page has no target (page-only subpath)", () => {
    expect(PdfLocatorCodec.decode({ page: "3" })).toBeNull();
    expect(PdfLocatorCodec.decode({ page: "3", annotation: "" })).toBeNull();
  });

  it("never falls through a malformed higher-precedence target key", () => {
    // A present-but-broken `selection` means the locator is undecodable,
    // even when a valid lower-precedence key is also present.
    expect(
      PdfLocatorCodec.decode({ page: "3", selection: "bad", rect: "1,2,3,4" }),
    ).toBeNull();
    expect(
      PdfLocatorCodec.decode({ page: "3", rect: "bad", annotation: "1R" }),
    ).toBeNull();
  });
});

describe("parseSelectionEndpoints", () => {
  it("parses the native four-integer value, tolerating spaces", () => {
    expect(parseSelectionEndpoints("4,0,5,20")).toEqual({ begin: [4, 0], end: [5, 20] });
    expect(parseSelectionEndpoints("4, 0, 5, 20")).toEqual({
      begin: [4, 0],
      end: [5, 20],
    });
  });

  it("rejects wrong arity, non-integers, and negatives", () => {
    expect(parseSelectionEndpoints("4,0,5")).toBeNull();
    expect(parseSelectionEndpoints("4,0,5,20,1")).toBeNull();
    expect(parseSelectionEndpoints("4,0,5,x")).toBeNull();
    expect(parseSelectionEndpoints("4,0,5,2.5")).toBeNull();
    expect(parseSelectionEndpoints("4,0,-5,20")).toBeNull();
    expect(parseSelectionEndpoints("")).toBeNull();
  });

  it("does not validate endpoint order (an inverted value still parses)", () => {
    expect(parseSelectionEndpoints("5,20,4,0")).toEqual({ begin: [5, 20], end: [4, 0] });
  });
});

describe("isForwardTextRange", () => {
  it("accepts strictly forward ranges", () => {
    expect(isForwardTextRange([4, 0], [5, 20])).toBe(true);
    expect(isForwardTextRange([4, 0], [4, 1])).toBe(true);
  });

  it("rejects collapsed and inverted ranges", () => {
    expect(isForwardTextRange([4, 5], [4, 5])).toBe(false);
    expect(isForwardTextRange([4, 5], [4, 0])).toBe(false);
    expect(isForwardTextRange([5, 0], [4, 20])).toBe(false);
  });
});
