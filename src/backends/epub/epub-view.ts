/**
 * `MakiEpubView` — the plugin-owned `ItemView` hosting `<foliate-view>`.
 * Owns the reader chrome (mirroring the native PDF viewer's toolbar: TOC
 * menu, prev/next, page input, display options), restores the reading
 * position, applies rendering preferences and theme follow, and hands the
 * adapter to the provider.
 * All humble — presentation of foliate state, no decisions.
 */

import {
  debounce,
  FileView,
  Menu,
  Notice,
  setIcon,
  setTooltip,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { EpubLocatorCodec } from "../../core/locator/epub-codec";
import { parseSubpath } from "../../core/locator/link";
import type { Disposable } from "../../core/types";
import { EPUB } from "foliate-js/epub.js";
import "foliate-js/view.js";
import type {
  FoliateLoadDetail,
  FoliateLocation,
  FoliateTocItem,
  View as FoliateView,
} from "foliate-js/view.js";
import { hardenBook } from "./epub-security";
import { SectionStyleInliner } from "./epub-style-inline";
import { EpubViewerAdapter } from "./epub-viewer-adapter";
import { makeVaultZipLoader, type VaultZipLoader } from "./vault-zip-loader";

export const MAKI_EPUB_VIEW_TYPE = "maki-epub";

/** Rendering preferences, as this view needs them. The settings
 * object satisfies this structurally. */
export interface EpubViewPreferences {
  flow: "paginated" | "scrolled";
  maxColumnCount: number;
  fontSizePercent: number;
  lineHeight: number;
  marginPx: number;
  followTheme: boolean;
}

/** What the integration layer injects into the view. */
export interface EpubViewDeps {
  /** Mount the shared toolbar color picker (FR-9.2) into a toolbar section. */
  mountColorPicker(parent: HTMLElement): Disposable;
  prefs(): EpubViewPreferences;
  /** Persist a preference change (from the toolbar's display-options menu)
   * and re-apply preferences to every open EPUB view. */
  updatePrefs(mutate: (prefs: EpubViewPreferences) => void): void;
  /** Persisted reading position (a wrapped CFI), per document path. */
  getPosition(path: string): string | undefined;
  setPosition(path: string, cfi: string): void;
}

export class MakiEpubView extends FileView {
  override allowNoFile = false;

  private foliate: FoliateView | null = null;
  private adapter: EpubViewerAdapter | null = null;
  private loader: VaultZipLoader | null = null;
  private toc: FoliateTocItem[] = [];
  private currentTocHref: string | null = null;
  private pageInputEl: HTMLInputElement | null = null;
  private pageCountEl: HTMLElement | null = null;
  private chapterEl: HTMLElement | null = null;
  private colorPicker: Disposable | null = null;
  private locationTotal = 0;
  private pendingSubpath: string | null = null;

  private ready!: Promise<EpubViewerAdapter>;
  private readyResolve!: (adapter: EpubViewerAdapter) => void;
  private readyReject!: (error: unknown) => void;

  private readonly savePosition = debounce((path: string, cfi: string) => {
    this.deps.setPosition(path, cfi);
  }, 1000);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EpubViewDeps,
  ) {
    super(leaf);
    this.resetReady();
    this.navigation = false;
  }

  override getViewType(): string {
    return MAKI_EPUB_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "EPUB";
  }

  override getIcon(): string {
    return "book-open";
  }

  override canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  /** The adapter for the currently open book (used by the provider). */
  whenReady(): Promise<EpubViewerAdapter> {
    return this.ready;
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.resetReady();
    try {
      await this.mount(file);
    } catch (error) {
      console.error(`Maki: failed to open ${file.path}`, error);
      this.contentEl.empty();
      this.contentEl.createDiv({
        cls: "maki-epub-error",
        text: `Could not open ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      this.readyReject(error);
    }
  }

  override async onUnloadFile(_file: TFile): Promise<void> {
    this.savePosition.run();
    this.teardown();
  }

  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const subpath = (state as { subpath?: unknown } | null)?.subpath;
    if (typeof subpath !== "string" || subpath === "") return;
    const normalized = subpath.replace(/^#/, "");
    if (this.adapter) void this.applySubpath(normalized);
    else this.pendingSubpath = normalized;
  }

  /** Re-apply rendering preferences (called on settings changes). */
  applyPreferences(): void {
    const renderer = this.foliate?.renderer;
    if (!renderer) return;
    const prefs = this.deps.prefs();
    renderer.setAttribute("flow", prefs.flow === "scrolled" ? "scrolled" : "paginated");
    renderer.setAttribute("max-column-count", String(prefs.maxColumnCount));
    renderer.setAttribute("margin", `${prefs.marginPx}px`);
    renderer.setStyles?.(this.bookCss(prefs));
  }

  // ---- mounting ------------------------------------------------------------

  private async mount(file: TFile): Promise<void> {
    this.teardown();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("maki-epub-view");

    // Same markup/classes as the native PDF viewer's toolbar, so Obsidian's
    // own styles (and themes) apply unchanged.
    const toolbar = contentEl.createDiv({ cls: "pdf-toolbar" });
    const left = toolbar.createDiv({ cls: "pdf-toolbar-left" });
    const right = toolbar.createDiv({ cls: "pdf-toolbar-right" });

    const tocBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(tocBtn, "lucide-list");
    setTooltip(tocBtn, "Table of contents");
    tocBtn.addEventListener("click", () => this.showTocMenu(tocBtn));

    left.createDiv({ cls: "pdf-toolbar-spacer" });

    const prevBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(prevBtn, "lucide-chevron-left");
    setTooltip(prevBtn, "Previous page");
    left.createDiv({ cls: "pdf-toolbar-divider" });
    const nextBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(nextBtn, "lucide-chevron-right");
    setTooltip(nextBtn, "Next page");

    const displayBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(displayBtn, "lucide-chevron-down");
    setTooltip(displayBtn, "Display options");
    displayBtn.addEventListener("click", () => this.showDisplayMenu(displayBtn));

    left.createDiv({ cls: "pdf-toolbar-spacer" });

    this.pageInputEl = left.createEl("input", {
      cls: "pdf-page-input",
      type: "number",
      attr: { min: "1" },
    });
    this.pageInputEl.addEventListener("click", () => this.pageInputEl?.select());
    this.pageInputEl.addEventListener("change", () => {
      if (this.pageInputEl) void this.goToPage(this.pageInputEl.value);
    });
    this.pageCountEl = left.createSpan({ cls: "pdf-page-numbers" });

    this.colorPicker = this.deps.mountColorPicker(right);
    this.chapterEl = right.createSpan({ cls: "maki-epub-chapter" });

    const bookEl = contentEl.createDiv({ cls: "maki-epub-book" });

    const bytes = await this.app.vault.readBinary(file);
    this.loader = await makeVaultZipLoader(new File([bytes], file.name));
    const book = await new EPUB(this.loader).init();
    hardenBook(book); // book scripts never run (EPUB sections are untrusted HTML/JS)

    const foliate = document.createElement("foliate-view");
    // SECURITY: the fork's renderers forward this attribute to the
    // section iframes' sandbox. Without it the upstream default keeps
    // `allow-scripts`, and a book script would run same-origin with
    // Obsidian's node-integrated renderer. Must be set before `open()`.
    foliate.setAttribute("sandbox", "allow-same-origin");
    this.foliate = foliate;
    bookEl.append(foliate);

    prevBtn.addEventListener("click", () => void foliate.prev());
    nextBtn.addEventListener("click", () => void foliate.next());
    foliate.addEventListener("relocate", (event) => {
      this.onRelocate((event as CustomEvent<FoliateLocation>).detail, file.path);
    });
    // Section iframes are separate documents, so keydown inside them never
    // reaches Obsidian's keymap (which listens on the app window) — hotkeys
    // like Cmd+P go dead while the book has focus. Relay each section's
    // keydown to the view's own document. Section listeners die with their
    // iframe, so no explicit cleanup is needed.
    const styleInliner = new SectionStyleInliner();
    foliate.addEventListener("load", (event) => {
      const { doc } = (event as CustomEvent<FoliateLoadDetail>).detail;
      doc.addEventListener("keydown", (evt) => this.relayKeydown(evt));
      // Obsidian's CSP blocks the sections' blob: stylesheet links; mirror
      // them as inline <style> so books don't render unstyled.
      void styleInliner.apply(doc);
    });

    const adapter = new EpubViewerAdapter({ path: file.path, backend: "epub" }, foliate);
    await foliate.open(book);
    this.applyPreferences();
    this.toc = book.toc ?? [];

    const lastLocation = this.deps.getPosition(file.path);
    await foliate.init(
      lastLocation !== undefined ? { lastLocation } : { showTextStart: true },
    );

    this.adapter = adapter;
    this.readyResolve(adapter);
    if (this.pendingSubpath !== null) {
      const subpath = this.pendingSubpath;
      this.pendingSubpath = null;
      await this.applySubpath(subpath);
    }
  }

  private teardown(): void {
    this.adapter?.destroy();
    this.adapter = null;
    this.foliate?.close();
    this.foliate?.remove();
    this.foliate = null;
    void this.loader?.close().catch(() => undefined);
    this.loader = null;
    this.toc = [];
    this.currentTocHref = null;
    this.colorPicker?.dispose();
    this.colorPicker = null;
    this.pageInputEl = null;
    this.pageCountEl = null;
    this.chapterEl = null;
    this.locationTotal = 0;
  }

  private resetReady(): void {
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // A book that never loads surfaces through acquire()'s timeout instead.
    this.ready.catch(() => undefined);
  }

  /** Re-dispatch a section-iframe keydown on the view's document so
   * Obsidian's keymap sees it (`ownerDocument`, not `document`, to follow
   * the view into popout windows). If Obsidian handles it as a hotkey,
   * suppress the iframe's default too. */
  private relayKeydown(evt: KeyboardEvent): void {
    const target = this.containerEl.ownerDocument.body;
    // The constructor reads the original event as its init dict, cloning
    // key/code/modifiers.
    const clone = new KeyboardEvent(evt.type, evt);
    const proceed = target.dispatchEvent(clone);
    if (!proceed || clone.defaultPrevented) evt.preventDefault();
  }

  // ---- chrome --------------------------------------------------------------

  private showTocMenu(anchor: HTMLElement): void {
    const foliate = this.foliate;
    if (!foliate) return;
    const menu = new Menu();
    if (this.toc.length === 0) {
      menu.addItem((item) => item.setTitle("No table of contents").setDisabled(true));
    }
    const addItems = (items: FoliateTocItem[], depth: number): void => {
      for (const entry of items) {
        const href = entry.href;
        menu.addItem((item) => {
          // em-space indentation: menus have no tree widget
          item.setTitle("\u2003".repeat(depth) + (entry.label?.trim() ?? "\u2026"));
          if (href === undefined) item.setDisabled(true);
          else {
            item.setChecked(href === this.currentTocHref ? true : null);
            item.onClick(() => void foliate.goTo(href));
          }
        });
        if (entry.subitems) addItems(entry.subitems, depth + 1);
      }
    };
    addItems(this.toc, 0);
    this.showBelow(menu, anchor);
  }

  private showDisplayMenu(anchor: HTMLElement): void {
    const prefs = this.deps.prefs();
    // The fixed-layout renderer has no scrolled flow.
    const fixedLayout = this.foliate?.isFixedLayout ?? false;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setIcon("lucide-book-open")
        .setTitle("Paginated")
        .setDisabled(fixedLayout)
        .setChecked(prefs.flow !== "scrolled")
        .onClick(() => this.deps.updatePrefs((p) => (p.flow = "paginated"))),
    );
    menu.addItem((item) =>
      item
        .setIcon("lucide-scroll")
        .setTitle("Scrolled")
        .setDisabled(fixedLayout)
        .setChecked(prefs.flow === "scrolled")
        .onClick(() => this.deps.updatePrefs((p) => (p.flow = "scrolled"))),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setIcon("lucide-palette")
        .setTitle("Adapt to theme")
        .setChecked(prefs.followTheme)
        .onClick(() => this.deps.updatePrefs((p) => (p.followTheme = !p.followTheme))),
    );
    this.showBelow(menu, anchor);
  }

  /** Drop a menu under a toolbar button, as the native PDF toolbar does. */
  private showBelow(menu: Menu, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: false });
  }

  /** Jump to a 1-based "page" (a foliate location) typed into the page input. */
  private async goToPage(value: string): Promise<void> {
    const foliate = this.foliate;
    const total = this.locationTotal;
    const n = Number(value);
    if (!foliate || total <= 0 || !Number.isFinite(n)) return;
    const page = Math.min(Math.max(Math.round(n), 1), total);
    await foliate.goToFraction((page - 1) / total);
  }

  private onRelocate(location: FoliateLocation, path: string): void {
    const loc = location.location;
    if (this.pageInputEl && this.pageCountEl && loc !== undefined && loc.total > 0) {
      this.locationTotal = loc.total;
      this.pageInputEl.max = String(loc.total);
      this.pageInputEl.value = String(Math.min(loc.current + 1, loc.total));
      this.pageCountEl.setText(`of ${loc.total}`);
    }
    this.currentTocHref = location.tocItem?.href ?? null;
    if (this.chapterEl) {
      const percent =
        typeof location.fraction === "number"
          ? `${Math.round(location.fraction * 100)}%`
          : "";
      const chapter = location.tocItem?.label?.trim() ?? "";
      this.chapterEl.setText([chapter, percent].filter((s) => s !== "").join(" · "));
    }
    if (typeof location.cfi === "string" && location.cfi !== "") {
      this.savePosition(path, location.cfi);
    }
  }

  // ---- navigation from links -----------------------------------------------

  private async applySubpath(subpath: string): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const locator = EpubLocatorCodec.decode(parseSubpath(subpath));
    if (!locator) return;
    const outcome = await adapter.reveal(locator, { flash: true });
    if (outcome !== "exact") {
      // degrade gracefully, and tell the user — never fail silently.
      new Notice(
        outcome === "fallback"
          ? "Maki: exact passage not found — jumped to its section"
          : "Maki: the linked passage could not be found in this book",
      );
    }
  }

  // ---- theme / preferences -------------------------------------------------

  private bookCss(prefs: EpubViewPreferences): string {
    const isDark = document.body.classList.contains("theme-dark");
    const computed = getComputedStyle(this.containerEl);
    const themeCss = prefs.followTheme
      ? `
        html, body { color: ${computed.color}; background: transparent; }
        a:link { color: ${computed.getPropertyValue("--text-accent").trim() || "inherit"}; }`
      : "";
    return `
      html { color-scheme: ${isDark && prefs.followTheme ? "dark" : "light"}; font-size: ${prefs.fontSizePercent}%; }
      p, li, blockquote, dd { line-height: ${prefs.lineHeight}; }
      ${themeCss}
    `;
  }
}
