/**
 * Commands: translate user intent into `AnnotationService` calls on
 * the active `DocumentViewer`. Every effect that is not visible in place
 * confirms itself with a notice.
 */

import { Notice } from "obsidian";
import type { Color } from "../core/types";
import type MakiPlugin from "../main";
import { ColorSuggestModal, CommentModal } from "./modals";

async function annotate(plugin: MakiPlugin, color: Color, comment?: string): Promise<void> {
  const viewer = plugin.viewers.activeViewer();
  if (!viewer) {
    new Notice("Maki: no document preview is open");
    return;
  }
  try {
    const result = await plugin.annotations.annotate(viewer, color, comment);
    if (!result) {
      new Notice("Maki: nothing is selected");
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

export function registerCommands(plugin: MakiPlugin): void {
  plugin.addCommand({
    id: "copy-link-to-selection",
    name: "Copy link to selection",
    callback: () => void annotate(plugin, plugin.defaultColor()),
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
        void annotate(plugin, plugin.defaultColor(), comment);
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
    name: "Toggle auto-copy",
    callback: () => {
      void plugin
        .updateSettings((s) => {
          s.autoCopy = !s.autoCopy;
        })
        .then(() => {
          new Notice(`Maki: auto-copy ${plugin.settings.autoCopy ? "on" : "off"}`);
        });
    },
  });
}
