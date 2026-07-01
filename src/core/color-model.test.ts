import { describe, expect, it } from "vitest";
import { ColorModel } from "./color-model";

describe("ColorModel", () => {
  const colors = new ColorModel({ yellow: [255, 208, 0], mint: [68, 207, 110] });

  it("resolves palette names", () => {
    expect(colors.fromName("yellow")).toEqual({ name: "yellow", rgb: [255, 208, 0] });
    expect(colors.fromName("magenta")).toBeNull();
  });

  it("parses a palette name value", () => {
    expect(colors.parse("mint")).toEqual({ name: "mint", rgb: [68, 207, 110] });
  });

  it("parses an r,g,b value", () => {
    expect(colors.parse("0,200,120")).toEqual({ rgb: [0, 200, 120] });
    expect(colors.parse("0, 200, 120")).toEqual({ rgb: [0, 200, 120] });
  });

  it("rejects malformed values", () => {
    expect(colors.parse("")).toBeNull();
    expect(colors.parse("0,200")).toBeNull();
    expect(colors.parse("0,200,120,4")).toBeNull();
    expect(colors.parse("0,200,999")).toBeNull();
    expect(colors.parse("0,200,-1")).toBeNull();
    expect(colors.parse("r,g,b")).toBeNull();
  });

  it("serializes to the name when present, else r,g,b", () => {
    expect(colors.serialize({ name: "yellow", rgb: [255, 208, 0] })).toBe("yellow");
    expect(colors.serialize({ rgb: [0, 200, 120] })).toBe("0,200,120");
  });

  it("round-trips parse ∘ serialize for both value shapes", () => {
    for (const value of ["yellow", "0,200,120"]) {
      const color = colors.parse(value)!;
      expect(colors.serialize(color)).toBe(value);
    }
  });
});
