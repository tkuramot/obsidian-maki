/**
 * Hand-written, minimal declarations for foliate-js `epub.js` — only the
 * surface Maki's EPUB adapter uses (see view.d.ts for how these are wired
 * to the `vendor/foliate-js` submodule, and the drift caveat).
 */

import type { FoliateBook } from "./view.js";

/** href-keyed accessors over the unzipped EPUB. */
export interface EpubLoader {
  loadText(name: string): Promise<string | null> | string | null;
  loadBlob(name: string): Promise<Blob | null> | Blob | null;
  getSize(name: string): number;
  /** Font-deobfuscation hash; optional (WebCrypto is used when omitted). */
  sha1?: (data: ArrayBuffer) => Promise<ArrayBuffer>;
}

export class EPUB implements FoliateBook {
  constructor(loader: EpubLoader);
  init(): Promise<this>;

  metadata: { title?: unknown; language?: unknown; [key: string]: unknown };
  toc?: FoliateBook["toc"] | undefined;
  sections: FoliateBook["sections"];
  dir?: string | undefined;
  rendition?: { layout?: string | undefined } | undefined;
  transformTarget?: EventTarget | undefined;
}
