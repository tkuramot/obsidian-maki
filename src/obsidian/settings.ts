/**
 * Plugin settings: persisted shape, defaults, and the settings tab.
 * Humble — parsing/serialization helpers aside, everything here is
 * presentation over `MakiSettings`.
 */

import { Notice, PluginSettingTab, Setting, setIcon, setTooltip } from "obsidian";
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

/** Palette names end up in link subpaths (`color=<name>`, spec §6). */
const PALETTE_NAME_PATTERN = /^[\w-]+$/;

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** Rename a palette key while keeping the display order of the entries. */
function renamePaletteColor(palette: Palette, from: string, to: string): Palette {
  const next: Palette = {};
  for (const [name, rgb] of Object.entries(palette)) next[name === from ? to : name] = rgb;
  return next;
}

/** First `color-N` not already taken. */
function nextColorName(palette: Palette): string {
  for (let n = 1; ; n++) {
    const name = `color-${n}`;
    if (!(name in palette)) return name;
  }
}

export class MakiSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: MakiPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    this.displayPalette();

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

  /**
   * The palette as a strip of chips — the same "swatch + name" the toolbar
   * picker menu shows, so the setting looks like what it configures.
   */
  private displayPalette(): void {
    const setting = new Setting(this.containerEl)
      .setName("Highlight colors")
      .setDesc(
        "The palette offered by the toolbar picker; the first color is the default. " +
          "Links in notes store the color name, so renaming or deleting one makes " +
          "existing annotations fall back to the default.",
      );
    setting.settingEl.addClass("maki-palette-setting");

    // Full-width second line inside the same setting item.
    const strip = setting.settingEl.createDiv({ cls: "maki-palette-chips" });
    const palette = this.plugin.settings.palette;
    const lastColor = Object.keys(palette).length <= 1;
    for (const [name, rgb] of Object.entries(palette)) {
      this.displayColorChip(strip, name, rgb, lastColor);
    }

    const add = strip.createEl("button", { cls: "maki-color-chip maki-chip-add" });
    const addIcon = add.createSpan({ cls: "maki-chip-add-icon" });
    setIcon(addIcon, "plus");
    add.createSpan({ text: "Add color" });
    add.addEventListener("click", async () => {
      await this.plugin.updateSettings((settings) => {
        settings.palette[nextColorName(settings.palette)] = [255, 165, 0];
      });
      this.display();
    });
  }

  /** One chip: swatch (opens the color dialog) + inline name + delete. */
  private displayColorChip(
    strip: HTMLElement,
    name: string,
    rgb: [number, number, number],
    lastColor: boolean,
  ): void {
    const chip = strip.createDiv({ cls: "maki-color-chip" });
    // The handlers below edit by key; track renames so they keep working
    // without a full re-render.
    let currentName = name;

    // A round dot (same look as the toolbar picker) with an invisible native
    // color input stretched over it — styling the input directly clips it.
    const swatch = chip.createDiv({ cls: "maki-chip-swatch" });
    swatch.style.backgroundColor = `rgb(${rgb.join(",")})`;
    setTooltip(swatch, "Change color");
    const swatchInput = swatch.createEl("input", {
      type: "color",
      cls: "maki-chip-swatch-input",
    });
    swatchInput.value = rgbToHex(rgb);
    swatchInput.addEventListener("change", async () => {
      const nextRgb = hexToRgb(swatchInput.value);
      if (!nextRgb) return;
      swatch.style.backgroundColor = `rgb(${nextRgb.join(",")})`;
      await this.plugin.updateSettings((settings) => {
        settings.palette[currentName] = nextRgb;
      });
    });

    const nameInput = chip.createEl("input", { type: "text", cls: "maki-chip-name" });
    nameInput.value = name;
    setTooltip(nameInput, "Rename (the name is stored in links)");
    // Commit on blur/Enter, not per keystroke — half-typed names must never
    // hit the palette (they would churn links and the toolbar picker).
    nameInput.addEventListener("change", async () => {
      const next = nameInput.value.trim();
      if (next === currentName) return;
      const invalid = !PALETTE_NAME_PATTERN.test(next);
      if (invalid || next in this.plugin.settings.palette) {
        new Notice(
          invalid
            ? "Color names may only use letters, digits, _ and -."
            : `A color named "${next}" already exists.`,
        );
        nameInput.value = currentName;
        return;
      }
      const previous = currentName;
      currentName = next;
      await this.plugin.updateSettings((settings) => {
        settings.palette = renamePaletteColor(settings.palette, previous, next);
        if (settings.selectedColor === previous) settings.selectedColor = next;
      });
    });

    if (!lastColor) {
      const remove = chip.createEl("button", {
        cls: "maki-chip-delete",
        attr: { "aria-label": "Delete color" },
      });
      setIcon(remove, "trash-2");
      setTooltip(remove, "Delete color");
      remove.addEventListener("click", async () => {
        await this.plugin.updateSettings((settings) => {
          delete settings.palette[currentName];
          if (settings.selectedColor === currentName) settings.selectedColor = "";
        });
        this.display();
      });
    }
  }
}
