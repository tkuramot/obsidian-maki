/**
 * Viewer lifecycle wiring: watch the workspace for open PDF /
 * EPUB views, `acquire()` a `DocumentViewer` per open document, run the
 * initial reconcile, subscribe `BacklinkIndex.onChange → reconcile`, and tear
 * everything down when the leaf closes or the plugin unloads.
 *
 * Humble: every decision (what to draw, what an id means) is the core's; this
 * class only observes Obsidian and forwards.
 */

import { Notice, TFile, type App, type FileView, type WorkspaceLeaf } from "obsidian";
import { MAKI_EPUB_VIEW_TYPE } from "../backends/epub/epub-view";
import type { DocumentViewer } from "../core/document-viewer";
import type { HighlightReconciler } from "../core/highlight-reconciler";
import type { BackendId, Disposable, DocumentRef, NoteRef } from "../core/types";
import type { ViewerRegistry } from "../core/viewer-registry";
import type { ObsidianBacklinkIndex } from "./backlink-index";

/** View types that host an annotatable document, by backend. */
const VIEW_TYPES: Record<string, BackendId> = {
  pdf: "pdf",
  [MAKI_EPUB_VIEW_TYPE]: "epub",
};

interface OpenEntry {
  viewer: DocumentViewer;
  path: string;
  subs: Disposable[];
  /** Last surfaced skip count, so the skip notice fires once per change. */
  lastSkipped: number;
}

export class ViewerManager {
  private readonly open = new Map<WorkspaceLeaf, OpenEntry>();
  private readonly attaching = new Set<WorkspaceLeaf>();
  private lastActive: WorkspaceLeaf | null = null;

  constructor(
    private readonly app: App,
    private readonly registry: ViewerRegistry,
    private readonly reconciler: HighlightReconciler,
    private readonly index: ObsidianBacklinkIndex,
    /** A click on a drawn highlight, resolved by the caller. */
    private readonly onHighlightActivate: (viewer: DocumentViewer, id: string) => void,
    /** Optional per-viewer binding (e.g. annotate-on-selection), disposed on teardown. */
    private readonly bindViewer?: (viewer: DocumentViewer) => Disposable,
  ) {}

  /**
   * Reconcile tracked leaves with the current workspace. Called on
   * layout-change / active-leaf-change; cheap when nothing changed.
   */
  scan(): void {
    const seen = new Set<WorkspaceLeaf>();
    for (const viewType of Object.keys(VIEW_TYPES)) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        seen.add(leaf);
        const file = (leaf.view as FileView).file;
        const tracked = this.open.get(leaf);
        if (tracked && file && tracked.path === file.path) continue;
        if (tracked) this.teardown(leaf); // navigated to another document
        if (file instanceof TFile) {
          void this.attach(leaf, file, VIEW_TYPES[viewType]!);
        }
      }
    }
    for (const leaf of [...this.open.keys()]) {
      if (!seen.has(leaf)) this.teardown(leaf); // leaf closed
    }
  }

  noteActiveLeaf(leaf: WorkspaceLeaf | null): void {
    if (leaf && (this.open.has(leaf) || this.attaching.has(leaf))) {
      this.lastActive = leaf;
    }
  }

  /**
   * The viewer commands should act on: the most recently active document
   * leaf (kept current via `noteActiveLeaf`), else the only open one.
   */
  activeViewer(): DocumentViewer | null {
    if (this.lastActive) {
      const entry = this.open.get(this.lastActive);
      if (entry) return entry.viewer;
    }
    if (this.open.size === 1) return [...this.open.values()][0]!.viewer;
    return null;
  }

  /** Re-run reconcile for every open viewer (e.g. after a palette change). */
  refreshAll(): void {
    for (const entry of this.open.values()) {
      this.reconcile(entry, { path: entry.path, backend: entry.viewer.backend });
    }
  }

  destroyAll(): void {
    for (const leaf of [...this.open.keys()]) this.teardown(leaf);
  }

  private async attach(
    leaf: WorkspaceLeaf,
    file: TFile,
    backend: BackendId,
  ): Promise<void> {
    if (this.attaching.has(leaf)) return;
    const ref: DocumentRef = { path: file.path, backend };
    const provider = this.registry.providerFor(ref);
    if (!provider) return;

    this.attaching.add(leaf);
    try {
      const viewer = await provider.acquire(leaf.view, ref);
      // The leaf may have closed or navigated away while we awaited.
      const current = (leaf.view as FileView | null)?.file;
      if (!current || current.path !== ref.path || this.open.has(leaf)) {
        viewer.destroy();
        return;
      }
      const entry: OpenEntry = { viewer, path: ref.path, subs: [], lastSkipped: 0 };
      entry.subs.push(this.index.onChange(ref, () => this.reconcile(entry, ref)));
      entry.subs.push(
        viewer.onHighlightActivate((id) => this.onHighlightActivate(viewer, id)),
      );
      if (this.bindViewer) entry.subs.push(this.bindViewer(viewer));
      this.open.set(leaf, entry);
      this.reconcile(entry, ref);
    } catch (error) {
      console.error(`Maki: could not attach to ${ref.path}`, error);
      new Notice(`Maki: annotations unavailable for ${file.name} (see console)`);
    } finally {
      this.attaching.delete(leaf);
    }
  }

  private reconcile(entry: OpenEntry, ref: DocumentRef): void {
    const summary = this.reconciler.reconcile(entry.viewer, this.index.forDocument(ref));
    // skipped entries are surfaced, never silently dropped.
    if (summary.skipped > 0 && summary.skipped !== entry.lastSkipped) {
      new Notice(
        `Maki: ${summary.skipped} annotation link(s) to ${ref.path} could not be read`,
      );
    }
    entry.lastSkipped = summary.skipped;
  }

  private teardown(leaf: WorkspaceLeaf): void {
    const entry = this.open.get(leaf);
    if (!entry) return;
    this.open.delete(leaf);
    if (this.lastActive === leaf) this.lastActive = null;
    for (const sub of entry.subs) sub.dispose();
    this.reconciler.detach(entry.viewer);
    entry.viewer.destroy();
  }
}

/**
 * Open a source note at its annotation's line. Reuses a leaf that
 * already shows the note; otherwise opens a new tab — never replaces the
 * document preview itself.
 */
export async function openNoteAt(app: App, source: NoteRef): Promise<void> {
  const file = app.vault.getFileByPath(source.path);
  if (!file) {
    new Notice(`Maki: source note not found: ${source.path}`);
    return;
  }
  const eState = source.line !== undefined ? { line: source.line } : undefined;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view as FileView;
    if (view.file?.path === file.path) {
      app.workspace.revealLeaf(leaf);
      if (eState) leaf.setEphemeralState(eState);
      return;
    }
  }
  await app.workspace.getLeaf("tab").openFile(file, eState ? { eState } : undefined);
}
