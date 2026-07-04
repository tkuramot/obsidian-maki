/**
 * `EpubViewerAdapter` — `DocumentViewer` over a mounted `<foliate-view>`.
 * Humble: foliate does CFI resolution and highlight geometry
 * (its SVG overlayer); this class only converts between foliate events/calls
 * and the abstract types.
 *
 * Highlights are drawn exclusively in foliate's overlayer — never injected
 * into section DOM.
 */

import type {
  DocumentMetadata,
  DocumentViewer,
  RevealOutcome,
} from "../../core/document-viewer";
import { unwrapCfi, wrapCfi } from "../../core/locator/cfi";
import type {
  Disposable,
  DocumentRef,
  Highlight,
  HighlightId,
  Locator,
  TextSelection,
} from "../../core/types";
import { collapse, compare } from "foliate-js/epubcfi.js";
import { Overlayer } from "foliate-js/overlayer.js";
import type {
  FoliateDrawAnnotationDetail,
  FoliateLoadDetail,
  FoliateShowAnnotationDetail,
  View as FoliateView,
} from "foliate-js/view.js";
import { snapToTextEndpoints } from "../snap-range";

const HIGHLIGHT_OPACITY = 0.5;
const FLASH_VALUE_COLOR = "rgba(255, 208, 0, 0.5)";
const FLASH_MS = 1200;

/**
 * A range CFI whose start sorts after its end can only resolve to a collapsed
 * DOM range, so it silently draws nothing; refuse it instead — both before
 * persisting (captureSelection) and when drawing links that already carry one.
 */
function isInvertedRangeCfi(cfi: string): boolean {
  try {
    return compare(collapse(cfi), collapse(cfi, true)) > 0;
  } catch {
    return true; // unparseable ⇒ equally undrawable
  }
}

export class EpubViewerAdapter implements DocumentViewer {
  readonly backend = "epub" as const;

  private readonly highlights = new Map<HighlightId, Highlight>();
  /** foliate addresses annotations by CFI value; map both directions. */
  private readonly idByValue = new Map<string, HighlightId>();
  private readonly activateCbs = new Set<(id: HighlightId) => void>();
  private readonly selectionCbs = new Set<(sel: TextSelection | null) => void>();
  private readonly dragCbs = new Set<(dragging: boolean) => void>();
  private readonly aborter = new AbortController();
  /**
   * The last live selection. Section selections vanish without a
   * `selectionchange` (page turn unloads the section document); a collapse
   * *inside* a section does fire one and clears this — user intent.
   */
  private remembered: TextSelection | null = null;

  constructor(
    readonly ref: DocumentRef,
    private readonly view: FoliateView,
  ) {
    const { signal } = this.aborter;

    // foliate re-emits `create-overlay` when a section (re)loads; re-add that
    // section's annotations (the EPUB mirror of PDF's `pagerendered`).
    // `addAnnotation` itself resolves the section, so re-adding all is safe
    // and idempotent.
    this.view.addEventListener(
      "create-overlay",
      () => {
        for (const h of this.highlights.values()) void this.addToOverlay(h);
      },
      { signal },
    );

    this.view.addEventListener(
      "draw-annotation",
      (event) => {
        const { draw, annotation } = (event as CustomEvent<FoliateDrawAnnotationDetail>)
          .detail;
        draw(Overlayer.highlight, { color: annotation.color });
      },
      { signal },
    );

    this.view.addEventListener(
      "show-annotation",
      (event) => {
        const { value } = (event as CustomEvent<FoliateShowAnnotationDetail>).detail;
        const id = this.idByValue.get(value);
        if (id) for (const cb of this.activateCbs) cb(id);
      },
      { signal },
    );

    // A mouse drag that leaves the iframe delivers its release to the host
    // document instead of the section's — watch both. Double reports and
    // spurious releases are the consumer's no-op.
    const onPointerUp = (): void => {
      for (const cb of this.dragCbs) cb(false);
    };
    const hostDoc = this.view.ownerDocument;
    hostDoc.addEventListener("pointerup", onPointerUp, { signal });
    hostDoc.addEventListener("pointercancel", onPointerUp, { signal });

    // foliate emits no selection event; listen per section document. The
    // per-doc listeners need no removal: they die with the section document.
    this.view.addEventListener(
      "load",
      (event) => {
        const { doc } = (event as CustomEvent<FoliateLoadDetail>).detail;
        doc.addEventListener("selectionchange", () => {
          const sel = this.liveSelection();
          this.remembered = sel;
          for (const cb of this.selectionCbs) cb(sel);
        });
        // Selection drags start inside the section iframe, whose pointer
        // events never reach the host document.
        doc.addEventListener("pointerdown", () => {
          for (const cb of this.dragCbs) cb(true);
        });
        doc.addEventListener("pointerup", onPointerUp);
        doc.addEventListener("pointercancel", onPointerUp);
      },
      { signal },
    );
  }

  // ---- navigation ----------------------------------------------------------

