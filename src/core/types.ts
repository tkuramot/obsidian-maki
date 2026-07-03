/**
 * Shared vocabulary of the core — types owned by no single module.
 *
 * This file is deliberately NOT a catch-all: module-owned types co-locate with
 * their owner (e.g. `LocatorCodec` → `locator/codec.ts`, `DocumentMetadata` →
 * `document-viewer.ts`).
 */

/** Identifies a rendering backend. Extensible: 'epub-native', 'mobi', … */
export type BackendId = "pdf" | "epub";

/** A document file in the vault, tagged with the backend that renders it. */
export interface DocumentRef {
  /** Vault-relative file path. */
  path: string;
  backend: BackendId;
}

/**
 * A serializable address of a point or range within a document, stable across
 * re-rendering. The single concept the entire core manipulates; the on-disk
 * encoding is the persisted link-subpath contract handled by the `locator/`
 * codecs.
 */
export type Locator = PdfLocator | EpubLocator;

export type PdfTarget =
  | {
      kind: "text";
      /** [index of the text item in the page's text layer, character offset]. */
      begin: [item: number, offset: number];
      end: [item: number, offset: number];
    }
  | {
      kind: "rect";
      /** PDF coordinates (origin bottom-left, y grows upward). */
      rect: [left: number, bottom: number, right: number, top: number];
    }
  | {
      kind: "annotation";
      /** An existing PDF annotation object id, e.g. "123R". */
      id: string;
    };

export interface PdfLocator {
  backend: "pdf";
  /** 1-based page number. */
  page: number;
  target: PdfTarget;
}

export interface EpubLocator {
  backend: "epub";
  /** CFI body: *unwrapped* (no `epubcfi(…)`) and *percent-decoded*. */
  cfi: string;
}

/** A user's text selection in the preview, as abstract data. */
export interface TextSelection {
  locator: Locator;
  /** The selected plain text. */
  text: string;
}

/** Stable id derived from a locator (see `locator/link.ts`). */
export type HighlightId = string;

export interface Color {
  /** Palette name, when the color came from the palette. */
  name?: string;
  rgb: [number, number, number];
}

/** A note (or a position in one) that references a document locator. */
export interface NoteRef {
  path: string;
  line?: number;
}

/** A colored mark drawn over a locator's range in the preview. */
export interface Highlight {
  id: HighlightId;
  locator: Locator;
  color: Color;
  /** Notes whose backlinks created it (duplicate targets merge into one). */
  sources: NoteRef[];
}

/** The `key=value` pairs of a link subpath (the part after `#`). */
export type SubpathParams = Record<string, string>;

/**
 * One backlink found in a note, as produced by the integration layer
 * (`ObsidianBacklinkIndex`) and consumed by the core reconciler.
 */
export interface BacklinkEntry {
  subpath: SubpathParams;
  /** Raw `color` subpath value (palette name or `r,g,b`), if present. */
  color?: string;
  source: NoteRef;
}

/** Where note-destined snippets are inserted. */
export type TargetStrategy =
  | { kind: "active-note" }
  | { kind: "note"; path: string };

export interface Disposable {
  dispose(): void;
}
