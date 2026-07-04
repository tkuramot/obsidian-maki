/**
 * `ColorModel` — palette name ↔ RGB mapping and parsing/serialization of the
 * `color` subpath value (`name` or `r,g,b`).
 * The `Color` *type* is shared vocabulary and lives in `types.ts`.
 */

import type { Color } from "./types";

export type Palette = Record<string, [number, number, number]>;

/** Default palette (user-configurable in settings). */
export const DEFAULT_PALETTE: Palette = {
  yellow: [255, 208, 0],
  red: [255, 86, 86],
  green: [68, 207, 110],
  blue: [84, 155, 255],
};

/**
 * Palette names end up in link subpaths (`color=<name>`, spec §6), so they
 * are restricted to characters that survive there unescaped.
 */
export function isValidPaletteName(name: string): boolean {
  return /^[\w-]+$/.test(name);
}

/** `[255, 208, 0]` → `#ffd000` (the native color input's value format). */
export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** `#ffd000` → `[255, 208, 0]`; null for anything but a 6-digit hex color. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** Rename a palette key while keeping the display order of the entries. */
export function renamePaletteColor(palette: Palette, from: string, to: string): Palette {
  const next: Palette = {};
  for (const [name, rgb] of Object.entries(palette))
    next[name === from ? to : name] = rgb;
  return next;
}

/** First `color-N` not already taken. */
export function nextColorName(palette: Palette): string {
  for (let n = 1; ; n++) {
    const name = `color-${n}`;
    if (!(name in palette)) return name;
  }
}

function parseChannel(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n <= 255 ? n : null;
}

export class ColorModel {
  constructor(private readonly palette: Palette = DEFAULT_PALETTE) {}

  /** Resolve a palette name to a Color, or null if not in the palette. */
  fromName(name: string): Color | null {
    const rgb = this.palette[name];
    return rgb ? { name, rgb: [...rgb] } : null;
  }

  /**
   * Parse a `color` subpath value: a palette name or `r,g,b` (three 0–255
   * ints). Returns null for anything else — callers fall back to a default
   * rather than skipping the highlight (only *locators* gate rendering).
   */
  parse(value: string): Color | null {
    const named = this.fromName(value);
    if (named) return named;
    const parts = value.split(",").map((p) => parseChannel(p.trim()));
    if (parts.length !== 3 || parts.some((p) => p === null)) return null;
    return { rgb: parts as [number, number, number] };
  }

  /** Serialize a Color to its subpath value: the name, or `r,g,b`. */
  serialize(color: Color): string {
    return color.name ?? color.rgb.join(",");
  }
}
