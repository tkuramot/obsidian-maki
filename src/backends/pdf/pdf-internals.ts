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
