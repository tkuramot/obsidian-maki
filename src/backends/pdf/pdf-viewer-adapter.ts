/**
 * `PdfViewerAdapter` — `DocumentViewer` over Obsidian's native PDF.js view.
 * Humble: it converts between Obsidian/PDF.js reality and the
 * abstract types; the geometry math is `PdfGeometry` (core) and all
 * annotation decisions are the core's.
 *
 * Everything binds to private Obsidian internals and is version-guarded:
 * a missing field degrades (no selection / no highlight), never throws.
 */

import type {
  DocumentMetadata,
  DocumentViewer,
  RevealOutcome,
} from "../../core/document-viewer";
import { PdfLocatorCodec } from "../../core/locator/pdf-codec";
import { serializeSubpath } from "../../core/locator/link";
import { selectionRects, type Rect, type TextItemBox } from "../../core/pdf-geometry";
import type {
  Disposable,
  DocumentRef,
  Highlight,
  HighlightId,
  Locator,
  TextSelection,
} from "../../core/types";
import type {
  PdfJsPageView,
  PdfJsTextItem,
  PdfViewerChildLike,
  PdfViewLike,
} from "./pdf-internals";

const OVERLAY_CLASS = "maki-pdf-annotation-layer";
const HIGHLIGHT_CLASS = "maki-highlight";

/** getTextContent items → the pure-math boxes. */
function toItemBoxes(items: readonly PdfJsTextItem[]): TextItemBox[] {
  return items.map((item) => {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    return { rect: [x, y, x + item.width, y + item.height] as Rect, text: item.str };
  });
}

export class PdfViewerAdapter implements DocumentViewer {
  readonly backend = "pdf" as const;

  private readonly highlights = new Map<HighlightId, Highlight>();
  private readonly activateCbs = new Set<(id: HighlightId) => void>();
  private readonly selectionCbs = new Set<(sel: TextSelection | null) => void>();
  private readonly textItemCache = new Map<number, Promise<TextItemBox[]>>();
  private pageLabels: string[] | null = null;
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(
    readonly ref: DocumentRef,
    private readonly view: PdfViewLike,
    private readonly child: PdfViewerChildLike,
  ) {
    void this.child.pdfViewer?.pdfViewer?.pdfDocument
      ?.getPageLabels()
      .then((labels) => (this.pageLabels = labels))
      .catch(() => undefined);

    // PDF.js virtualizes pages: an offscreen page is destroyed together with
    // any injected overlay, so re-inject on every (re)render.
    const eventBus = this.child.pdfViewer?.eventBus;
    if (eventBus) {
      const onPageRendered = (data: unknown): void => {
        const pageNumber = (data as { pageNumber?: number }).pageNumber;
        if (typeof pageNumber === "number") void this.paintPage(pageNumber);
      };
      eventBus.on("pagerendered", onPageRendered);
      this.disposers.push(() => eventBus.off("pagerendered", onPageRendered));
    }

    const doc = this.containerEl()?.ownerDocument;
    if (doc) {
      const onSelectionChange = (): void => {
        const sel = this.captureSelection();
        for (const cb of this.selectionCbs) cb(sel);
      };
      doc.addEventListener("selectionchange", onSelectionChange);
      this.disposers.push(() => doc.removeEventListener("selectionchange", onSelectionChange));
    }
  }

  /** Tie an external binding (e.g. injected toolbar UI) to this viewer's lifetime. */
  own(dispose: () => void): void {
    if (this.destroyed) dispose();
    else this.disposers.push(dispose);
  }

  private containerEl(): HTMLElement | null {
    return this.child.containerEl ?? this.view.containerEl ?? null;
  }

  private pageView(pageNumber: number): PdfJsPageView | null {
    return this.child.pdfViewer?.pdfViewer?.getPageView(pageNumber - 1) ?? null;
  }

  // ---- navigation ----------------------------------------------------------

