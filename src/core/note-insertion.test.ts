import { describe, expect, it } from "vitest";
import { insertionBlock } from "./note-insertion";

describe("insertionBlock", () => {
  it("appends only a trailing newline at a line start", () => {
    expect(insertionBlock("> [!quote] text", true)).toBe("> [!quote] text\n");
  });

  it("first breaks onto a fresh line mid-line", () => {
    expect(insertionBlock("> [!quote] text", false)).toBe("\n> [!quote] text\n");
  });
});
