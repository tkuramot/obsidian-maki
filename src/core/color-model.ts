/**
 * `ColorModel` — palette name ↔ RGB mapping and parsing/serialization of the
 * `color` subpath value (`name` or `r,g,b`; spec §6.2, design §4.3).
 * The `Color` *type* is shared vocabulary and lives in `types.ts`.
 */

import type { Color } from "./types";

export type Palette = Record<string, [number, number, number]>;

/** Default palette (FR-8.1: user-configurable in settings). */
export const DEFAULT_PALETTE: Palette = {
  yellow: [255, 208, 0],
  red: [255, 86, 86],
  green: [68, 207, 110],
  blue: [84, 155, 255],
};

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
   * rather than skipping the highlight (only *locators* gate rendering,
   * FR-5.5).
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
