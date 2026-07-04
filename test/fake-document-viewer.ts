/**
 * A recording, in-memory `DocumentViewer` fake for core unit tests — a plain
 * structural implementation, no framework mocks (design §10/§11). Not a test
 * file itself; imported by the tests that drive the port.
 */

import type { DocumentMetadata, DocumentViewer, RevealOutcome } from "../src/core/document-viewer";
import type {
  BackendId,
  Disposable,
  DocumentRef,
  Highlight,
  HighlightId,
  Locator,
  TextSelection,
} from "../src/core/types";

export class FakeDocumentViewer implements DocumentViewer {
  readonly backend: BackendId;
  readonly ref: DocumentRef;

  /** Currently drawn highlights, by id. */
  readonly highlights = new Map<HighlightId, Highlight>();
  /** Chronological record of draw/erase calls, for asserting exact diffs. */
  readonly calls: Array<
    { op: "draw"; highlight: Highlight } | { op: "erase"; id: HighlightId }
  > = [];

  /** What `captureSelection` returns; set by the test. */
  selection: TextSelection | null = null;
  /** What `metadata` returns; set by the test. */
  meta: DocumentMetadata = {};

  constructor(ref: DocumentRef) {
    this.ref = ref;
    this.backend = ref.backend;
  }

  reveal(_target: Locator, _opts?: { flash?: boolean }): Promise<RevealOutcome> {
    return Promise.resolve("exact");
  }

  captureSelection(): TextSelection | null {
    return this.selection;
  }

  onSelectionChange(_cb: (sel: TextSelection | null) => void): Disposable {
    return { dispose: () => {} };
  }

  onSelectionDrag(_cb: (dragging: boolean) => void): Disposable {
    return { dispose: () => {} };
  }

  drawHighlight(h: Highlight): void {
    this.calls.push({ op: "draw", highlight: h });
    this.highlights.set(h.id, h);
  }

  eraseHighlight(id: HighlightId): void {
    this.calls.push({ op: "erase", id });
    this.highlights.delete(id);
  }

  clearHighlights(): void {
    this.highlights.clear();
  }

  onHighlightActivate(_cb: (id: HighlightId) => void): Disposable {
    return { dispose: () => {} };
  }

  metadata(): DocumentMetadata {
    return this.meta;
  }

  destroy(): void {}
}
