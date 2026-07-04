// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { injectCsp } from "./epub-security";

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"';

describe("injectCsp (RCE defense layer 3)", () => {
  it("injects the script-blocking meta as the first head child (text/html)", () => {
    const out = injectCsp(
      "<!DOCTYPE html><html><head><title>t</title></head><body><p>x</p></body></html>",
      "text/html",
    );
    const doc = new DOMParser().parseFromString(out, "text/html");
    const first = doc.querySelector("head")!.firstElementChild!;
    expect(first.tagName).toBe("META");
    expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first.getAttribute("content")).toBe("script-src 'none'");
    // Before any book content — a <meta> after a book element could be
    // preceded by an injection point.
    expect(out.indexOf(CSP_META)).toBeLessThan(out.indexOf("<title>"));
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain("<p>x</p>"); // body untouched (CFI safety)
  });

  it("injects into an XHTML section, preserving the XML shape", () => {
    const out = injectCsp(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>x</p></body></html>',
      "application/xhtml+xml",
    );
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain("<p>x</p>");
  });
});
