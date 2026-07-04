/**
 * `HighlightReconciler` — keep a viewer's highlights in sync with the notes.
 * Identical for both backends; the only backend-specific
 * step (decode subpath → locator) is delegated to the codec.
 *
 * The wiring (`BacklinkIndex.onChange → reconcile`) lives in the integration
 * layer; everything here — decoding, id derivation, source merging, color
 * conflict resolution, diffing — is pure and driven by injected data.
 */

import type { ColorModel } from "./color-model";
import type { DocumentViewer } from "./document-viewer";
import type { Codecs } from "./locator/codec";
import { highlightIdFor } from "./locator/link";
import type { BacklinkEntry, Color, Highlight, HighlightId, NoteRef } from "./types";

export interface ReconcileSummary {
  /** Highlights currently drawn for the viewer. */
  drawn: number;
  /** Entries skipped because their locator could not be decoded. */
  skipped: number;
}

/** Deterministic entry order: note path, then line. */
function compareBySource(a: BacklinkEntry, b: BacklinkEntry): number {
  return (
    a.source.path.localeCompare(b.source.path) ||
    (a.source.line ?? 0) - (b.source.line ?? 0)
  );
}

function sameSource(a: NoteRef, b: NoteRef): boolean {
  return a.path === b.path && a.line === b.line;
}

function sameColor(a: Color, b: Color): boolean {
  return (
    a.name === b.name &&
    a.rgb[0] === b.rgb[0] &&
    a.rgb[1] === b.rgb[1] &&
    a.rgb[2] === b.rgb[2]
  );
}

function sameHighlight(a: Highlight, b: Highlight): boolean {
  return (
    sameColor(a.color, b.color) &&
    a.sources.length === b.sources.length &&
    a.sources.every((s, i) => sameSource(s, b.sources[i]!))
  );
}

export class HighlightReconciler {
  /** Per-viewer state — several documents can be open at once. */
  private readonly current = new Map<DocumentViewer, Map<HighlightId, Highlight>>();

  constructor(
    private readonly codecs: Codecs,
    private readonly colors: ColorModel,
    private readonly defaultColor: Color,
  ) {}

  reconcile(viewer: DocumentViewer, entries: readonly BacklinkEntry[]): ReconcileSummary {
    const codec = this.codecs[viewer.backend];
    const desired = new Map<HighlightId, Highlight>();
    let skipped = 0;

    // Sort a copy so "first entry in note-path order wins" holds
    // regardless of the order the index produced.
    for (const entry of [...entries].sort(compareBySource)) {
      const locator = codec.decode(entry.subpath);
      if (!locator) {
        skipped++; // undecodable ⇒ skip but count
        continue;
      }
      const id = highlightIdFor(locator, codec);
      const color =
        (entry.color !== undefined ? this.colors.parse(entry.color) : null) ??
        this.defaultColor;

      const existing = desired.get(id);
      if (existing) {
        // Same locator ⇒ one highlight with merged sources; the first
        // entry's color wins.
        if (!existing.sources.some((s) => sameSource(s, entry.source))) {
          existing.sources.push(entry.source);
        }
      } else {
        desired.set(id, { id, locator, color, sources: [entry.source] });
      }
    }

    const prev = this.current.get(viewer) ?? new Map<HighlightId, Highlight>();
    for (const [id, highlight] of desired) {
      const before = prev.get(id);
      // drawHighlight is idempotent by id, so a changed highlight is a redraw.
      if (!before || !sameHighlight(before, highlight)) viewer.drawHighlight(highlight);
    }
    for (const id of prev.keys()) {
      if (!desired.has(id)) viewer.eraseHighlight(id);
    }

    this.current.set(viewer, desired);
    return { drawn: desired.size, skipped };
  }

  /**
   * Look up a currently drawn highlight, e.g. to resolve a highlight click
   * back to its source notes.
   */
  getHighlight(viewer: DocumentViewer, id: HighlightId): Highlight | null {
    return this.current.get(viewer)?.get(id) ?? null;
  }

  /** Forget a closed viewer's state (called from the viewer's dispose path). */
  detach(viewer: DocumentViewer): void {
    this.current.delete(viewer);
  }
}