  async reveal(target: Locator, opts?: { flash?: boolean }): Promise<RevealOutcome> {
    if (target.backend !== "epub") return "not-found";
    const value = wrapCfi(target.cfi);
    try {
      const resolved = await this.view.goTo(value);
      if (resolved) {
        if (opts?.flash !== false) this.flash(value);
        return "exact";
      }
    } catch {
      // fall through to the coarse fallback
    }
    // the exact passage no longer resolves — fall back to the
    // section addressed by the CFI's first spine step (/6/N).
    const spineStep = /^\/6\/(\d+)/.exec(target.cfi);
    const index = spineStep ? Number(spineStep[1]) / 2 - 1 : -1;
    if (Number.isInteger(index) && index >= 0 && index < this.view.book.sections.length) {
      try {
        if (await this.view.goTo(index)) return "fallback";
      } catch {
        // not-found below
      }
    }
    return "not-found";
  }

  /** Transient emphasis after reveal, unless the passage is already drawn. */
  private flash(value: string): void {
    if (this.idByValue.has(value)) return;
    void this.view.addAnnotation({ value, color: FLASH_VALUE_COLOR }).then(() => {
      window.setTimeout(() => {
        if (!this.idByValue.has(value)) void this.view.deleteAnnotation({ value });
      }, FLASH_MS);
    });
  }

  // ---- selection -----------------------------------------------------------

  captureSelection(): TextSelection | null {
    return this.liveSelection() ?? this.remembered;
  }

  private liveSelection(): TextSelection | null {
    // Rejections below console.debug their reason: a real selection being
    // rejected signals foliate/type drift (enable Verbose to see them).
    for (const { doc, index } of this.view.renderer?.getContents() ?? []) {
      const sel = doc.defaultView?.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
      const range = sel.getRangeAt(0);
      const text = sel.toString();
      if (text === "") continue;
      const snapped = snapToTextEndpoints(range);
      if (!snapped) {
        console.debug("Maki[epub]: selection rejected — no text to snap to");
        continue;
      }
      try {
        const cfi = this.view.getCFI(index, snapped);
        if (!cfi || isInvertedRangeCfi(cfi)) {
          console.debug("Maki[epub]: selection rejected —", cfi ? `inverted CFI ${cfi}` : "empty CFI");
          continue;
        }
        return {
          locator: { backend: "epub", cfi: unwrapCfi(cfi) },
          text,
        };
      } catch (error) {
        // A throwing getCFI is fork/type drift — never swallow it silently.
        console.warn("Maki: EPUB selection → CFI failed", error);
        continue;
      }
    }
    return null;
  }

  onSelectionChange(cb: (sel: TextSelection | null) => void): Disposable {
    this.selectionCbs.add(cb);
    return { dispose: () => this.selectionCbs.delete(cb) };
  }

  onSelectionDrag(cb: (dragging: boolean) => void): Disposable {
    this.dragCbs.add(cb);
    return { dispose: () => this.dragCbs.delete(cb) };
  }

  // ---- highlights ----------------------------------------------------------

  drawHighlight(h: Highlight): void {
    if (h.locator.backend !== "epub") return;
    const value = wrapCfi(h.locator.cfi);
    if (isInvertedRangeCfi(value)) {
      console.warn(
        "Maki: EPUB highlight skipped — inverted range CFI; re-create the annotation",
        h.locator.cfi,
      );
      return;
    }
    // Replacing an id whose CFI changed leaves no stale overlay behind.
    const previous = this.highlights.get(h.id);
    if (previous && previous.locator.backend === "epub" && previous.locator.cfi !== h.locator.cfi) {
      this.eraseHighlight(h.id);
    }
    this.highlights.set(h.id, h);
    this.idByValue.set(value, h.id);
    void this.addToOverlay(h);
  }

  eraseHighlight(id: HighlightId): void {
    const h = this.highlights.get(id);
    this.highlights.delete(id);
    if (!h || h.locator.backend !== "epub") return;
    const value = wrapCfi(h.locator.cfi);
    this.idByValue.delete(value);
    void this.view.deleteAnnotation({ value }).catch(() => undefined);
  }

  clearHighlights(): void {
    for (const id of [...this.highlights.keys()]) this.eraseHighlight(id);
  }

  onHighlightActivate(cb: (id: HighlightId) => void): Disposable {
    this.activateCbs.add(cb);
    return { dispose: () => this.activateCbs.delete(cb) };
  }

  /** Best-effort: a CFI that no longer resolves draws nothing. */
  private async addToOverlay(h: Highlight): Promise<void> {
    if (h.locator.backend !== "epub") return;
    try {
      await this.view.addAnnotation({
        value: wrapCfi(h.locator.cfi),
        color: `rgba(${h.color.rgb.join(",")}, ${HIGHLIGHT_OPACITY})`,
      });
    } catch (error) {
      console.warn("Maki: EPUB highlight did not resolve", h.locator.cfi, error);
    }
  }

  // ---- metadata / lifecycle ------------------------------------------------

  metadata(): DocumentMetadata {
    const meta: DocumentMetadata = {};
    const title = this.view.book?.metadata?.title;
    if (typeof title === "string" && title !== "") meta.title = title;
    const location = this.view.lastLocation;
    const chapter = location?.tocItem?.label;
    if (typeof chapter === "string" && chapter !== "") meta.chapter = chapter.trim();
    if (typeof location?.fraction === "number") meta.progress = location.fraction;
    return meta;
  }

  destroy(): void {
    this.clearHighlights();
    this.aborter.abort();
    this.activateCbs.clear();
    this.selectionCbs.clear();
    this.dragCbs.clear();
  }
}
