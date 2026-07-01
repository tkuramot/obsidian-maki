import { describe, expect, it } from "vitest";
import type { DocumentRef } from "./types";
import type { ViewerProvider } from "./viewer-provider";
import { ViewerRegistry } from "./viewer-registry";

function providerFor(extension: string, backend: "pdf" | "epub"): ViewerProvider {
  return {
    backend,
    canHandle: (ref: DocumentRef) => ref.path.endsWith(extension),
    setup: () => ({ dispose: () => {} }),
    acquire: () => Promise.reject(new Error("not needed in this test")),
  };
}

describe("ViewerRegistry", () => {
  const pdfRef: DocumentRef = { path: "paper.pdf", backend: "pdf" };
  const epubRef: DocumentRef = { path: "book.epub", backend: "epub" };

  it("selects the provider that can handle the ref", () => {
    const registry = new ViewerRegistry();
    const pdf = providerFor(".pdf", "pdf");
    const epub = providerFor(".epub", "epub");
    registry.register(pdf);
    registry.register(epub);
    expect(registry.providerFor(pdfRef)).toBe(pdf);
    expect(registry.providerFor(epubRef)).toBe(epub);
  });

  it("returns null when no provider matches", () => {
    const registry = new ViewerRegistry();
    registry.register(providerFor(".pdf", "pdf"));
    expect(registry.providerFor(epubRef)).toBeNull();
  });

  it("prefers earlier registrations on ties (native beats fallback)", () => {
    const registry = new ViewerRegistry();
    const native = providerFor(".epub", "epub");
    const fallback = providerFor(".epub", "epub");
    registry.register(native);
    registry.register(fallback);
    expect(registry.providerFor(epubRef)).toBe(native);
  });

  it("stops selecting a provider once its registration is disposed", () => {
    const registry = new ViewerRegistry();
    const pdf = providerFor(".pdf", "pdf");
    const registration = registry.register(pdf);
    registration.dispose();
    expect(registry.providerFor(pdfRef)).toBeNull();
  });
});
