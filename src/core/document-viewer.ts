/**
 * `DocumentViewer` — the rendering & interaction port.
 *
 * One open document = one `DocumentViewer`; it is all the core needs to drive
 * any backend. Deliberately absent: pages, iframes, CFIs, PDF.js objects, DOM
 * nodes — those leak only into adapters.
 */

import type {
  BackendId,
  Disposable,
  DocumentRef,
  Highlight,
  HighlightId,
  Locator,
  TextSelection,
} from "./types";

/**
 * How precisely `reveal` reached its target. 'fallback' means the exact
 * passage no longer resolves and the nearest coarse position (page / section)
 * was used, so the integration layer can notify the user.
 */
export type RevealOutcome = "exact" | "fallback" | "not-found";

/**
 * Backend-supplied labels used for display templates. All fields
 * are optional: each backend fills what it has.
 */
export interface DocumentMetadata {
  title?: string;
  /** PDF: total number of pages. */
  pageCount?: number;
  /** PDF: page labels by 0-based index (pageLabels[page - 1]). */
  pageLabels?: string[];
  /** EPUB: title of the chapter/section at the current position. */
  chapter?: string;
  /** EPUB: reading progress in [0, 1] at the current position. */
  progress?: number;
}

/**
 * An opaque handle to the concrete open view a provider acquires a viewer
 * from (an Obsidian leaf/view). The core never inspects it; only the adapter
 * that produced it knows the concrete type.
 */
export type ViewerHost = unknown;

export interface DocumentViewer {
  readonly backend: BackendId;
  readonly ref: DocumentRef;

  /** Navigate to a locator and briefly flash it. */
  reveal(target: Locator, opts?: { flash?: boolean }): Promise<RevealOutcome>;

  /**
   * The current user selection, as an abstract selection, or null. It must
   * survive the DOM selection being taken over by another pane (e.g. the
   * user focusing the note they'll paste into): it stays current until the
   * user clears it inside the viewer or replaces it.
   */
  captureSelection(): TextSelection | null;
  /** Fires whenever the live selection changes (for annotate-on-selection, palette state). */
  onSelectionChange(cb: (sel: TextSelection | null) => void): Disposable;

  /**
   * Draw / erase highlights. Idempotent by id: drawing an
   * existing id replaces it. Best-effort — a locator that decodes but no
   * longer resolves draws nothing and must not throw.
   */
  drawHighlight(h: Highlight): void;
  eraseHighlight(id: HighlightId): void;
  clearHighlights(): void;
  /** Fires when the user clicks a drawn highlight. */
  onHighlightActivate(cb: (id: HighlightId) => void): Disposable;

  metadata(): DocumentMetadata;
  destroy(): void;
}
