/**
 * `AnnotationService` — create an annotation from the current selection.
 *
 * The only non-pure things it touches are `viewer.captureSelection()` (a
 * port) and the injected note writer — in tests both are structural fakes.
 * Locator, link, and snippet construction (the actual logic) is pure.
 */

import { ColorModel } from "./color-model";
import type { DocumentViewer } from "./document-viewer";
import type { Codecs } from "./locator/codec";
import { buildLink } from "./locator/link";
import { TemplateEngine, type TemplateVariables } from "./template-engine";
import type {
  BackendId,
  Color,
  TargetStrategy,
  TextSelection,
} from "./types";

/**
 * The shape of `ObsidianNoteWriter` (a concrete class in the integration
 * layer) that this service depends on. Declared here as a structural type —
 * injection, not a port.
 */
export interface NoteWriter {
  insertIntoTarget(text: string, target: TargetStrategy): Promise<void>;
  copyToClipboard(text: string): Promise<void>;
}

/**
 * Where the snippet goes. The verb of the invoking command *is* the
 * destination ("Copy …" / "Insert …"), so this is a required argument,
 * not a settings-controlled side effect.
 */
export type AnnotationDestination = "clipboard" | "note";

export interface AnnotationSettings {
  /** Template of the whole block inserted into the note. */
  snippetTemplate: string;
  /** Template of the link alias (the text after `|`), per backend. */
  displayTemplates: Record<BackendId, string>;
  /** Where `"note"`-destined snippets are inserted. */
  target: TargetStrategy;
}

export const DEFAULT_ANNOTATION_SETTINGS: AnnotationSettings = {
  snippetTemplate: "> [!quote] {{linkWithDisplay}}\n> {{text}}",
  displayTemplates: {
    pdf: "{{file.basename}}, p.{{page}}",
    epub: "{{file.basename}}, {{chapter}}",
  },
  target: { kind: "active-note" },
};

export interface AnnotateResult {
  /** The full annotation link, including the display alias. */
  link: string;
  /** The expanded snippet that was copied / inserted. */
  snippet: string;
}

function basenameOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Assemble the snippet template variables from selection + metadata. */
function buildVariables(
  viewer: DocumentViewer,
  sel: TextSelection,
  color: Color,
  colors: ColorModel,
  comment: string | undefined,
): TemplateVariables {
  const meta = viewer.metadata();
  const vars: TemplateVariables = {
    text: sel.text,
    comment: comment ?? "",
    color: colors.serialize(color),
    colorName: color.name ?? "",
    file: {
      path: viewer.ref.path,
      basename: basenameOf(viewer.ref.path),
    },
  };
  if (sel.locator.backend === "pdf") {
    vars["page"] = sel.locator.page;
    vars["pageLabel"] = meta.pageLabels?.[sel.locator.page - 1] ?? sel.locator.page;
    vars["pageCount"] = meta.pageCount;
  } else {
    vars["chapter"] = meta.chapter;
    vars["progress"] = meta.progress;
  }
  return vars;
}

export class AnnotationService {
  constructor(
    private readonly deps: {
      codecs: Codecs;
      templates: TemplateEngine;
      colors: ColorModel;
      notes: NoteWriter;
      /** Settings are read per call so runtime changes apply immediately. */
      settings: () => AnnotationSettings;
    },
  ) {}

  /**
   * Turn the viewer's current selection into an annotation snippet and
   * deliver it to `destination`. Returns null when nothing is selected.
   */
  async annotate(
    viewer: DocumentViewer,
    color: Color,
    destination: AnnotationDestination,
    comment?: string,
  ): Promise<AnnotateResult | null> {
    const sel = viewer.captureSelection();
    if (!sel) return null;

    const { codecs, templates, colors, notes, settings } = this.deps;
    const s = settings();

    const params = {
      ...codecs[sel.locator.backend].encode(sel.locator),
      color: colors.serialize(color),
    };
    const vars = buildVariables(viewer, sel, color, colors, comment);
    const display = templates.expand(s.displayTemplates[sel.locator.backend], vars);
    const link = buildLink(viewer.ref, params);
    const linkWithDisplay = buildLink(viewer.ref, params, display);
    const snippet = templates.expand(s.snippetTemplate, {
      ...vars,
      link,
      linkWithDisplay,
      display,
    });

    if (destination === "clipboard") await notes.copyToClipboard(snippet);
    else await notes.insertIntoTarget(snippet, s.target);

    return { link: linkWithDisplay, snippet };
  }
}
