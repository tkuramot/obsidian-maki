import { describe, expect, it } from "vitest";
import {
  mergeRects,
  selectionRects,
  toItemBoxes,
  type TextItemBox,
} from "./pdf-geometry";

/** A fixture line of two 100-wide items, then a second line below. */
const items: TextItemBox[] = [
  { rect: [0, 700, 100, 712], text: "aaaaaaaaaa" }, // 10 chars ⇒ 10/char
  { rect: [100, 700, 200, 712], text: "bbbbbbbbbb" },
  { rect: [0, 680, 150, 692], text: "cccccccccc" },
];

describe("selectionRects", () => {
  it("takes a proportional slice of a single item", () => {
    expect(selectionRects(items, [0, 2], [0, 5])).toEqual([[20, 700, 50, 712]]);
  });

  it("spans items and merges rects on the same line", () => {
    // From char 5 of item 0 through char 4 of item 1 — one merged rect.
    expect(selectionRects(items, [0, 5], [1, 4])).toEqual([[50, 700, 140, 712]]);
  });

  it("keeps separate lines as separate rects", () => {
    expect(selectionRects(items, [1, 5], [2, 4])).toEqual([
      [150, 700, 200, 712],
      [0, 680, 60, 692],
    ]);
  });

  it("clamps offsets beyond the item text", () => {
    expect(selectionRects(items, [0, 0], [0, 99])).toEqual([[0, 700, 100, 712]]);
  });

  it("returns [] for empty or inverted ranges", () => {
    expect(selectionRects(items, [0, 5], [0, 5])).toEqual([]);
    expect(selectionRects(items, [1, 0], [0, 5])).toEqual([]);
  });

  it("returns [] for out-of-range item indices (best-effort, no throw)", () => {
    expect(selectionRects(items, [-1, 0], [0, 5])).toEqual([]);
    expect(selectionRects(items, [0, 0], [99, 5])).toEqual([]);
  });

  it("skips empty text items inside the range", () => {
    const withEmpty: TextItemBox[] = [
      items[0]!,
      { rect: [100, 700, 100, 712], text: "" },
      items[1]!,
    ];
    expect(selectionRects(withEmpty, [0, 5], [2, 4])).toEqual([[50, 700, 140, 712]]);
  });
});

describe("mergeRects", () => {
  it("merges touching rects on the same line", () => {
    expect(
      mergeRects([
        [0, 700, 50, 712],
        [50, 700, 90, 712],
      ]),
    ).toEqual([[0, 700, 90, 712]]);
  });

  it("merges overlapping rects but not gapped ones", () => {
    expect(
      mergeRects([
        [0, 700, 60, 712],
        [50, 700, 90, 712],
        [120, 700, 150, 712],
      ]),
    ).toEqual([
      [0, 700, 90, 712],
      [120, 700, 150, 712],
    ]);
  });

  it("never merges across lines and orders top line first", () => {
    expect(
      mergeRects([
        [0, 680, 50, 692],
        [0, 700, 50, 712],
      ]),
    ).toEqual([
      [0, 700, 50, 712],
      [0, 680, 50, 692],
    ]);
  });

  it("does not mutate its input", () => {
    const input: [number, number, number, number][] = [
      [0, 700, 50, 712],
      [50, 700, 90, 712],
    ];
    mergeRects(input);
    expect(input).toEqual([
      [0, 700, 50, 712],
      [50, 700, 90, 712],
    ]);
  });
});

describe("toItemBoxes", () => {
  it("reads the item origin from transform[4]/[5] and spans width/height", () => {
    expect(
      toItemBoxes([
        { transform: [12, 0, 0, 12, 72, 700], width: 100, height: 12, str: "hello" },
      ]),
    ).toEqual([{ rect: [72, 700, 172, 712], text: "hello" }]);
  });

  it("defaults a missing origin to 0 (defensive against truncated matrices)", () => {
    expect(toItemBoxes([{ transform: [], width: 10, height: 5, str: "x" }])).toEqual([
      { rect: [0, 0, 10, 5], text: "x" },
    ]);
  });
});
