import { describe, expect, it } from "vitest";
import { TemplateEngine } from "./template-engine";

describe("TemplateEngine", () => {
  const engine = new TemplateEngine();

  it("expands the default snippet template of spec §6.6", () => {
    const out = engine.expand("> [!quote] {{linkWithDisplay}}\n> {{text}}", {
      linkWithDisplay: "[[paper.pdf#page=3|paper, p.3]]",
      text: "quoted passage",
    });
    expect(out).toBe("> [!quote] [[paper.pdf#page=3|paper, p.3]]\n> quoted passage");
  });

  it("supports dotted paths like {{file.basename}}", () => {
    expect(
      engine.expand("{{file.basename}}, p.{{page}}", {
        file: { basename: "paper" },
        page: 3,
      }),
    ).toBe("paper, p.3");
  });

  it("tolerates whitespace inside placeholders", () => {
    expect(engine.expand("{{ text }}!", { text: "hi" })).toBe("hi!");
  });

  it("expands unknown or nullish variables to the empty string", () => {
    expect(engine.expand("[{{missing}}][{{a.b.c}}][{{n}}]", { n: null })).toBe(
      "[][][]",
    );
  });

  it("stringifies non-string values, including 0 and false", () => {
    expect(engine.expand("{{zero}}/{{no}}", { zero: 0, no: false })).toBe("0/false");
  });

  it("leaves text without placeholders untouched", () => {
    expect(engine.expand("no placeholders { } {{", {})).toBe("no placeholders { } {{");
  });
});
