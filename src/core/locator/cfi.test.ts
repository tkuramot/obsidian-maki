import { describe, expect, it } from "vitest";
import { decodeCfi, encodeCfi, unwrapCfi, wrapCfi } from "./cfi";

describe("encodeCfi", () => {
  it("matches the spec §6.4 golden example", () => {
    expect(encodeCfi("/6/14[chap05]!/4/2/2,/1:0,/1:280")).toBe(
      "/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280",
    );
  });

  it("encodes every reserved character", () => {
    expect(encodeCfi("%[],&=#|():")).toBe(
      "%25%5B%5D%2C%26%3D%23%7C%28%29%3A",
    );
  });

  it("leaves slashes, bangs, and alphanumerics untouched", () => {
    expect(encodeCfi("/6/4!/2/text01")).toBe("/6/4!/2/text01");
  });
});

describe("decodeCfi", () => {
  it("reverses encodeCfi for arbitrary bodies", () => {
    const bodies = [
      "/6/14[chap05]!/4/2/2,/1:0,/1:280",
      "/6/4[id-with-%percent]!/2:5",
      "/2[章タイトル]!/4:0", // non-ASCII ids pass through raw
      "",
    ];
    for (const body of bodies) {
      expect(decodeCfi(encodeCfi(body))).toBe(body);
    }
  });

  it("returns null on malformed percent-encoding instead of throwing", () => {
    expect(decodeCfi("/6/4%ZZ")).toBeNull();
    expect(decodeCfi("/6/4%")).toBeNull();
  });
});

describe("wrapCfi / unwrapCfi", () => {
  it("wraps a body in epubcfi( … )", () => {
    expect(wrapCfi("/6/4!/2:0")).toBe("epubcfi(/6/4!/2:0)");
  });

  it("unwraps a wrapped CFI and round-trips with wrapCfi", () => {
    expect(unwrapCfi("epubcfi(/6/4!/2:0)")).toBe("/6/4!/2:0");
    expect(unwrapCfi(wrapCfi("/6/14[c],(x)"))).toBe("/6/14[c],(x)");
  });

  it("returns unwrapped input as-is", () => {
    expect(unwrapCfi("/6/4!/2:0")).toBe("/6/4!/2:0");
  });
});