  async reveal(target: Locator, opts?: { flash?: boolean }): Promise<RevealOutcome> {
    if (target.backend !== "pdf") return "not-found";
    const pageCount = this.child.pdfViewer?.pdfViewer?.pagesCount ?? 0;
    if (target.page < 1 || (pageCount > 0 && target.page > pageCount)) return "not-found";

    // Obsidian's own subpath navigation scrolls and (for selection/rect)
    // flashes natively; without flash, navigate to the page only.
    const params = PdfLocatorCodec.encode(target);
    const subpath = serializeSubpath(opts?.flash === false ? { page: params["page"]! } : params);
    if (typeof this.child.applySubpath === "function") {
      this.child.applySubpath(`#${subpath}`);
    } else if (typeof this.view.setEphemeralState === "function") {
      this.view.setEphemeralState({ subpath });
    } else {
      return "not-found"; // internals changed; degrade
    }
    // Whether the exact text range still resolves is not observable through
    // the native navigation, so 'fallback' detection is approximated by the
    // page-bounds check above.
    return "exact";
  }

  // ---- selection -----------------------------------------------------------

  captureSelection(): TextSelection | null {
    const container = this.containerEl();
    const doc = container?.ownerDocument;
    const sel = doc?.defaultView?.getSelection() ?? null;
    if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    const startPage = this.pageElOf(range.startContainer);
    const endPage = this.pageElOf(range.endContainer);
    // Cross-page selections have no single-page locator; skip.
    if (!startPage || startPage !== endPage) return null;

    const pageNumber = Number(startPage.getAttribute("data-page-number"));
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
    const textDivs = this.pageView(pageNumber)?.textLayer?.textDivs;
    if (!textDivs || textDivs.length === 0) return null;

    const begin = this.endpointOf(range.startContainer, range.startOffset, textDivs, doc!);
    const end = this.endpointOf(range.endContainer, range.endOffset, textDivs, doc!);
    if (!begin || !end) return null;
    if (begin[0] > end[0] || (begin[0] === end[0] && begin[1] >= end[1])) return null;

    return {
      locator: { backend: "pdf", page: pageNumber, target: { kind: "text", begin, end } },
      text: sel.toString(),
    };
  }

  onSelectionChange(cb: (sel: TextSelection | null) => void): Disposable {
    this.selectionCbs.add(cb);
    return { dispose: () => this.selectionCbs.delete(cb) };
  }

  private pageElOf(node: Node): HTMLElement | null {
    const el = node instanceof Element ? node : node.parentElement;
    return el?.closest<HTMLElement>(".page[data-page-number]") ?? null;
  }

  /** DOM endpoint → Obsidian's (text item index, char offset) address. */
  private endpointOf(
    node: Node,
    offset: number,
    textDivs: HTMLElement[],
    doc: Document,
  ): [item: number, offset: number] | null {
    const el = node instanceof Element ? node : node.parentElement;
    const span = el?.closest<HTMLElement>(".textLayer span, .textLayer > *");
    if (!span) return null;
    // The span may be nested under a text-item div (marked content); resolve
    // to the indexed ancestor.
    let indexed: HTMLElement | null = span;
    let item = -1;
    while (indexed) {
      item = textDivs.indexOf(indexed);
      if (item >= 0) break;
      indexed = indexed.parentElement?.closest<HTMLElement>(".textLayer span") ?? null;
    }
    if (item < 0 || !indexed) return null;

    // Character offset within the whole item, robust to nested nodes.
    const r = doc.createRange();
    r.selectNodeContents(indexed);
    try {
      r.setEnd(node, offset);
    } catch {
      return null;
    }
    return [item, r.toString().length];
  }

  // ---- highlights ----------------------------------------------------------

  drawHighlight(h: Highlight): void {
    if (h.locator.backend !== "pdf") return;
    this.highlights.set(h.id, h);
    void this.paintHighlight(h);
  }

  eraseHighlight(id: HighlightId): void {
    this.highlights.delete(id);
    this.removeNodes(id);
  }

  clearHighlights(): void {
    this.highlights.clear();
    const container = this.containerEl();
    container?.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  }

