/**
 * `ObsidianNoteWriter` — clipboard + snippet insertion over the vault/editor.
 * Concrete and injected into the core, not a port. Humble:
 * the one piece of decision logic (which link to remove) is the pure
 * `removeAnnotationLink` in the core.
 */

import { MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { removeAnnotationLink } from "../core/locator/link";
import type { NoteRef, SubpathParams, TargetStrategy } from "../core/types";

/** Desktop-only escape hatch; null on mobile, where the caller's error surfaces. */
function electronClipboard(): { writeText(text: string): void } | null {
  try {
    const req = (window as { require?: (id: string) => unknown }).require;
    const electron = req?.("electron") as
      | { clipboard?: { writeText(text: string): void } }
      | undefined;
    return electron?.clipboard ?? null;
  } catch {
    return null;
  }
}

export class ObsidianNoteWriter {
  constructor(private readonly app: App) {}

  async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Chromium rejects top-frame writes while the focused frame is an EPUB
      // section iframe ("Document is not focused") — exactly where auto-copy
      // and relayed hotkeys run. Electron's clipboard has no focus rule.
      const clipboard = electronClipboard();
      if (!clipboard) throw error;
      clipboard.writeText(text);
    }
  }

  /**
   * Insert the snippet into the target note: at the cursor when the
   * note is open in an editor, appended otherwise. Throws when no target
   * note can be determined — callers surface this as a notice.
   */
  async insertIntoTarget(text: string, target: TargetStrategy): Promise<void> {
    if (target.kind === "note") {
      const file = this.app.vault.getFileByPath(target.path);
      if (!file) throw new Error(`Target note not found: ${target.path}`);
      const editor = this.editorFor(file);
      if (editor) this.insertAtCursor(editor, text);
      else await this.append(file, text);
      return;
    }

    const view = this.lastActiveMarkdownView();
    if (!view?.file) throw new Error("No markdown note is open to paste into");
    this.insertAtCursor(view, text);
  }

  /** Delete-from-preview = remove the link from its note. */
  async removeLink(source: NoteRef, subpath: SubpathParams): Promise<void> {
    const file = this.app.vault.getFileByPath(source.path);
    if (!file) return;
    await this.app.vault.process(file, (content) => {
      return removeAnnotationLink(content, subpath, source.line) ?? content;
    });
  }

  /** The most recently active markdown view (the default auto-paste target). */
  private lastActiveMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;

    let best: { view: MarkdownView; time: number } | null = null;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      // `activeTime` is undocumented but stable; 0 keeps untouched leaves last.
      const time = (leaf as WorkspaceLeaf & { activeTime?: number }).activeTime ?? 0;
      if (!best || time > best.time) best = { view, time };
    }
    return best?.view ?? null;
  }

  private editorFor(file: TFile): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return view;
    }
    return null;
  }

  private insertAtCursor(view: MarkdownView, text: string): void {
    const editor = view.editor;
    const cursor = editor.getCursor();
    const block = cursor.ch === 0 ? `${text}\n` : `\n${text}\n`;
    editor.replaceRange(block, cursor);
    editor.setCursor(editor.offsetToPos(editor.posToOffset(cursor) + block.length));
  }

  private async append(file: TFile, text: string): Promise<void> {
    await this.app.vault.process(file, (content) =>
      content === "" ? `${text}\n` : `${content.replace(/\n?$/, "\n")}\n${text}\n`,
    );
  }
}
