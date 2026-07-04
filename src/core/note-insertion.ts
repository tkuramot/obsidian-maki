/**
 * How an annotation snippet lands in a note: the block inserted at the
 * cursor. Pure so `ObsidianNoteWriter` stays humble — it only applies the
 * block to the editor and advances the cursor by the block's length.
 */

/**
 * The snippet always occupies its own line(s): at a line start it needs no
 * leading separator, mid-line it first breaks onto a fresh line.
 */
export function insertionBlock(text: string, atLineStart: boolean): string {
  return atLineStart ? `${text}\n` : `\n${text}\n`;
}