  onHighlightActivate(cb: (id: HighlightId) => void): Disposable {
    this.activateCbs.add(cb);
    return { dispose: () => this.activateCbs.delete(cb) };
  }

  /** Re-inject a page's highlights after PDF.js (re)renders it. */
  private async paintPage(pageNumber: number): Promise<void> {
    for (const h of this.highlights.values()) {
      if (h.locator.backend === "pdf" && h.locator.page === pageNumber) {
        await this.paintHighlight(h);
      }
    }
  }

  /** Best-effort: an unresolvable locator draws nothing and never throws. */
  private async paintHighlight(h: Highlight): Promise<void> {
    try {
      if (h.locator.backend !== "pdf") return;
      const pageView = this.pageView(h.locator.page);
      const viewport = pageView?.viewport;
      const pageEl = pageView?.div;
      if (!pageView || !viewport || !pageEl) return; // page not rendered yet

      let rects: Rect[];
      const target = h.locator.target;
      if (target.kind === "text") {
        const items = await this.textItems(h.locator.page);
        rects = selectionRects(items, target.begin, target.end);
      } else if (target.kind === "rect") {
        rects = [target.rect];
      } else {
        return; // 'annotation' targets are embedded PDF annotations (not yet drawn)
      }
      if (this.destroyed || rects.length === 0) return;

      const overlay = this.ensureOverlay(pageEl);
      this.removeNodes(h.id);
      for (const rect of rects) {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const el = overlay.ownerDocument.createElement("div");
        el.className = HIGHLIGHT_CLASS;
        el.dataset["makiId"] = h.id;
        // Percentages survive zoom changes between re-renders.
        el.style.left = `${(left / viewport.width) * 100}%`;
        el.style.top = `${(top / viewport.height) * 100}%`;
        el.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
        el.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
        el.style.backgroundColor = `rgba(${h.color.rgb.join(",")}, var(--maki-highlight-opacity, 0.35))`;
        el.addEventListener("click", () => {
          for (const cb of this.activateCbs) cb(h.id);
        });
        overlay.append(el);
      }
    } catch (error) {
      console.error("Maki: PDF highlight failed", error);
    }
  }

  private ensureOverlay(pageEl: HTMLElement): HTMLElement {
    const existing = pageEl.querySelector<HTMLElement>(`:scope > .${OVERLAY_CLASS}`);
    if (existing) return existing;
    const overlay = pageEl.ownerDocument.createElement("div");
    overlay.className = OVERLAY_CLASS;
    pageEl.append(overlay);
    return overlay;
  }

  private removeNodes(id: HighlightId): void {
    const container = this.containerEl();
    container
      ?.querySelectorAll(`.${HIGHLIGHT_CLASS}[data-maki-id="${CSS.escape(id)}"]`)
      .forEach((el) => el.remove());
  }

  private textItems(pageNumber: number): Promise<TextItemBox[]> {
    const cached = this.textItemCache.get(pageNumber);
    if (cached) return cached;
    const pdfDocument = this.child.pdfViewer?.pdfViewer?.pdfDocument;
    const promise = pdfDocument
      ? pdfDocument
          .getPage(pageNumber)
          .then((page) => page.getTextContent())
          .then((content) => toItemBoxes(content.items))
      : Promise.resolve([]);
    this.textItemCache.set(pageNumber, promise);
    return promise;
  }

  // ---- metadata / lifecycle ------------------------------------------------

  metadata(): DocumentMetadata {
    const meta: DocumentMetadata = {};
    const basename = this.ref.path.slice(this.ref.path.lastIndexOf("/") + 1);
    meta.title = basename.replace(/\.pdf$/i, "");
    const pageCount = this.child.pdfViewer?.pdfViewer?.pagesCount;
    if (typeof pageCount === "number") meta.pageCount = pageCount;
    if (this.pageLabels) meta.pageLabels = this.pageLabels;
    return meta;
  }

  destroy(): void {
    this.destroyed = true;
    this.clearHighlights();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.activateCbs.clear();
    this.selectionCbs.clear();
  }
}
