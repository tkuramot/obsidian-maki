/**
 * Plugin entry: construct the pure core, register the backend providers, and
 * wire the integration layer. All decisions live in the
 * core; this file only assembles and subscribes.
 */

import { Plugin, type WorkspaceLeaf } from "obsidian";
import { MakiEpubView, MAKI_EPUB_VIEW_TYPE } from "./backends/epub/epub-view";
import { EpubViewerProvider } from "./backends/epub/epub-viewer-provider";
import { PdfViewerProvider } from "./backends/pdf/pdf-viewer-provider";
import {
  AnnotationService,
  type AnnotationSettings,
} from "./core/annotation-service";
import { ColorModel, type Palette } from "./core/color-model";
import type { DocumentViewer } from "./core/document-viewer";
import { HighlightReconciler } from "./core/highlight-reconciler";
import type { Codecs } from "./core/locator/codec";
import { EpubLocatorCodec } from "./core/locator/epub-codec";
import { PdfLocatorCodec } from "./core/locator/pdf-codec";
import { SelectionAutoAnnotator } from "./core/selection-auto-annotator";
import { TemplateEngine } from "./core/template-engine";
import type { Color, Disposable, HighlightId } from "./core/types";
import { ViewerRegistry } from "./core/viewer-registry";
import { ObsidianBacklinkIndex } from "./obsidian/backlink-index";
import { mountColorPicker } from "./obsidian/color-picker";
import { annotateViewer, registerCommands } from "./obsidian/commands";
import { SourceSuggestModal } from "./obsidian/modals";
import { ObsidianNoteWriter } from "./obsidian/note-writer";
import { DEFAULT_SETTINGS, MakiSettingTab, type MakiSettings } from "./obsidian/settings";
import { openNoteAt, ViewerManager } from "./obsidian/viewer-manager";

const FALLBACK_COLOR: Color = { name: "yellow", rgb: [255, 208, 0] };

export default class MakiPlugin extends Plugin {
  // Narrows the base class's `settings?: unknown` (Obsidian ≥1.13).
  declare settings: MakiSettings;

  private readonly codecs: Codecs = { pdf: PdfLocatorCodec, epub: EpubLocatorCodec };
  /**
   * The one palette object handed to `ColorModel`. Settings changes are
   * synced *into* it (in place), so the core always sees the current palette
   * without being rebuilt.
   */
  private readonly livePalette: Palette = {};
  private colors!: ColorModel;
  /** Refresh hooks of the mounted toolbar color pickers (one per open viewer). */
  private readonly pickerRefreshers = new Set<() => void>();

  annotations!: AnnotationService;
  reconciler!: HighlightReconciler;
  viewers!: ViewerManager;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.colors = new ColorModel(this.livePalette);
    this.reconciler = new HighlightReconciler(this.codecs, this.colors, this.defaultColor());
    this.annotations = new AnnotationService({
      codecs: this.codecs,
      templates: new TemplateEngine(),
      colors: this.colors,
      notes: new ObsidianNoteWriter(this.app),
      settings: () => this.annotationSettings(),
    });

    const registry = new ViewerRegistry();
    const providers = [
      new PdfViewerProvider({
        mountColorPicker: (parent) => this.mountColorPicker(parent),
      }),
      new EpubViewerProvider({
        mountColorPicker: (parent) => this.mountColorPicker(parent),
        prefs: () => this.settings.epub,
        // updateSettings re-applies preferences to every open EPUB view.
        updatePrefs: (mutate) => void this.updateSettings((settings) => mutate(settings.epub)),
        getPosition: (path) => this.settings.readingPositions[path],
        setPosition: (path, cfi) => {
          this.settings.readingPositions[path] = cfi;
          void this.saveData(this.settings);
        },
      }),
    ];
    for (const provider of providers) {
      this.register(registry.register(provider).dispose);
      this.register(provider.setup(this).dispose);
    }

    // Annotate-on-selection mode (FR-8.3): a settled selection acts as the
    // copy or insert command per the `onSelect` setting. Quiet on unusable
    // selections — they are not user intent.
    const autoAnnotator = new SelectionAutoAnnotator({
      enabled: () => this.settings.onSelect !== "off",
      annotate: (viewer) =>
        void annotateViewer(
          this,
          viewer,
          this.selectedColor(),
          this.settings.onSelect === "insert" ? "note" : "clipboard",
          { quiet: true },
        ),
    });

