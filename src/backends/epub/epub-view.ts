/**
 * `MakiEpubView` — the plugin-owned `ItemView` hosting `<foliate-view>`.
 * Owns the reader chrome (TOC, prev/next, progress), restores the reading
 * position, applies rendering preferences and theme follow, and hands the
 * adapter to the provider.
 * All humble — presentation of foliate state, no decisions.
 */

import { debounce, FileView, Notice, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { EpubLocatorCodec } from "../../core/locator/epub-codec";
import { parseSubpath } from "../../core/locator/link";
import { EPUB } from "foliate-js/epub.js";
import "foliate-js/view.js";
import type {
  FoliateLocation,
  FoliateTocItem,
  View as FoliateView,
} from "foliate-js/view.js";
import { hardenBook } from "./epub-security";
import { EpubViewerAdapter } from "./epub-viewer-adapter";
import { makeVaultZipLoader, type VaultZipLoader } from "./vault-zip-loader";

export const MAKI_EPUB_VIEW_TYPE = "maki-epub";

/** Rendering preferences, as this view needs them. The settings
 * object satisfies this structurally. */
export interface EpubViewPreferences {
  maxColumnCount: number;
  fontSizePercent: number;
  lineHeight: number;
  marginPx: number;
  followTheme: boolean;
}

/** What the integration layer injects into the view. */
export interface EpubViewDeps {
  prefs(): EpubViewPreferences;
  /** Persisted reading position (a wrapped CFI), per document path. */
  getPosition(path: string): string | undefined;
  setPosition(path: string, cfi: string): void;
}

export class MakiEpubView extends FileView {
  override allowNoFile = false;

  private foliate: FoliateView | null = null;
  private adapter: EpubViewerAdapter | null = null;
  private loader: VaultZipLoader | null = null;
  private tocSelect: HTMLSelectElement | null = null;
  private progressEl: HTMLElement | null = null;
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

    const toolbar = contentEl.createDiv({ cls: "maki-epub-toolbar" });
    const prevBtn = toolbar.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Previous section" },
    });
    setIcon(prevBtn, "chevron-left");
    this.tocSelect = toolbar.createEl("select", { cls: "dropdown maki-epub-toc" });
    const nextBtn = toolbar.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Next section" },
    });
    setIcon(nextBtn, "chevron-right");
    this.progressEl = toolbar.createSpan({ cls: "maki-epub-progress" });

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

    const adapter = new EpubViewerAdapter({ path: file.path, backend: "epub" }, foliate);
    await foliate.open(book);
    this.applyPreferences();
    this.populateToc(book.toc ?? [], foliate);

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
    this.tocSelect = null;
    this.progressEl = null;
  }

  private resetReady(): void {
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // A book that never loads surfaces through acquire()'s timeout instead.
    this.ready.catch(() => undefined);
  }

  // ---- chrome --------------------------------------------------------------

  private populateToc(toc: FoliateTocItem[], foliate: FoliateView): void {
    const select = this.tocSelect;
    if (!select) return;
    select.empty();
    select.createEl("option", { text: "Table of contents", value: "" });
    const addItems = (items: FoliateTocItem[], depth: number): void => {
      for (const item of items) {
        const label = `${" ".repeat(depth * 2)}${item.label?.trim() ?? "…"}`;
        const option = select.createEl("option", { text: label, value: item.href ?? "" });
        if (item.href === undefined) option.disabled = true;
        if (item.subitems) addItems(item.subitems, depth + 1);
      }
    };
    addItems(toc, 0);
    select.addEventListener("change", () => {
      if (select.value !== "") void foliate.goTo(select.value);
    });
  }

  private onRelocate(location: FoliateLocation, path: string): void {
    if (this.progressEl) {
      const percent =
        typeof location.fraction === "number"
          ? `${Math.round(location.fraction * 100)}%`
          : "";
      const chapter = location.tocItem?.label?.trim() ?? "";
      this.progressEl.setText([chapter, percent].filter((s) => s !== "").join(" · "));
    }
    if (this.tocSelect && location.tocItem?.href !== undefined) {
      this.tocSelect.value = location.tocItem.href;
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
