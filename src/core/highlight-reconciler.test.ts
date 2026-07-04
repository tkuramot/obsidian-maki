import { beforeEach, describe, expect, it } from "vitest";
import { ColorModel } from "./color-model";
import { FakeDocumentViewer } from "../../test/fake-document-viewer";
import { HighlightReconciler } from "./highlight-reconciler";
import type { Codecs } from "./locator/codec";
import { EpubLocatorCodec } from "./locator/epub-codec";
import { PdfLocatorCodec } from "./locator/pdf-codec";
import type { BacklinkEntry, Color, SubpathParams } from "./types";

const codecs: Codecs = { pdf: PdfLocatorCodec, epub: EpubLocatorCodec };
const colors = new ColorModel({ yellow: [255, 208, 0], red: [255, 86, 86] });
const defaultColor: Color = { name: "yellow", rgb: [255, 208, 0] };

function entry(
  subpath: SubpathParams,
  source: { path: string; line?: number },
  color?: string,
): BacklinkEntry {
  return color !== undefined ? { subpath, source, color } : { subpath, source };
}

const page3: SubpathParams = { page: "3", selection: "4,0,5,20" };
const page7: SubpathParams = { page: "7", rect: "72,500,520,560" };

describe("HighlightReconciler", () => {
  let reconciler: HighlightReconciler;
  let viewer: FakeDocumentViewer;

  beforeEach(() => {
    reconciler = new HighlightReconciler(codecs, colors, defaultColor);
    viewer = new FakeDocumentViewer({ path: "paper.pdf", backend: "pdf" });
  });

  it("draws a highlight per decodable entry", () => {
    const summary = reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 1 }, "red"),
      entry(page7, { path: "a.md", line: 9 }),
    ]);
    expect(summary).toEqual({ drawn: 2, skipped: 0 });
    expect(viewer.highlights.size).toBe(2);
    const drawn = [...viewer.highlights.values()];
    expect(drawn[0]!.color.name).toBe("red");
    expect(drawn[1]!.color).toEqual(defaultColor); // no color ⇒ default
  });

  it("is incremental: unchanged entries are not redrawn (FR-5.3)", () => {
    const entries = [entry(page3, { path: "a.md", line: 1 }, "red")];
    reconciler.reconcile(viewer, entries);
    viewer.calls.length = 0;
    reconciler.reconcile(viewer, entries);
    expect(viewer.calls).toEqual([]);
  });

  it("erases a highlight when its entry disappears", () => {
    reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 1 }),
      entry(page7, { path: "a.md", line: 9 }),
    ]);
    viewer.calls.length = 0;
    const summary = reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 1 }),
    ]);
    expect(summary.drawn).toBe(1);
    expect(viewer.calls).toEqual([{ op: "erase", id: "pdf:page=7&rect=72,500,520,560" }]);
  });

  it("redraws in place on recolor (idempotent by id)", () => {
    reconciler.reconcile(viewer, [entry(page3, { path: "a.md", line: 1 }, "red")]);
    viewer.calls.length = 0;
    reconciler.reconcile(viewer, [entry(page3, { path: "a.md", line: 1 }, "0,200,120")]);
    expect(viewer.calls).toHaveLength(1);
    expect(viewer.calls[0]).toMatchObject({ op: "draw" });
    expect(viewer.highlights.size).toBe(1);
    expect([...viewer.highlights.values()][0]!.color.rgb).toEqual([0, 200, 120]);
  });

  it("merges duplicate targets into one highlight with all sources (FR-5.6)", () => {
    const summary = reconciler.reconcile(viewer, [
      entry(page3, { path: "b.md", line: 2 }, "red"),
      entry(page3, { path: "a.md", line: 5 }, "0,200,120"),
    ]);
    expect(summary.drawn).toBe(1);
    const highlight = [...viewer.highlights.values()][0]!;
    // First in *note-path order* wins, regardless of input order: a.md.
    expect(highlight.color.rgb).toEqual([0, 200, 120]);
    expect(highlight.sources).toEqual([
      { path: "a.md", line: 5 },
      { path: "b.md", line: 2 },
    ]);
  });

  it("counts undecodable entries as skipped without blocking others (FR-5.5)", () => {
    const summary = reconciler.reconcile(viewer, [
      entry({ page: "x", selection: "bad" }, { path: "a.md", line: 1 }),
      entry({}, { path: "a.md", line: 2 }),
      entry(page3, { path: "a.md", line: 3 }),
    ]);
    expect(summary).toEqual({ drawn: 1, skipped: 2 });
  });

  it("falls back to the default color for an unknown color value", () => {
    reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 1 }, "no-such-color"),
    ]);
    expect([...viewer.highlights.values()][0]!.color).toEqual(defaultColor);
  });

  it("keeps per-viewer state: two open documents never cross-wire", () => {
    const epubViewer = new FakeDocumentViewer({ path: "book.epub", backend: "epub" });
    reconciler.reconcile(viewer, [entry(page3, { path: "a.md", line: 1 })]);
    reconciler.reconcile(epubViewer, [
      entry({ epubcfi: "/6/4!/2%3A0" }, { path: "a.md", line: 2 }),
    ]);
    // Emptying the EPUB viewer must not erase the PDF viewer's highlight.
    reconciler.reconcile(epubViewer, []);
    expect(epubViewer.highlights.size).toBe(0);
    expect(viewer.highlights.size).toBe(1);
  });

  it("getHighlight resolves a drawn id to its highlight, per viewer (FR-6.2)", () => {
    reconciler.reconcile(viewer, [entry(page3, { path: "a.md", line: 1 })]);
    const id = "pdf:page=3&selection=4,0,5,20";
    expect(reconciler.getHighlight(viewer, id)?.sources).toEqual([
      { path: "a.md", line: 1 },
    ]);
    expect(reconciler.getHighlight(viewer, "pdf:page=9&selection=0,0,0,1")).toBeNull();
    const other = new FakeDocumentViewer({ path: "other.pdf", backend: "pdf" });
    expect(reconciler.getHighlight(other, id)).toBeNull();
    reconciler.detach(viewer);
    expect(reconciler.getHighlight(viewer, id)).toBeNull();
  });

  it("detach forgets state so a reopened viewer redraws from scratch", () => {
    const entries = [entry(page3, { path: "a.md", line: 1 })];
    reconciler.reconcile(viewer, entries);
    reconciler.detach(viewer);
    viewer.calls.length = 0;
    reconciler.reconcile(viewer, entries);
    expect(viewer.calls).toHaveLength(1);
    expect(viewer.calls[0]).toMatchObject({ op: "draw" });
  });

  it("recolors and redraws when the color-winning source disappears", () => {
    // Two notes on one locator: a.md (first in note-path order) wins with
    // green. Removing a.md must flip the highlight to b.md's red — a redraw,
    // not a silent keep of the stale color.
    reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 5 }, "0,200,120"),
      entry(page3, { path: "b.md", line: 2 }, "red"),
    ]);
    viewer.calls.length = 0;
    reconciler.reconcile(viewer, [entry(page3, { path: "b.md", line: 2 }, "red")]);
    expect(viewer.calls).toHaveLength(1);
    expect(viewer.calls[0]).toMatchObject({ op: "draw" });
    const highlight = [...viewer.highlights.values()][0]!;
    expect(highlight.color.name).toBe("red");
    expect(highlight.sources).toEqual([{ path: "b.md", line: 2 }]);
  });

  it("redraws when a source note is added to an existing highlight", () => {
    reconciler.reconcile(viewer, [entry(page3, { path: "a.md", line: 1 })]);
    viewer.calls.length = 0;
    reconciler.reconcile(viewer, [
      entry(page3, { path: "a.md", line: 1 }),
      entry(page3, { path: "b.md", line: 4 }),
    ]);
    expect(viewer.calls).toHaveLength(1);
    expect([...viewer.highlights.values()][0]!.sources).toHaveLength(2);
  });
});
