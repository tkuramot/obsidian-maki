/**
 * Structural types for the private Obsidian / PDF.js view stack the PDF
 * adapter binds to:
 *
 *   PDFView → PDFViewerComponent (viewer) → PDFViewerChild (child)
 *           → ObsidianViewer (pdfViewer) → pdfjsViewer.PDFViewer
 *
 * These APIs are undocumented and can change between Obsidian versions
 * (obsidian-typings documents them more fully). Every field is optional and
 * every access site must guard and degrade gracefully — types here are
 * documentation, not a guarantee.
 */

import type { TFile } from "obsidian";

/** PDF.js page viewport (current zoom/rotation applied). */
export interface PdfJsViewport {
  width: number;
  height: number;
  /** PDF user-space rect → viewport CSS-pixel rect (unnormalized). */
  convertToViewportRectangle(
    rect: [left: number, bottom: number, right: number, top: number],
  ): [number, number, number, number];
}

export interface PdfJsTextLayer {
  div?: HTMLElement;
  /** One rendered span per text-content item, aligned by index. */
  textDivs?: HTMLElement[];
  /**
   * pdf.js ≥4 moved the render state into a nested `TextLayer`: the page
   * view's `textLayer` is then a `TextLayerBuilder` whose `textDivs` live
   * here instead (obsidian-pdf-plus shims the same split).
   */
  textLayer?: PdfJsTextLayer | null;
}

export interface PdfJsPageView {
  div?: HTMLElement;
  viewport?: PdfJsViewport;
  textLayer?: PdfJsTextLayer | null;
}

/** One item of `getTextContent()` — the geometry source for highlights. */
export interface PdfJsTextItem {
  str: string;
  /** PDF transform matrix [a, b, c, d, e, f]; (e, f) is the origin. */
  transform: number[];
  width: number;
  height: number;
}

export interface PdfJsDocument {
  numPages?: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
  }>;
  getPageLabels(): Promise<string[] | null>;
}

/** pdfjsViewer.PDFViewer */
export interface PdfJsViewer {
  pagesCount?: number;
  pdfDocument?: PdfJsDocument | null;
  getPageView(pageIndex: number): PdfJsPageView | null | undefined;
}

export interface PdfJsEventBus {
  on(name: string, listener: (data: unknown) => void): void;
  off(name: string, listener: (data: unknown) => void): void;
}

/** ObsidianViewer — Obsidian's wrapper around pdfjsViewer.PDFViewer. */
export interface ObsidianViewerLike {
  eventBus?: PdfJsEventBus | null;
  pdfViewer?: PdfJsViewer | null;
}

/** PDFViewerChild — one open PDF document inside a PDFView. */
export interface PdfViewerChildLike {
  containerEl?: HTMLElement;
  pdfViewer?: ObsidianViewerLike | null;
  /** Navigate to an Obsidian PDF subpath (`#page=…&selection=…`). */
  applySubpath?(subpath: string): unknown;
  /**
   * Obsidian's own DOM-selection → `beginIdx,beginOff,endIdx,endOff` helper
   * (it powers the native "Copy link to selection"). Preferred over walking
   * the text layer ourselves: it tracks pdf.js's DOM across versions.
   */
  getTextSelectionRangeStr?(pageEl: HTMLElement): string | null;
  /**
   * The pending native subpath highlight (set by `applySubpath`), re-applied
   * by Obsidian whenever the target page's text layer (re)renders. For a
   * `selection=` subpath: `{ type: "text", page, range }`.
   */
  subpathHighlight?: { type?: string; page?: number; range?: unknown } | null;
  /**
   * Paint the native persistent text highlight for a `selection=` subpath;
   * `range` is `[[beginItem, beginOffset], [endItem, endOffset]]` in the same
   * text-item convention the locator format reuses.
   */
  highlightText?(pageNumber: number, range: [[number, number], [number, number]]): unknown;
  /** Remove the native text highlight painted by `highlightText`. */
  clearTextHighlight?(): unknown;
}

/** PDFViewerComponent — `PDFView.viewer`; thenable once the child exists. */
export interface PdfViewerComponentLike {
  child?: PdfViewerChildLike | null;
  then?(onLoad: (child: PdfViewerChildLike) => unknown): unknown;
}

/** The native `pdf` FileView. */
export interface PdfViewLike {
  file?: TFile | null;
  containerEl?: HTMLElement;
  viewer?: PdfViewerComponentLike | null;
  setEphemeralState?(state: unknown): void;
}
