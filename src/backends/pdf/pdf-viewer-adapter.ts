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
import { around } from "monkey-around";
import { PdfLocatorCodec } from "../../core/locator/pdf-codec";
import { highlightIdFor, serializeSubpath } from "../../core/locator/link";
import { selectionRects, type Rect, type TextItemBox } from "../../core/pdf-geometry";
import type {
  Disposable,
  DocumentRef,
  Highlight,
  HighlightId,
  Locator,
  TextSelection,
} from "../../core/types";
import { snapToTextEndpoints } from "../snap-range";
import type {
  PdfJsPageView,
  PdfJsTextItem,
  PdfViewerChildLike,
  PdfViewLike,
} from "./pdf-internals";

const OVERLAY_CLASS = "maki-pdf-annotation-layer";
const HIGHLIGHT_CLASS = "maki-highlight";

/**
 * The page's text-item spans, across pdf.js versions: pdf.js ≥4 nests the
 * real `TextLayer` (which owns `textDivs`) inside the page view's
 * `textLayer` builder; older versions put `textDivs` on the builder itself.
 */
function textDivsOf(pageView: PdfJsPageView | null): HTMLElement[] | null {
  const builder = pageView?.textLayer;
  if (!builder) return null;
  return (builder.textLayer ?? builder).textDivs ?? null;
}

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
  private readonly dragCbs = new Set<(dragging: boolean) => void>();
  private readonly textItemCache = new Map<number, Promise<TextItemBox[]>>();
  /**
   * The last live selection, kept when another pane steals the (window-wide)
   * DOM selection — e.g. focusing the note to paste into. Cleared only by a
   * pointerdown on a page, i.e. the user acting inside the document again.
   */
  private remembered: TextSelection | null = null;
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

    // Opening a `selection=` subpath makes Obsidian paint its own persistent
    // text highlight — doubled up with Maki's for every annotation link.
    // Suppress the native paint for ranges Maki draws; anything Maki does not
    // draw keeps the native behavior. Instance wrap, no prototype patch.
    if (typeof this.child.highlightText === "function") {
      const adapter = this;
      this.disposers.push(
        around(this.child, {
          highlightText: (next) =>
            function (
              this: PdfViewerChildLike,
              pageNumber: number,
              range: [[number, number], [number, number]],
            ) {
              if (adapter.makiHighlightIdAt(pageNumber, range)) return undefined;
              return next?.call(this, pageNumber, range);
            },
        }),
      );
    }

    const container = this.containerEl();
    const doc = container?.ownerDocument;
    if (container && doc) {
      // A vanished DOM selection is ambiguous: cleared by the user acting in
      // the viewer, or stolen by another pane (the window shares one
      // selection). Only pointerdown on a page counts as intent; everything
      // else keeps `remembered` alive so annotate still works after the user
      // focuses the note they want to paste into.
      const onSelectionChange = (): void => {
        const live = this.liveSelection();
        if (!live) return;
        this.remembered = live;
        for (const cb of this.selectionCbs) cb(live);
      };
      const onPointerDown = (event: Event): void => {
        if (!(event.target instanceof Element) || !event.target.closest(".page")) return;
        this.remembered = null;
        for (const cb of this.selectionCbs) cb(null);
        for (const cb of this.dragCbs) cb(true);
      };
      // Release is document-level: a selection drag routinely ends outside
      // the page it started on. Spurious releases are the consumer's no-op.
      const onPointerUp = (): void => {
        for (const cb of this.dragCbs) cb(false);
      };
      doc.addEventListener("selectionchange", onSelectionChange);
      container.addEventListener("pointerdown", onPointerDown);
      doc.addEventListener("pointerup", onPointerUp);
      doc.addEventListener("pointercancel", onPointerUp);
      this.disposers.push(() => {
        doc.removeEventListener("selectionchange", onSelectionChange);
        container.removeEventListener("pointerdown", onPointerDown);
        doc.removeEventListener("pointerup", onPointerUp);
        doc.removeEventListener("pointercancel", onPointerUp);
      });
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
    return this.liveSelection() ?? this.remembered;
  }

  private liveSelection(): TextSelection | null {
    const container = this.containerEl();
    const doc = container?.ownerDocument;
    const sel = doc?.defaultView?.getSelection() ?? null;
    if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    // Rejections below console.debug their reason: a real in-viewer
    // selection being rejected is the signal that the private PDF.js
    // internals drifted (enable Verbose in the console to see them).
    const startPage = this.pageElOf(range.startContainer);
    const endPage = this.pageElOf(range.endContainer);
    // Cross-page selections have no single-page locator; skip.
    if (!startPage || startPage !== endPage) {
      console.debug("Maki[pdf]: selection rejected —", startPage ? "spans pages" : "no .page ancestor");
      return null;
    }

    const pageNumber = Number(startPage.getAttribute("data-page-number"));
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

    // Dragging past a line/block end puts an endpoint on an element node;
    // snap to the outermost text the range covers before resolving items.
    const snapped = snapToTextEndpoints(range);
    if (!snapped) {
      console.debug("Maki[pdf]: selection rejected — no text inside the range");
      return null;
    }
    const endpoints =
      this.nativeEndpoints(startPage) ?? this.domEndpoints(snapped, pageNumber, doc!);
    if (!endpoints) return null;
    const [begin, end] = endpoints;
    return {
      locator: { backend: "pdf", page: pageNumber, target: { kind: "text", begin, end } },
      text: sel.toString(),
    };
  }

  /**
   * Endpoints via Obsidian's own selection helper, when present — it tracks
   * pdf.js's text-layer DOM across versions, and its item indices are the
   * same native `selection=` convention the locator format reuses (spec §6).
   */
  private nativeEndpoints(
    pageEl: HTMLElement,
  ): [begin: [number, number], end: [number, number]] | null {
    if (typeof this.child.getTextSelectionRangeStr !== "function") return null;
    const str = this.child.getTextSelectionRangeStr(pageEl);
    const parts = str ? str.split(",").map((part) => Number(part.trim())) : [];
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
    const [bi, bo, ei, eo] = parts as [number, number, number, number];
    if (bi > ei || (bi === ei && bo >= eo)) return null;
    return [
      [bi, bo],
      [ei, eo],
    ];
  }

  /** Fallback for older internals: resolve endpoints by walking `textDivs`. */
  private domEndpoints(
    range: Range,
    pageNumber: number,
    doc: Document,
  ): [begin: [number, number], end: [number, number]] | null {
    const textDivs = textDivsOf(this.pageView(pageNumber));
    if (!textDivs || textDivs.length === 0) {
      console.debug("Maki[pdf]: selection rejected — no textDivs on page view (internals drift?)");
      return null;
    }
    const begin = this.endpointOf(range.startContainer, range.startOffset, textDivs, doc);
    const end = this.endpointOf(range.endContainer, range.endOffset, textDivs, doc);
    if (!begin || !end) {
      console.debug("Maki[pdf]: selection rejected — endpoint not in textDivs");
      return null;
    }
    if (begin[0] > end[0] || (begin[0] === end[0] && begin[1] >= end[1])) return null;
    return [begin, end];
  }

  onSelectionChange(cb: (sel: TextSelection | null) => void): Disposable {
    this.selectionCbs.add(cb);
    return { dispose: () => this.selectionCbs.delete(cb) };
  }

  onSelectionDrag(cb: (dragging: boolean) => void): Disposable {
    this.dragCbs.add(cb);
    return { dispose: () => this.dragCbs.delete(cb) };
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
        el.style.backgroundColor = `rgba(${h.color.rgb.join(",")}, var(--maki-highlight-opacity, 0.5))`;
        el.addEventListener("click", () => {
          for (const cb of this.activateCbs) cb(h.id);
        });
        overlay.append(el);
      }
      // The native subpath highlight may already be painted (the document was
      // opened via the link before this highlight was drawn) — the
      // highlightText wrap can't catch that ordering, so clear it here.
      this.clearNativeDuplicate();
    } catch (error) {
      console.error("Maki: PDF highlight failed", error);
    }
  }

  /**
   * The id of the registered Maki highlight covering exactly the native
   * `(page, [[beginItem, beginOffset], [endItem, endOffset]])` text range, if
   * any. Reuses the canonical locator id, so "same range" means "the same
   * highlight the reconciler draws".
   */
  private makiHighlightIdAt(pageNumber: number, range: unknown): HighlightId | null {
    const nums = Array.isArray(range) && range.length === 2 ? range.flat() : null;
    if (
      !nums ||
      nums.length !== 4 ||
      nums.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 0)
    ) {
      return null;
    }
    const [bi, bo, ei, eo] = nums as [number, number, number, number];
    const id = highlightIdFor(
      { backend: "pdf", page: pageNumber, target: { kind: "text", begin: [bi, bo], end: [ei, eo] } },
      PdfLocatorCodec,
    );
    return this.highlights.has(id) ? id : null;
  }

  /** Clear the native subpath highlight once Maki draws the same range. */
  private clearNativeDuplicate(): void {
    const sub = this.child.subpathHighlight;
    if (!sub || sub.type !== "text" || typeof sub.page !== "number") return;
    if (this.makiHighlightIdAt(sub.page, sub.range) === null) return;
    this.child.clearTextHighlight?.();
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
    this.dragCbs.clear();
  }
}
