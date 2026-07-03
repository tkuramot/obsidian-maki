/**
 * `EpubViewerProvider` — registers the `maki-epub` view for `.epub` files and
 * yields the adapter of an open view. Obsidian unregisters the
 * view and extension automatically on plugin unload.
 */

import type { Plugin } from "obsidian";
import type { DocumentViewer, ViewerHost } from "../../core/document-viewer";
import type { Disposable, DocumentRef } from "../../core/types";
import type { PluginContext, ViewerProvider } from "../../core/viewer-provider";
import { MakiEpubView, MAKI_EPUB_VIEW_TYPE, type EpubViewDeps } from "./epub-view";

const ACQUIRE_TIMEOUT_MS = 30_000;

export class EpubViewerProvider implements ViewerProvider {
  readonly backend = "epub" as const;

  constructor(private readonly deps: EpubViewDeps) {}

  canHandle(ref: DocumentRef): boolean {
    return ref.backend === "epub" && ref.path.toLowerCase().endsWith(".epub");
  }

  setup(ctx: PluginContext): Disposable {
    const plugin = ctx as Plugin;
    plugin.registerView(MAKI_EPUB_VIEW_TYPE, (leaf) => new MakiEpubView(leaf, this.deps));
    plugin.registerExtensions(["epub"], MAKI_EPUB_VIEW_TYPE);
    return { dispose: () => {} };
  }

  async acquire(host: ViewerHost, ref: DocumentRef): Promise<DocumentViewer> {
    if (!(host instanceof MakiEpubView)) {
      throw new Error(`Not a ${MAKI_EPUB_VIEW_TYPE} view for ${ref.path}`);
    }
    return await Promise.race([
      host.whenReady(),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error(`Timed out opening ${ref.path}`)),
          ACQUIRE_TIMEOUT_MS,
        );
      }),
    ]);
  }
}
