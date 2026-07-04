/**
 * Commands: translate user intent into `AnnotationService` calls on
 * the active `DocumentViewer`. The command verb *is* the destination —
 * "Copy …" always goes to the clipboard, "Insert …" always goes into the
 * target note; there are no effect toggles. Notices are reserved for
 * effects with no visible trace: an inserted link immediately renders as
 * a highlight (its own confirmation), so only the clipboard — which
 * changes nothing on screen — confirms with a notice.
 */

import { Notice } from "obsidian";
import type { AnnotationDestination } from "../core/annotation-service";
import type { DocumentViewer } from "../core/document-viewer";
import type { Color } from "../core/types";
import type MakiPlugin from "../main";
import { CommentModal } from "./modals";
import type { OnSelectAction } from "./settings";

/**
 * Run the annotate pipeline on a specific viewer. `quiet` suppresses the
 * "nothing is selected" complaint — annotate-on-selection fires on
 * selections the backend may reject (e.g. cross-page), which must not nag.
 */
export async function annotateViewer(
  plugin: MakiPlugin,
  viewer: DocumentViewer,
  color: Color,
  destination: AnnotationDestination,
  opts: { comment?: string | undefined; quiet?: boolean } = {},
): Promise<void> {
  try {
    const result = await plugin.annotations.annotate(viewer, color, destination, opts.comment);
    if (!result) {
      if (!opts.quiet) new Notice("Maki: nothing is selected");
      return;
    }
    if (destination === "clipboard") new Notice("Maki: link copied");
  } catch (error) {
    console.error("Maki: annotate failed", error);
    new Notice(`Maki: ${error instanceof Error ? error.message : "annotation failed"}`);
  }
}

async function annotate(
  plugin: MakiPlugin,
  color: Color,
  destination: AnnotationDestination,
  comment?: string,
): Promise<void> {
  const viewer = plugin.viewers.activeViewer();
  if (!viewer) {
    new Notice("Maki: no document preview is open");
    return;
  }
  await annotateViewer(plugin, viewer, color, destination, { comment });
}

const ON_SELECT_CYCLE: Record<OnSelectAction, OnSelectAction> = {
  off: "copy",
  copy: "insert",
  insert: "off",
};

const ON_SELECT_NOTICE: Record<OnSelectAction, string> = {
  off: "do nothing",
  copy: "copy the link",
  insert: "insert the link into the note",
};

export function registerCommands(plugin: MakiPlugin): void {
  const families: Array<{ id: string; verb: string; destination: AnnotationDestination }> = [
    { id: "copy-link-to-selection", verb: "Copy link to selection", destination: "clipboard" },
    { id: "insert-link-into-note", verb: "Insert link into note", destination: "note" },
  ];

  for (const { id, verb, destination } of families) {
    plugin.addCommand({
      id,
      name: verb,
      callback: () => void annotate(plugin, plugin.selectedColor(), destination),
    });

    plugin.addCommand({
      id: `${id}-with-comment`,
      name: `${verb} with comment`,
      callback: () => {
        new CommentModal(plugin.app, (comment) => {
          void annotate(plugin, plugin.selectedColor(), destination, comment);
        }).open();
      },
    });
  }

  plugin.addCommand({
    id: "cycle-on-select-action",
    name: "Cycle what selecting text does (off / copy / insert)",
    callback: () => {
      void plugin
        .updateSettings((s) => {
          s.onSelect = ON_SELECT_CYCLE[s.onSelect];
        })
        .then(() => {
          new Notice(`Maki: selecting text will ${ON_SELECT_NOTICE[plugin.settings.onSelect]}`);
        });
    },
  });
}
