/**
 * href-keyed accessors over an EPUB read from the vault, for foliate's EPUB
 * parser. Mirrors upstream's `makeZipLoader`, but over the
 * `@zip.js/zip.js` npm dependency instead of foliate's own vendor copy.
 */

import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  configure,
  type Entry,
} from "@zip.js/zip.js";
import type { EpubLoader } from "foliate-js/epub.js";

export interface VaultZipLoader extends EpubLoader {
  close(): Promise<void>;
}

export async function makeVaultZipLoader(file: File): Promise<VaultZipLoader> {
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const byName = new Map<string, Entry>(entries.map((entry) => [entry.filename, entry]));

  // `Entry` is a union; only file entries (directory: false) carry getData.
  const fileEntry = (name: string) => {
    const entry = byName.get(name);
    return entry && entry.directory === false ? entry : null;
  };

  return {
    loadText: async (name) => {
      const entry = fileEntry(name);
      return entry ? await entry.getData(new TextWriter()) : null;
    },
    loadBlob: async (name) => {
      const entry = fileEntry(name);
      return entry ? await entry.getData(new BlobWriter()) : null;
    },
    getSize: (name) => byName.get(name)?.uncompressedSize ?? 0,
    close: () => reader.close(),
  };
}
