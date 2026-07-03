/**
 * Plugin settings: persisted shape, defaults, and the settings tab.
 * Humble — parsing/serialization helpers aside, everything here is
 * presentation over `MakiSettings`.
 */

import { PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_ANNOTATION_SETTINGS } from "../core/annotation-service";
import { DEFAULT_PALETTE, type Palette } from "../core/color-model";
import type MakiPlugin from "../main";

/** EPUB rendering preferences. */
export interface EpubPreferences {
  /** Reading flow: page-flipping columns or a continuous scroll.
   * No settings-tab UI — toggled from the viewer toolbar's display options. */
  flow: "paginated" | "scrolled";
  /** Maximum column count of the paginated layout. */
  maxColumnCount: number;
  /** Font size in percent of the theme default (100 = unchanged). */
  fontSizePercent: number;
  lineHeight: number;
  /** Page margin in pixels. */
  marginPx: number;
  /** Follow Obsidian's light/dark theme inside the book. */
  followTheme: boolean;
}

export interface MakiSettings {
  /** Settings schema version — bump on breaking shape changes. */
  version: 1;
  palette: Palette;
  /** Toolbar-picked highlight color (a palette name); "" = first palette color. */
  selectedColor: string;
  snippetTemplate: string;
  displayTemplates: { pdf: string; epub: string };
  autoCopy: boolean;
  autoPaste: boolean;
  /** Auto-paste target: empty = last active markdown note. */
  targetNotePath: string;
  epub: EpubPreferences;
  /** Last reading position per document path (EPUB: wrapped CFI). */
  readingPositions: Record<string, string>;
}

export const DEFAULT_SETTINGS: MakiSettings = {
  version: 1,
  palette: { ...DEFAULT_PALETTE },
  selectedColor: "",
  snippetTemplate: DEFAULT_ANNOTATION_SETTINGS.snippetTemplate,
  displayTemplates: { ...DEFAULT_ANNOTATION_SETTINGS.displayTemplates },
  autoCopy: true,
  autoPaste: false,
  targetNotePath: "",
  epub: {
    flow: "paginated",
    maxColumnCount: 1,
    fontSizePercent: 100,
    lineHeight: 1.5,
    marginPx: 48,
    followTheme: true,
  },
  readingPositions: {},
};

/** `yellow: 255,208,0` lines ↔ Palette. Invalid lines are dropped. */
export function parsePaletteText(text: string): Palette {
  const palette: Palette = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([\w-]+)\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line);
    if (!match) continue;
    const rgb = [Number(match[2]), Number(match[3]), Number(match[4])];
    if (rgb.some((n) => n > 255)) continue;
    palette[match[1]!] = rgb as [number, number, number];
  }
  return palette;
}

export function serializePaletteText(palette: Palette): string {
  return Object.entries(palette)
    .map(([name, rgb]) => `${name}: ${rgb.join(",")}`)
    .join("\n");
}

export class MakiSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: MakiPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Color palette")
      .setDesc("One color per line: name: r,g,b.")
      .addTextArea((text) =>
        text.setValue(serializePaletteText(s.palette)).onChange(async (value) => {
          const palette = parsePaletteText(value);
          if (Object.keys(palette).length === 0) return; // never empty the palette
          await this.plugin.updateSettings((settings) => {
            settings.palette = palette;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Snippet template")
      .setDesc("Block inserted into the note. Variables: {{linkWithDisplay}}, {{text}}, {{comment}}, ….")
      .addTextArea((text) =>
        text.setValue(s.snippetTemplate).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.snippetTemplate = value || DEFAULT_SETTINGS.snippetTemplate;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Link display text (PDF)")
      .addText((text) =>
        text.setValue(s.displayTemplates.pdf).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.displayTemplates.pdf = value || DEFAULT_SETTINGS.displayTemplates.pdf;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Link display text (EPUB)")
      .addText((text) =>
        text.setValue(s.displayTemplates.epub).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.displayTemplates.epub = value || DEFAULT_SETTINGS.displayTemplates.epub;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Copy link to clipboard")
      .setDesc("Copy the snippet whenever an annotation is created.")
      .addToggle((toggle) =>
        toggle.setValue(s.autoCopy).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.autoCopy = value;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Auto-paste into a note")
      .setDesc("Insert the snippet into the target note without leaving the preview.")
      .addToggle((toggle) =>
        toggle.setValue(s.autoPaste).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.autoPaste = value;
          });
        }),
      );

    new Setting(containerEl)
      .setName("Auto-paste target note")
      .setDesc("Vault path of the target note. Leave empty for the last active markdown note.")
      .addText((text) =>
        text
          .setPlaceholder("00 Inbox/Reading notes.md")
          .setValue(s.targetNotePath)
          .onChange(async (value) => {
            await this.plugin.updateSettings((settings) => {
              settings.targetNotePath = value.trim();
            });
          }),
      );

    new Setting(containerEl).setName("EPUB").setHeading();

    new Setting(containerEl)
      .setName("Maximum column count")
      .addSlider((slider) =>
        slider
          .setLimits(1, 3, 1)
          .setDynamicTooltip()
          .setValue(s.epub.maxColumnCount)
          .onChange(async (value) => {
            await this.plugin.updateSettings((settings) => {
              settings.epub.maxColumnCount = value;
            });
          }),
      );

    new Setting(containerEl)
      .setName("Font size (%)")
      .addSlider((slider) =>
        slider
          .setLimits(50, 200, 5)
          .setDynamicTooltip()
          .setValue(s.epub.fontSizePercent)
          .onChange(async (value) => {
            await this.plugin.updateSettings((settings) => {
              settings.epub.fontSizePercent = value;
            });
          }),
      );

    new Setting(containerEl)
      .setName("Line height")
      .addSlider((slider) =>
        slider
          .setLimits(1, 2.5, 0.1)
          .setDynamicTooltip()
          .setValue(s.epub.lineHeight)
          .onChange(async (value) => {
            await this.plugin.updateSettings((settings) => {
              settings.epub.lineHeight = value;
            });
          }),
      );

    new Setting(containerEl)
      .setName("Page margin (px)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 120, 4)
          .setDynamicTooltip()
          .setValue(s.epub.marginPx)
          .onChange(async (value) => {
            await this.plugin.updateSettings((settings) => {
              settings.epub.marginPx = value;
            });
          }),
      );

    new Setting(containerEl)
      .setName("Follow Obsidian theme")
      .setDesc("Apply the vault's light/dark colors to the book.")
      .addToggle((toggle) =>
        toggle.setValue(s.epub.followTheme).onChange(async (value) => {
          await this.plugin.updateSettings((settings) => {
            settings.epub.followTheme = value;
          });
        }),
      );
  }
}
