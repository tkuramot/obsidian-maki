/**
 * `ObsidianBacklinkIndex` — reads the metadata cache for links that target a
 * document and turns them into `BacklinkEntry`s for the core reconciler.
 * Concrete and injected, not a port.
 *
 * Change events are debounced here: the metadata cache fires on every
 * keystroke while a note is edited, and reconciling per keystroke would
 * thrash the overlay.
 */

import { debounce, TFile, type App, type EventRef, type Events } from "obsidian";
import { parseAnnotationLink } from "../core/locator/link";
import type { BacklinkEntry, Disposable, DocumentRef } from "../core/types";

const CHANGE_DEBOUNCE_MS = 250;

export class ObsidianBacklinkIndex {
  constructor(private readonly app: App) {}

  /** Every backlink (in any note) whose subpath targets the document. */
  forDocument(ref: DocumentRef): BacklinkEntry[] {
    const { metadataCache } = this.app;
    const entries: BacklinkEntry[] = [];
    for (const sourcePath of this.sourcePaths(ref)) {
      const cache = metadataCache.getCache(sourcePath);
      if (!cache) continue;
      for (const link of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
        // The classification (what makes a link an annotation) is the core's.
        const parsed = parseAnnotationLink(link.link);
        if (!parsed) continue;
        const dest = metadataCache.getFirstLinkpathDest(parsed.linkpath, sourcePath);
        if (dest?.path !== ref.path) continue;
        const entry: BacklinkEntry = {
          subpath: parsed.params,
          source: { path: sourcePath, line: link.position.start.line },
        };
        if (parsed.color !== undefined) entry.color = parsed.color;
        entries.push(entry);
      }
    }
    return entries;
  }

  /**
   * Fire (debounced) whenever a note that links — or linked — to the document
   * changes, is deleted, or is renamed. Unrelated notes never trigger it.
   */
  onChange(ref: DocumentRef, cb: () => void): Disposable {
    const notify = debounce(cb, CHANGE_DEBOUNCE_MS, true);
    const sources = new Set(this.sourcePaths(ref));

    const touched = (path: string): void => {
      const now = this.linksTo(path, ref);
      const before = sources.has(path);
      if (now) sources.add(path);
      else sources.delete(path);
      if (now || before) notify();
    };

    const { metadataCache, vault } = this.app;
    const refs: Array<[Events, EventRef]> = [
      [metadataCache, metadataCache.on("changed", (file) => touched(file.path))],
      // "changed" fires before the link resolver updates `resolvedLinks`, so
      // a note's *first* link to the document is invisible to `linksTo` at
      // that point; "resolve" fires once resolution lands and closes the gap.
      [metadataCache, metadataCache.on("resolve", (file) => touched(file.path))],
      [metadataCache, metadataCache.on("deleted", (file) => touched(file.path))],
      [
        vault,
        vault.on("rename", (file, oldPath) => {
          if (sources.delete(oldPath)) notify();
          if (file instanceof TFile) touched(file.path);
        }),
      ],
    ];

    return {
      dispose: () => {
        notify.cancel();
        for (const [owner, eventRef] of refs) owner.offref(eventRef);
      },
    };
  }

  private linksTo(sourcePath: string, ref: DocumentRef): boolean {
    return (this.app.metadataCache.resolvedLinks[sourcePath]?.[ref.path] ?? 0) > 0;
  }

  private sourcePaths(ref: DocumentRef): string[] {
    return Object.keys(this.app.metadataCache.resolvedLinks).filter((path) =>
      this.linksTo(path, ref),
    );
  }
}
