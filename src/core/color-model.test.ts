import { describe, expect, it } from "vitest";
import {
  ColorModel,
  hexToRgb,
  isValidPaletteName,
  nextColorName,
  renamePaletteColor,
  rgbToHex,
  type Palette,
} from "./color-model";

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

describe("isValidPaletteName", () => {
  it("accepts word characters and dashes", () => {
    expect(isValidPaletteName("yellow")).toBe(true);
    expect(isValidPaletteName("color-2")).toBe(true);
    expect(isValidPaletteName("A_b1")).toBe(true);
  });

  it("rejects names that would break the link subpath", () => {
    expect(isValidPaletteName("")).toBe(false);
    expect(isValidPaletteName("has space")).toBe(false);
    expect(isValidPaletteName("a&b")).toBe(false);
    expect(isValidPaletteName("a=b")).toBe(false);
    expect(isValidPaletteName("a|b")).toBe(false);
    expect(isValidPaletteName("a#b")).toBe(false);
  });
});

describe("rgbToHex / hexToRgb", () => {
  it("round-trips and pads single-digit channels", () => {
    expect(rgbToHex([255, 208, 0])).toBe("#ffd000");
    expect(rgbToHex([0, 8, 15])).toBe("#00080f");
    expect(hexToRgb("#ffd000")).toEqual([255, 208, 0]);
    expect(hexToRgb("#FFD000")).toEqual([255, 208, 0]); // case-insensitive
    expect(hexToRgb(rgbToHex([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it("rejects anything but a 6-digit hex color", () => {
    expect(hexToRgb("#fd0")).toBeNull(); // 3-digit shorthand
    expect(hexToRgb("ffd000")).toBeNull(); // missing '#'
    expect(hexToRgb("#ffd00")).toBeNull();
    expect(hexToRgb("#ffd0000")).toBeNull();
    expect(hexToRgb("#ggd000")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("renamePaletteColor", () => {
  it("renames the key while keeping entry order", () => {
    const palette: Palette = {
      yellow: [255, 208, 0],
      red: [255, 86, 86],
      blue: [84, 155, 255],
    };
    const renamed = renamePaletteColor(palette, "red", "crimson");
    expect(Object.keys(renamed)).toEqual(["yellow", "crimson", "blue"]);
    expect(renamed.crimson).toEqual([255, 86, 86]);
    expect(palette.red).toEqual([255, 86, 86]); // input untouched
  });

  it("returns an equal palette when the key does not exist", () => {
    const palette: Palette = { yellow: [255, 208, 0] };
    expect(renamePaletteColor(palette, "nope", "x")).toEqual(palette);
  });
});

describe("nextColorName", () => {
  it("returns the first free color-N slot", () => {
    expect(nextColorName({})).toBe("color-1");
    expect(nextColorName({ "color-1": [0, 0, 0] })).toBe("color-2");
    expect(nextColorName({ "color-1": [0, 0, 0], "color-3": [0, 0, 0] })).toBe("color-2");
  });
});
