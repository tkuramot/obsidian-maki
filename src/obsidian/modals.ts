/**
 * Small interaction modals for the commands and highlight navigation.
 * Humble: pure presentation, decisions stay with callers.
 */

import { Modal, SuggestModal, type App } from "obsidian";
import type { Color, NoteRef } from "../core/types";

/** Pick a palette color. */
export class ColorSuggestModal extends SuggestModal<Color> {
  constructor(
    app: App,
    private readonly colors: Color[],
    private readonly onPick: (color: Color) => void,
  ) {
    super(app);
    this.setPlaceholder("Highlight color…");
  }

  getSuggestions(query: string): Color[] {
    const q = query.toLowerCase();
    return this.colors.filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }

  renderSuggestion(color: Color, el: HTMLElement): void {
    const swatch = el.createSpan({ cls: "maki-color-swatch" });
    swatch.style.backgroundColor = `rgb(${color.rgb.join(",")})`;
    el.createSpan({ text: ` ${color.name ?? color.rgb.join(",")}` });
  }

  onChooseSuggestion(color: Color): void {
    this.onPick(color);
  }
}

/** Pick one of several source notes referencing the same passage. */
export class SourceSuggestModal extends SuggestModal<NoteRef> {
  constructor(
    app: App,
    private readonly sources: NoteRef[],
    private readonly onPick: (source: NoteRef) => void,
  ) {
    super(app);
    this.setPlaceholder("Open source note…");
  }

  getSuggestions(query: string): NoteRef[] {
    const q = query.toLowerCase();
    return this.sources.filter((s) => s.path.toLowerCase().includes(q));
  }

  renderSuggestion(source: NoteRef, el: HTMLElement): void {
    el.createSpan({
      text: source.line !== undefined ? `${source.path}:${source.line + 1}` : source.path,
    });
  }

  onChooseSuggestion(source: NoteRef): void {
    this.onPick(source);
  }
}

/** One-line comment input for “Copy link to selection with comment”. */
export class CommentModal extends Modal {
  private value = "";
  private submitted = false;

  constructor(
    app: App,
    private readonly onSubmit: (comment: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("Annotation comment");
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "maki-comment-input",
      placeholder: "Comment…",
    });
    input.addEventListener("input", () => (this.value = input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.submit();
      }
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const ok = buttons.createEl("button", { text: "Annotate", cls: "mod-cta" });
    ok.addEventListener("click", () => this.submit());
    input.focus();
  }

  private submit(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.close();
    this.onSubmit(this.value);
  }
}
