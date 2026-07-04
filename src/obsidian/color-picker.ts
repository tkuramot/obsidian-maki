/**
 * Toolbar color picker (FR-9.2): a `clickable-icon` tinted with the currently
 * selected highlight color; clicking opens the palette as a menu. Humble —
 * what "selected" means and where it persists are the caller's.
 */

import { Menu, setTooltip } from "obsidian";
import type { Color, Disposable } from "../core/types";

export interface ColorPickerDeps {
  /** Palette, in display order. */
  colors(): Color[];
  /** Currently selected color. */
  selected(): Color;
  /** Persist a new selection. */
  select(color: Color): void;
}

export interface ColorPickerHandle extends Disposable {
  el: HTMLElement;
  /** Re-read `selected()` into the button tint (after settings changes). */
  refresh(): void;
}

function rgb(color: Color): string {
  return `rgb(${color.rgb.join(",")})`;
}

function label(color: Color): string {
  return color.name ?? color.rgb.join(",");
}

/** Mount the picker button into a toolbar section. */
export function mountColorPicker(
  parent: HTMLElement,
  deps: ColorPickerDeps,
): ColorPickerHandle {
  const button = parent.createDiv({ cls: "clickable-icon maki-color-picker" });
  // A filled circle reads as "current color" better than a tinted icon.
  const dot = button.createDiv({ cls: "maki-color-picker-dot" });

  const refresh = (): void => {
    const color = deps.selected();
    dot.style.backgroundColor = rgb(color);
    setTooltip(button, `Highlight color: ${label(color)}`);
  };
  refresh();

  button.addEventListener("click", () => {
    const current = deps.selected();
    const menu = new Menu();
    for (const color of deps.colors()) {
      menu.addItem((item) =>
        item
          .setTitle(
            createFragment((frag) => {
              const swatch = frag.createSpan({ cls: "maki-color-swatch" });
              swatch.style.backgroundColor = rgb(color);
              frag.createSpan({ text: label(color) });
            }),
          )
          .setChecked(label(color) === label(current) ? true : null)
          .onClick(() => {
            deps.select(color);
            refresh();
          }),
      );
    }
    // Drop the menu under the button, as the native PDF toolbar does.
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: false,
    });
  });

  return { el: button, refresh, dispose: () => button.remove() };
}
