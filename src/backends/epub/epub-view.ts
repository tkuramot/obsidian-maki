/**
 * `MakiEpubView` — the plugin-owned `ItemView` hosting `<foliate-view>`.
 * Owns the reader chrome (mirroring the native PDF viewer's toolbar and
 * sidebar: sidebar toggle + TOC tree, prev/next, page input, font size,
 * display options), restores the reading
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
import { parkSectionStylesheets, SectionStyleInliner } from "./epub-style-inline";
import { EpubViewerAdapter } from "./epub-viewer-adapter";
import { makeVaultZipLoader, type VaultZipLoader } from "./vault-zip-loader";

export const MAKI_EPUB_VIEW_TYPE = "maki-epub";

/** Rendering preferences, as this view needs them. The settings
 * object satisfies this structurally. Layout metrics (columns, margins,
 * line height) are not preferences — foliate's responsive defaults apply. */
export interface EpubViewPreferences {
  flow: "paginated" | "scrolled";
  fontSizePercent: number;
  followTheme: boolean;
}

const FONT_SIZE_STEP = 10;
const FONT_SIZE_MIN = 50;
const FONT_SIZE_MAX = 200;

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
  private contentContainerEl: HTMLElement | null = null;
  private sidebarToggleEl: HTMLElement | null = null;
  private readonly tocSelfEls = new Map<string, HTMLElement>();
  private activeTocSelfEl: HTMLElement | null = null;
  /** Survives re-mounts of the same view (file switches). */
  private sidebarOpen = false;
  private pageInputEl: HTMLInputElement | null = null;
  private pageCountEl: HTMLElement | null = null;
  private fontDownEl: HTMLElement | null = null;
  private fontUpEl: HTMLElement | null = null;
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
    const prefs = this.deps.prefs();
    // Same disabled treatment as the native toolbar's zoom buttons at
    // MIN_SCALE / MAX_SCALE.
    this.fontDownEl?.toggleClass("mod-disabled", prefs.fontSizePercent <= FONT_SIZE_MIN);
    this.fontUpEl?.toggleClass("mod-disabled", prefs.fontSizePercent >= FONT_SIZE_MAX);
    const renderer = this.foliate?.renderer;
    if (!renderer) return;
    renderer.setAttribute("flow", prefs.flow === "scrolled" ? "scrolled" : "paginated");
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

    // Same control as the native PDF toolbar's sidebar toggle (its icon,
    // tooltip, and is-active state) — the TOC lives in the sidebar it opens.
    const sidebarBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(sidebarBtn, "lucide-layout-list");
    setTooltip(sidebarBtn, "Toggle sidebar");
    sidebarBtn.addEventListener("click", () => this.toggleSidebar());
    this.sidebarToggleEl = sidebarBtn;

    left.createDiv({ cls: "pdf-toolbar-spacer" });

    const prevBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(prevBtn, "lucide-chevron-left");
    setTooltip(prevBtn, "Previous page");
    left.createDiv({ cls: "pdf-toolbar-divider" });
    const nextBtn = left.createDiv({ cls: "clickable-icon" });
    setIcon(nextBtn, "lucide-chevron-right");
    setTooltip(nextBtn, "Next page");

    // Font size controls, in the native toolbar's zoom-button slot (spacer,
    // zoom-out, divider, zoom-in, right before the display-options chevron)
    // and with its icons — font size is the reflowable analogue of zoom.
    left.createDiv({ cls: "pdf-toolbar-spacer" });
    this.fontDownEl = left.createDiv({ cls: "clickable-icon" });
    setIcon(this.fontDownEl, "lucide-zoom-out");
    setTooltip(this.fontDownEl, "Decrease font size");
    this.fontDownEl.addEventListener("click", () => this.adjustFontSize(-FONT_SIZE_STEP));
    left.createDiv({ cls: "pdf-toolbar-divider" });
    this.fontUpEl = left.createDiv({ cls: "clickable-icon" });
    setIcon(this.fontUpEl, "lucide-zoom-in");
    setTooltip(this.fontUpEl, "Increase font size");
    this.fontUpEl.addEventListener("click", () => this.adjustFontSize(FONT_SIZE_STEP));

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

    // The book area mirrors the native PDF viewer's sidebar DOM
    // (.pdf-content-container > .pdf-viewer-container + .pdf-sidebar-container),
    // so Obsidian's own styles drive the slide-in, the viewer shift, and the
    // resizer — the sidebar hosts the TOC as a standard Obsidian tree, like
    // the PDF outline view.
    const bookHost = contentEl.createDiv({ cls: "maki-epub-book" });
    const content = bookHost.createDiv({ cls: "pdf-content-container" });
    // The width the native sidebar uses when showing the PDF outline.
    content.style.setProperty("--sidebar-width", "275px");
    const bookEl = content.createDiv({ cls: "pdf-viewer-container" });
    const sidebar = content.createDiv({ cls: "pdf-sidebar-container" });
    this.bindSidebarResizer(sidebar.createDiv({ cls: "pdf-sidebar-resizer" }), content);
    const outlineEl = sidebar
      .createDiv({ cls: "pdf-sidebar-content-wrapper" })
      .createDiv({ cls: "pdf-sidebar-content" })
      .createDiv({ cls: "pdf-outline-view" });
    this.contentContainerEl = content;
    content.toggleClass("sidebarOpen", this.sidebarOpen);
    sidebarBtn.toggleClass("is-active", this.sidebarOpen);

    const bytes = await this.app.vault.readBinary(file);
    this.loader = await makeVaultZipLoader(new File([bytes], file.name));
    const book = await new EPUB(this.loader).init();
    hardenBook(book); // book scripts never run (EPUB sections are untrusted HTML/JS)
    parkSectionStylesheets(book); // blob: stylesheets are CSP-blocked; see epub-style-inline

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
    this.renderOutline(outlineEl);

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
    this.tocSelfEls.clear();
    this.activeTocSelfEl = null;
    this.contentContainerEl = null;
    this.sidebarToggleEl = null;
    this.colorPicker?.dispose();
    this.colorPicker = null;
    this.pageInputEl = null;
    this.pageCountEl = null;
    this.fontDownEl = null;
    this.fontUpEl = null;
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

  private toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
    this.contentContainerEl?.toggleClass("sidebarOpen", this.sidebarOpen);
    this.sidebarToggleEl?.toggleClass("is-active", this.sidebarOpen);
    if (this.sidebarOpen) this.activeTocSelfEl?.scrollIntoView({ block: "nearest" });
  }

  /** The TOC as a standard Obsidian tree, like the native PDF outline view. */
  private renderOutline(container: HTMLElement): void {
    container.empty();
    this.tocSelfEls.clear();
    this.activeTocSelfEl = null;
    if (this.toc.length === 0) {
      container.createDiv({ cls: "maki-epub-outline-empty", text: "No table of contents" });
      return;
    }
    const addItems = (parent: HTMLElement, items: FoliateTocItem[]): void => {
      for (const entry of items) {
        const item = parent.createDiv({ cls: "tree-item" });
        const self = item.createDiv({ cls: "tree-item-self" });
        const children = entry.subitems ?? [];
        if (children.length > 0) {
          self.addClass("mod-collapsible");
          const toggle = self.createDiv({ cls: "tree-item-icon collapse-icon" });
          setIcon(toggle, "right-triangle");
          toggle.addEventListener("click", (evt) => {
            evt.stopPropagation();
            const collapsed = !item.hasClass("is-collapsed");
            item.toggleClass("is-collapsed", collapsed);
            toggle.toggleClass("is-collapsed", collapsed);
          });
        }
        self.createDiv({ cls: "tree-item-inner", text: entry.label?.trim() ?? "\u2026" });
        const href = entry.href;
        if (href !== undefined) {
          self.addClass("is-clickable");
          this.tocSelfEls.set(href, self);
          self.addEventListener("click", () => void this.foliate?.goTo(href));
        }
        if (children.length > 0) addItems(item.createDiv({ cls: "tree-item-children" }), children);
      }
    };
    addItems(container, this.toc);
  }

  /** Mark (and reveal) the chapter being read, as the PDF outline does. */
  private setActiveTocItem(href: string | null): void {
    const next = href !== null ? (this.tocSelfEls.get(href) ?? null) : null;
    if (next === this.activeTocSelfEl) return;
    this.activeTocSelfEl?.removeClass("mod-active");
    this.activeTocSelfEl = next;
    next?.addClass("mod-active");
    if (this.sidebarOpen) next?.scrollIntoView({ block: "nearest" });
  }

  /** Drag-resize via the native resizer handle: update `--sidebar-width`
   * (what both the sidebar and the shifted viewer read) and suppress the
   * slide transition while dragging, exactly as pdf.js's sidebar does. */
  private bindSidebarResizer(resizer: HTMLElement, container: HTMLElement): void {
    resizer.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      // Capture keeps the drag alive over the section iframes.
      resizer.setPointerCapture(down.pointerId);
      container.addClass("sidebarResizing");
      const rtl = getComputedStyle(container).direction === "rtl";
      const onMove = (move: PointerEvent): void => {
        const rect = container.getBoundingClientRect();
        const width = rtl ? rect.right - move.clientX : move.clientX - rect.left;
        const clamped = Math.max(150, Math.min(width, rect.width / 2));
        container.style.setProperty("--sidebar-width", `${Math.round(clamped)}px`);
      };
      const onUp = (): void => {
        container.removeClass("sidebarResizing");
        resizer.removeEventListener("pointermove", onMove);
        resizer.removeEventListener("pointerup", onUp);
      };
      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", onUp);
    });
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

  /** Step the font size preference, clamped to [FONT_SIZE_MIN, FONT_SIZE_MAX]. */
  private adjustFontSize(delta: number): void {
    const current = this.deps.prefs().fontSizePercent;
    const next = Math.min(Math.max(current + delta, FONT_SIZE_MIN), FONT_SIZE_MAX);
    if (next !== current) this.deps.updatePrefs((p) => (p.fontSizePercent = next));
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
    this.setActiveTocItem(location.tocItem?.href ?? null);
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
      p, li, blockquote, dd { line-height: 1.5; }
      ${themeCss}
    `;
  }
}
