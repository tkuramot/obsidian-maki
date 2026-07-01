/**
 * Plugin entry: construct the pure core and (eventually) register the
 * backend providers (design §8, §13).
 *
 * The PDF and EPUB adapters are not implemented yet; this entry wires the
 * core so the plugin loads, and is the seam where `PdfViewerProvider` /
 * `EpubViewerProvider` will be registered.
 */

import { Plugin } from "obsidian";
import {
  AnnotationService,
  DEFAULT_ANNOTATION_SETTINGS,
} from "./core/annotation-service";
import { ColorModel } from "./core/color-model";
import { HighlightReconciler } from "./core/highlight-reconciler";
import type { Codecs } from "./core/locator/codec";
import { EpubLocatorCodec } from "./core/locator/epub-codec";
import { PdfLocatorCodec } from "./core/locator/pdf-codec";
import { TemplateEngine } from "./core/template-engine";

export default class MakiPlugin extends Plugin {
  private readonly codecs: Codecs = { pdf: PdfLocatorCodec, epub: EpubLocatorCodec };
  private readonly colors = new ColorModel();

  annotations!: AnnotationService;
  reconciler!: HighlightReconciler;

  override async onload(): Promise<void> {
    const yellow = this.colors.fromName("yellow")!;

    this.reconciler = new HighlightReconciler(this.codecs, this.colors, yellow);
    this.annotations = new AnnotationService({
      codecs: this.codecs,
      templates: new TemplateEngine(),
      colors: this.colors,
      notes: {
        // Placeholder until ObsidianNoteWriter lands with the integration
        // layer; clipboard copy is the one behavior available without it.
        copyToClipboard: (text) => navigator.clipboard.writeText(text),
        insertIntoTarget: async () => {},
      },
      settings: () => DEFAULT_ANNOTATION_SETTINGS,
    });

    // Next steps (not yet implemented): construct a ViewerRegistry and
    // register PdfViewerProvider / EpubViewerProvider with it here.
  }
}
