// Runs against the real vendored foliate epubcfi module (vitest resolves the
// `foliate-js` alias to the submodule), so it also guards against fork drift.
import { describe, expect, it } from "vitest";
import { isInvertedRangeCfi } from "./cfi-order";

describe("isInvertedRangeCfi", () => {
  it("accepts a forward range CFI", () => {
    expect(isInvertedRangeCfi("epubcfi(/6/4!/2,/1:0,/1:5)")).toBe(false);
    expect(isInvertedRangeCfi("epubcfi(/6/4!/2,/1:0,/3:2)")).toBe(false);
  });

  it("rejects an inverted range CFI", () => {
    expect(isInvertedRangeCfi("epubcfi(/6/4!/2,/1:5,/1:0)")).toBe(true);
    expect(isInvertedRangeCfi("epubcfi(/6/4!/2,/3:2,/1:0)")).toBe(true);
  });

  it("treats a point CFI (no range) as not inverted", () => {
    expect(isInvertedRangeCfi("epubcfi(/6/4!/2:0)")).toBe(false);
  });

  it("never throws on junk input (foliate parses it leniently)", () => {
    // foliate's parser does not throw on junk — it compares equal, so junk
    // passes here and fails later at draw time. The try/catch is defensive.
    expect(isInvertedRangeCfi("garbage")).toBe(false);
    expect(isInvertedRangeCfi("")).toBe(false);
  });
});
