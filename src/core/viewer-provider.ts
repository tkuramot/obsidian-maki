/**
 * `ViewerProvider` — the acquisition port.
 *
 * Backends differ most in *how a viewer comes to exist*: the PDF backend
 * patches an existing Obsidian view, the EPUB backend registers and mounts
 * its own. This difference is hidden behind this interface.
 */

import type { DocumentViewer, ViewerHost } from "./document-viewer";
import type { BackendId, Disposable, DocumentRef } from "./types";

/**
 * An opaque handle to the plugin runtime a provider registers against
 * (the Obsidian `Plugin` instance). The core only passes it through.
 */
export type PluginContext = unknown;

export interface ViewerProvider {
  readonly backend: BackendId;
  canHandle(ref: DocumentRef): boolean;
  /** Register Obsidian views / patches at plugin load. */
  setup(ctx: PluginContext): Disposable;
  /** Yield a DocumentViewer for an open instance of the document. */
  acquire(host: ViewerHost, ref: DocumentRef): Promise<DocumentViewer>;
}