    const index = new ObsidianBacklinkIndex(this.app);
    this.viewers = new ViewerManager(
      this.app,
      registry,
      this.reconciler,
      index,
      (viewer, id) => this.openHighlightSources(viewer, id),
      (viewer) => {
        const sub = viewer.onSelectionChange((sel) => autoAnnotator.onSelection(viewer, sel));
        const drag = viewer.onSelectionDrag((dragging) =>
          autoAnnotator.onDragChange(viewer, dragging),
        );
        return {
          dispose: () => {
            sub.dispose();
            drag.dispose();
            autoAnnotator.detach(viewer);
          },
        };
      },
    );

    this.registerEvent(this.app.workspace.on("layout-change", () => this.viewers.scan()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.viewers.scan()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
        this.viewers.noteActiveLeaf(leaf);
        this.viewers.scan();
      }),
    );
    this.app.workspace.onLayoutReady(() => this.viewers.scan());

    registerCommands(this);
    this.addSettingTab(new MakiSettingTab(this));
  }

  override onunload(): void {
    this.viewers.destroyAll();
  }

  // ---- settings --------------------------------------------------------------

  async updateSettings(mutate: (settings: MakiSettings) => void): Promise<void> {
    mutate(this.settings);
    this.syncLivePalette();
    await this.saveData(this.settings);
    // Colors / templates may have changed: re-project notes onto open viewers,
    // re-tint the toolbar pickers, and re-style open books.
    this.viewers.refreshAll();
    for (const refresh of this.pickerRefreshers) refresh();
    for (const leaf of this.app.workspace.getLeavesOfType(MAKI_EPUB_VIEW_TYPE)) {
      if (leaf.view instanceof MakiEpubView) leaf.view.applyPreferences();
    }
  }

  defaultColor(): Color {
    const first = Object.keys(this.livePalette)[0];
    return (first !== undefined ? this.colors?.fromName(first) : null) ?? FALLBACK_COLOR;
  }

  /** The toolbar-picked color the annotate commands use (FR-9.2). */
  selectedColor(): Color {
    return this.colors.fromName(this.settings.selectedColor) ?? this.defaultColor();
  }

  /**
   * Mount a toolbar color picker bound to the persisted selection. One per
   * open viewer; disposing unhooks it from settings refreshes.
   */
  mountColorPicker(parent: HTMLElement): Disposable & { el: HTMLElement } {
    const handle = mountColorPicker(parent, {
      colors: () => this.paletteColors(),
      selected: () => this.selectedColor(),
      select: (color) =>
        void this.updateSettings((settings) => {
          settings.selectedColor = color.name ?? "";
        }),
    });
    this.pickerRefreshers.add(handle.refresh);
    return {
      el: handle.el,
      dispose: () => {
        this.pickerRefreshers.delete(handle.refresh);
        handle.dispose();
      },
    };
  }

  paletteColors(): Color[] {
    return Object.keys(this.livePalette)
      .map((name) => this.colors.fromName(name))
      .filter((color): color is Color => color !== null);
  }

  private async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    const raw = (stored ?? {}) as Partial<MakiSettings>;
    // version currently has a single value (1); merging with the defaults is
    // the whole migration. Future shape changes branch on `raw.version` here.
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...raw,
      version: 1,
      palette: { ...(raw.palette ?? DEFAULT_SETTINGS.palette) },
      displayTemplates: { ...DEFAULT_SETTINGS.displayTemplates, ...raw.displayTemplates },
      epub: { ...DEFAULT_SETTINGS.epub, ...raw.epub },
      readingPositions: { ...(raw.readingPositions ?? {}) },
    };
    this.syncLivePalette();
  }

  private syncLivePalette(): void {
    for (const key of Object.keys(this.livePalette)) {
      if (!(key in this.settings.palette)) delete this.livePalette[key];
    }
    Object.assign(this.livePalette, this.settings.palette);
  }

  private annotationSettings(): AnnotationSettings {
    const s = this.settings;
    return {
      snippetTemplate: s.snippetTemplate,
      displayTemplates: { ...s.displayTemplates },
    };
  }

  // ---- navigation -------------------------------------------------------------

  private openHighlightSources(viewer: DocumentViewer, id: HighlightId): void {
    const highlight = this.reconciler.getHighlight(viewer, id);
    if (!highlight || highlight.sources.length === 0) return;
    if (highlight.sources.length === 1) {
      void openNoteAt(this.app, highlight.sources[0]!);
      return;
    }
    // several annotations target the passage — surface all of them.
    new SourceSuggestModal(this.app, highlight.sources, (source) => {
      void openNoteAt(this.app, source);
    }).open();
  }
}
