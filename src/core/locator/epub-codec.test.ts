import { describe, expect, it } from "vitest";
import type { EpubLocator, Locator } from "../types";
import { describeCodecContract } from "./codec-contract";
import { EpubLocatorCodec } from "./epub-codec";

const rangeLocator: EpubLocator = {
  backend: "epub",
  cfi: "/6/14[chap05]!/4/2/2,/1:0,/1:280",
};

const pointLocator: EpubLocator = {
  backend: "epub",
  cfi: "/6/4!/2:0",
};

describeCodecContract("EpubLocatorCodec", EpubLocatorCodec, [
  rangeLocator,
  pointLocator,
]);

describe("EpubLocatorCodec.encode", () => {
  it("produces the spec §6.4 golden value", () => {
    expect(EpubLocatorCodec.encode(rangeLocator)).toEqual({
      epubcfi: "/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280",
    });
  });

  it("rejects a non-EPUB locator (programmer error)", () => {
    const pdf: Locator = {
      backend: "pdf",
      page: 1,
      target: { kind: "annotation", id: "1R" },
    };
    expect(() => EpubLocatorCodec.encode(pdf)).toThrow();
  });
});

describe("EpubLocatorCodec.decode", () => {
  it("decodes the spec's golden value, ignoring color", () => {
    expect(
      EpubLocatorCodec.decode({
        epubcfi: "/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280",
        color: "yellow",
      }),
    ).toEqual(rangeLocator);
  });

  it("returns null when the key is missing or empty", () => {
    expect(EpubLocatorCodec.decode({})).toBeNull();
    expect(EpubLocatorCodec.decode({ epubcfi: "" })).toBeNull();
  });

  it("returns null for malformed percent-encoding", () => {
    expect(EpubLocatorCodec.decode({ epubcfi: "/6/4%ZZ" })).toBeNull();
  });
});
