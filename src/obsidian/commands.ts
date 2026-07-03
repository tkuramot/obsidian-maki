/**
 * Commands: translate user intent into `AnnotationService` calls on
 * the active `DocumentViewer`. Every effect that is not visible in place
 * confirms itself with a notice.
 */

import { Notice } from "obsidian";
import type { DocumentViewer } from "../core/document-viewer";
import type { Color } from "../core/types";
import type MakiPlugin from "../main";
import { ColorSuggestModal, CommentModal } from "./modals";

/**
 * Run the annotate pipeline on a specific viewer and confirm the effects
 * with a notice (FR-9.4). `quiet` suppresses the "nothing is selected"
 * complaint — auto-copy-on-selection fires on selections the backend may
 * reject (e.g. cross-page), which must not nag.
 */
export async function annotateViewer(
  plugin: MakiPlugin,
  viewer: DocumentViewer,
  color: Color,
  opts: { comment?: string | undefined; quiet?: boolean } = {},
): Promise<void> {
  try {
    const result = await plugin.annotations.annotate(viewer, color, opts.comment);
    if (!result) {
      if (!opts.quiet) new Notice("Maki: nothing is selected");
      return;
    }
    const s = plugin.settings;
    const effects = [
      ...(s.autoCopy ? ["copied"] : []),
      ...(s.autoPaste ? ["inserted into the note"] : []),
    ];
    new Notice(`Maki: link ${effects.join(" and ") || "created"}`);
  } catch (error) {
    console.error("Maki: annotate failed", error);
    new Notice(`Maki: ${error instanceof Error ? error.message : "annotation failed"}`);
  }
}

async function annotate(plugin: MakiPlugin, color: Color, comment?: string): Promise<void> {
  const viewer = plugin.viewers.activeViewer();
  if (!viewer) {
    new Notice("Maki: no document preview is open");
    return;
  }
  await annotateViewer(plugin, viewer, color, { comment });
}

export function registerCommands(plugin: MakiPlugin): void {
  plugin.addCommand({
    id: "copy-link-to-selection",
    name: "Copy link to selection",
    callback: () => void annotate(plugin, plugin.selectedColor()),
  });

  plugin.addCommand({
    id: "copy-link-to-selection-with-color",
    name: "Copy link to selection (pick color)",
    callback: () => {
      new ColorSuggestModal(plugin.app, plugin.paletteColors(), (color) => {
        void annotate(plugin, color);
      }).open();
    },
  });

  plugin.addCommand({
    id: "copy-link-to-selection-with-comment",
    name: "Copy link to selection with comment",
    callback: () => {
      new CommentModal(plugin.app, (comment) => {
        void annotate(plugin, plugin.selectedColor(), comment);
      }).open();
    },
  });

  plugin.addCommand({
    id: "toggle-auto-paste",
    name: "Toggle auto-paste",
    callback: () => {
      void plugin
        .updateSettings((s) => {
          s.autoPaste = !s.autoPaste;
        })
        .then(() => {
          new Notice(`Maki: auto-paste ${plugin.settings.autoPaste ? "on" : "off"}`);
        });
    },
  });

  plugin.addCommand({
    id: "toggle-auto-copy",
    // Named after the setting it toggles — "auto-copy" reads as the
    // copy-on-selection mode (pdf-plus's sense), which is the command below.
    name: "Toggle copy link to clipboard",
    callback: () => {
      void plugin
        .updateSettings((s) => {
          s.autoCopy = !s.autoCopy;
        })
        .then(() => {
          new Notice(`Maki: copy link to clipboard ${plugin.settings.autoCopy ? "on" : "off"}`);
        });
    },
  });

  plugin.addCommand({
    id: "toggle-copy-on-select",
    name: "Toggle copy link on selection",
    callback: () => {
      void plugin
        .updateSettings((s) => {
          s.autoCopyOnSelect = !s.autoCopyOnSelect;
        })
        .then(() => {
          new Notice(
            `Maki: copy link on selection ${plugin.settings.autoCopyOnSelect ? "on" : "off"}`,
          );
        });
    },
  });
}
