/**
 * Hand-written, minimal declarations for foliate-js `overlayer.js` — only
 * the surface Maki's EPUB adapter uses (see view.d.ts for how these are
 * wired to the `vendor/foliate-js` submodule, and the drift caveat).
 */

export type DrawFunction = (
  rects: Iterable<DOMRect>,
  options?: Record<string, unknown>,
) => SVGElement;

export class Overlayer {
  static highlight: DrawFunction;
  static underline: DrawFunction;
  static outline: DrawFunction;
  static squiggly: DrawFunction;
  static strikethrough: DrawFunction;

  readonly element: SVGElement;
  add(
    key: string,
    range: Range | ((root: Node) => Range),
    draw: DrawFunction,
    options?: Record<string, unknown>,
  ): void;
  remove(key: string): void;
  redraw(): void;
  hitTest(point: { x: number; y: number }): [string, Range] | [];
}
