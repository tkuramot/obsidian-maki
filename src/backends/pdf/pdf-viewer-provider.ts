/**
 * `PdfViewerProvider` — acquire a `DocumentViewer` from Obsidian's native PDF
 * view. The native view already exists per open PDF, so
 * `setup()` has nothing to register; `acquire()` waits for the private view
 * stack to be ready and wraps it, with a timeout so a changed internal API
 * degrades into a clear error instead of a hang.
 */

import type { DocumentViewer, ViewerHost } from "../../core/document-viewer";
import type { DocumentRef } from "../../core/types";
import type { Disposable } from "../../core/types";
import type { PluginContext, ViewerProvider } from "../../core/viewer-provider";
import type { PdfViewerChildLike, PdfViewerComponentLike, PdfViewLike } from "./pdf-internals";
import { PdfViewerAdapter } from "./pdf-viewer-adapter";

const ACQUIRE_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

function waitForChild(component: PdfViewerComponentLike): Promise<PdfViewerChildLike> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (child: PdfViewerChildLike): void => {
      // The child exists before its pdfViewer stack does; wait for both.
      if (settled || !child.pdfViewer?.pdfViewer) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(child);
    };
    const interval = window.setInterval(() => {
      if (component.child) settle(component.child);
    }, POLL_INTERVAL_MS);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      reject(
        new Error(
          "Obsidian's PDF viewer internals did not become ready — " +
            "the private API may have changed in this Obsidian version",
        ),
      );
    }, ACQUIRE_TIMEOUT_MS);
    // The component is thenable once loaded (the obsidian-pdf-plus route);
    // the polling above is the fallback when `then` is absent.
    if (typeof component.then === "function") {
      component.then((child) => settle(child));
    }
  });
}

/** What the integration layer injects into the provider. */
export interface PdfProviderDeps {
  /** Mount the shared toolbar color picker (FR-9.2) into a toolbar section. */
  mountColorPicker(parent: HTMLElement): Disposable & { el: HTMLElement };
}

export class PdfViewerProvider implements ViewerProvider {
  readonly backend = "pdf" as const;

  constructor(private readonly deps: PdfProviderDeps) {}

  canHandle(ref: DocumentRef): boolean {
    return ref.backend === "pdf" && ref.path.toLowerCase().endsWith(".pdf");
  }

  setup(_ctx: PluginContext): Disposable {
    // Nothing to register: Obsidian's own view opens PDFs. In-viewer UI
    // (context menu) will patch here later.
    return { dispose: () => {} };
  }

  async acquire(host: ViewerHost, ref: DocumentRef): Promise<DocumentViewer> {
    const view = host as PdfViewLike;
    const component = view.viewer;
    if (!component) {
      throw new Error("Not a native PDF view (no `viewer` component)");
    }
    const child = await waitForChild(component);
    const adapter = new PdfViewerAdapter(ref, view, child);
    this.injectColorPicker(view, adapter);
    return adapter;
  }

  /**
   * Add the color picker to the native toolbar. Version-guarded DOM
   * injection: an absent/renamed toolbar degrades to no button.
   */
  private injectColorPicker(view: PdfViewLike, adapter: PdfViewerAdapter): void {
    const toolbar = view.containerEl?.querySelector<HTMLElement>(".pdf-toolbar-right");
    if (!toolbar) return;
    // A stale button can survive a torn-down adapter if the view was reused.
    toolbar.querySelectorAll(".maki-color-picker").forEach((el) => el.remove());
    const picker = this.deps.mountColorPicker(toolbar);
    toolbar.prepend(picker.el); // before the native right-side buttons
    adapter.own(() => picker.dispose());
  }
}
