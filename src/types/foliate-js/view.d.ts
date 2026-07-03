/**
 * Hand-written, minimal declarations for foliate-js `view.js` — only the
 * surface Maki's EPUB adapter uses. foliate-js is consumed from the patched
 * fork pinned as the `vendor/foliate-js` git submodule; the `foliate-js/*`
 * specifier resolves to the submodule in esbuild (`alias`) and to these
 * declarations in tsc (`paths`).
 *
 * Maintained by hand: check for drift against the actual API on every
 * submodule bump — a mismatch type-checks fine and fails at runtime.
 */

export interface FoliateTocItem {
  label?: string | undefined;
  href?: string | undefined;
  subitems?: FoliateTocItem[] | null | undefined;
}

export interface FoliateSection {
  id: string;
  linear?: string | undefined;
  cfi?: string | undefined;
}

export interface FoliateBook {
  metadata?:
    | { title?: unknown; language?: unknown; [key: string]: unknown }
    | undefined;
  toc?: FoliateTocItem[] | undefined;
  sections: FoliateSection[];
  dir?: string | undefined;
  rendition?: { layout?: string | undefined } | undefined;
  /** Loader event target (EPUB): `load` (veto resources) / `data` (transform). */
  transformTarget?: EventTarget | undefined;
}

export interface ResolvedNavigation {
  index: number;
  anchor?: (doc: Document) => Range | Element;
}

/** Detail of the `relocate` event / shape of `lastLocation`. */
export interface FoliateLocation {
  fraction?: number | undefined;
  tocItem?: FoliateTocItem | null | undefined;
  pageItem?: FoliateTocItem | null | undefined;
  cfi?: string | undefined;
  range?: Range | undefined;
}

export interface FoliateLoadDetail {
  doc: Document;
  index: number;
}

export interface FoliateDrawAnnotationDetail {
  draw: (
    func: (rects: Iterable<DOMRect>, options?: Record<string, unknown>) => SVGElement,
    options?: Record<string, unknown>,
  ) => void;
  annotation: { value: string; color?: string };
  doc: Document;
  range: Range;
}

export interface FoliateShowAnnotationDetail {
  value: string;
  index: number;
  range: Range;
}

/** The renderer custom element (`foliate-paginator` / `foliate-fxl`). */
export interface FoliateRenderer extends HTMLElement {
  setStyles(styles: string): void;
  getContents(): Array<{ doc: Document; index: number; overlayer?: unknown }>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  destroy(): void;
}

/** The `<foliate-view>` custom element. */
export class View extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation: FoliateLocation | null;
  isFixedLayout: boolean;

  open(book: FoliateBook): Promise<void>;
  close(): void;
  init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(
    target: string | number | { fraction: number },
  ): Promise<ResolvedNavigation | undefined>;
  goToFraction(fraction: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  addAnnotation(
    annotation: { value: string; color?: string },
    remove?: boolean,
  ): Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  showAnnotation(annotation: { value: string }): Promise<void>;
  getCFI(index: number, range?: Range | null): string;
  resolveCFI(cfi: string): ResolvedNavigation;
}

declare global {
  interface HTMLElementTagNameMap {
    "foliate-view": View;
  }
}
