// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { transformSectionHtml } from "./section-transform";

const XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>one</p><p>two</p></body></html>`;

const HTML = "<!DOCTYPE html><html><head><title>t</title></head><body><p>one</p><p>two</p></body></html>";

describe("transformSectionHtml", () => {
  it("returns the source byte-identical when mutate reports no change", () => {
    expect(transformSectionHtml(HTML, "text/html", () => false)).toBe(HTML);
    expect(transformSectionHtml(XHTML, "application/xhtml+xml", () => false)).toBe(XHTML);
  });

  it("re-prepends the DOCTYPE for text/html and keeps the body intact", () => {
    const out = transformSectionHtml(HTML, "text/html", (doc) => {
      doc.querySelector("head")!.append(doc.createElement("meta"));
      return true;
    });
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    // CFI safety: body children must be untouched (indices are addressed).
    expect(out).toContain("<p>one</p><p>two</p>");
    expect(out).toContain("<meta>");
  });

  it("serializes XHTML as XML, preserving the namespace and body", () => {
    const out = transformSectionHtml(XHTML, "application/xhtml+xml", (doc) => {
      doc.querySelector("head")!.append(doc.createElementNS("http://www.w3.org/1999/xhtml", "meta"));
      return true;
    });
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain("<p>one</p><p>two</p>");
    expect(out).not.toContain("<!DOCTYPE"); // XML path adds no HTML doctype
  });
});
