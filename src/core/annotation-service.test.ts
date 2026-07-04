import { beforeEach, describe, expect, it } from "vitest";
import {
  AnnotationService,
  DEFAULT_ANNOTATION_SETTINGS,
  type AnnotationSettings,
  type NoteWriter,
} from "./annotation-service";
import { ColorModel } from "./color-model";
import { FakeDocumentViewer } from "../../test/fake-document-viewer";
import type { Codecs } from "./locator/codec";
import { EpubLocatorCodec } from "./locator/epub-codec";
import { PdfLocatorCodec } from "./locator/pdf-codec";
import { TemplateEngine } from "./template-engine";
import type { Color } from "./types";

const codecs: Codecs = { pdf: PdfLocatorCodec, epub: EpubLocatorCodec };
const colors = new ColorModel({ yellow: [255, 208, 0] });
const yellow: Color = { name: "yellow", rgb: [255, 208, 0] };

class FakeNoteWriter implements NoteWriter {
  copied: string[] = [];
  inserted: string[] = [];

  insertIntoActiveNote(text: string): Promise<void> {
    this.inserted.push(text);
    return Promise.resolve();
  }

  copyToClipboard(text: string): Promise<void> {
    this.copied.push(text);
    return Promise.resolve();
  }
}

describe("AnnotationService", () => {
  let notes: FakeNoteWriter;
  let settings: AnnotationSettings;
  let service: AnnotationService;

  beforeEach(() => {
    notes = new FakeNoteWriter();
    settings = structuredClone(DEFAULT_ANNOTATION_SETTINGS);
    service = new AnnotationService({
      codecs,
      templates: new TemplateEngine(),
      colors,
      notes,
      settings: () => settings,
    });
  });

  function pdfViewer(): FakeDocumentViewer {
    const viewer = new FakeDocumentViewer({ path: "papers/paper.pdf", backend: "pdf" });
    viewer.selection = {
      locator: { backend: "pdf", page: 3, target: { kind: "text", begin: [4, 0], end: [5, 20] } },
      text: "quoted passage",
    };
    viewer.meta = { pageCount: 10 };
    return viewer;
  }

  function epubViewer(): FakeDocumentViewer {
    const viewer = new FakeDocumentViewer({ path: "books/book.epub", backend: "epub" });
    viewer.selection = {
      locator: { backend: "epub", cfi: "/6/14[chap05]!/4/2/2,/1:0,/1:280" },
      text: "quoted passage",
    };
    viewer.meta = { chapter: "ch.5", progress: 0.42 };
    return viewer;
  }

  it("returns null when nothing is selected", async () => {
    const viewer = new FakeDocumentViewer({ path: "papers/paper.pdf", backend: "pdf" });
    expect(await service.annotate(viewer, yellow, "clipboard")).toBeNull();
    expect(notes.copied).toEqual([]);
  });

  it("builds the spec §6.3-shaped link and default snippet for a PDF selection", async () => {
    const result = await service.annotate(pdfViewer(), yellow, "clipboard");
    expect(result!.link).toBe(
      "[[papers/paper.pdf#page=3&selection=4,0,5,20&color=yellow|paper, p.3]]",
    );
    expect(result!.snippet).toBe(
      "> [!quote] [[papers/paper.pdf#page=3&selection=4,0,5,20&color=yellow|paper, p.3]]\n" +
        "> quoted passage",
    );
  });

  it("builds the spec §6.4-shaped link for an EPUB selection", async () => {
    const result = await service.annotate(epubViewer(), yellow, "clipboard");
    expect(result!.link).toBe(
      "[[books/book.epub#epubcfi=/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280&color=yellow|book, ch.5]]",
    );
  });

  it("serializes a paletteless color as r,g,b", async () => {
    const result = await service.annotate(pdfViewer(), { rgb: [0, 200, 120] }, "clipboard");
    expect(result!.link).toContain("&color=0,200,120|");
  });

  it("copies to the clipboard when the destination is the clipboard", async () => {
    const result = await service.annotate(pdfViewer(), yellow, "clipboard");
    expect(notes.copied).toEqual([result!.snippet]);
    expect(notes.inserted).toEqual([]);
  });

  it("inserts into the active note when the destination is the note (FR-4.2)", async () => {
    const result = await service.annotate(pdfViewer(), yellow, "note");
    expect(notes.copied).toEqual([]);
    expect(notes.inserted).toEqual([result!.snippet]);
  });

  it("exposes comment and metadata variables to the snippet template (FR-4.3)", async () => {
    settings.snippetTemplate =
      "{{display}} / {{comment}} / {{colorName}} / {{pageCount}} / {{file.basename}}";
    const result = await service.annotate(pdfViewer(), yellow, "clipboard", "my thought");
    expect(result!.snippet).toBe("paper, p.3 / my thought / yellow / 10 / paper");
  });

  it("prefers page labels over page numbers when the document has them", async () => {
    settings.displayTemplates.pdf = "{{file.basename}}, p.{{pageLabel}}";
    const viewer = pdfViewer();
    viewer.meta = { pageCount: 10, pageLabels: ["i", "ii", "iii", "iv"] };
    const result = await service.annotate(viewer, yellow, "clipboard");
    expect(result!.link).toContain("|paper, p.iii]]");
  });

  it("exposes EPUB chapter and progress variables", async () => {
    settings.snippetTemplate = "{{chapter}} @ {{progress}}";
    const result = await service.annotate(epubViewer(), yellow, "clipboard");
    expect(result!.snippet).toBe("ch.5 @ 0.42");
  });
});
