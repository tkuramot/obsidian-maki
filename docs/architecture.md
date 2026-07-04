# Maki architecture

This document is the architectural source of truth for Maki. It describes the
design — the layering, the vocabulary, and the invariants — as opposed to the
day-to-day development workflow, which lives in [CLAUDE.md](../CLAUDE.md).

## What Maki is

Maki is an Obsidian plugin for reading PDF and EPUB documents inside Obsidian and
annotating them from notes. You highlight a passage in the document preview; Maki
writes a link to that exact passage into a markdown note. The note is the source
of truth — every such link is rendered back as a colored highlight over the
document, and clicking either side jumps to the other. It generalizes the
[obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) workflow from
PDF to EPUB.

## Core vocabulary

The terms below recur throughout the code and the rest of this document:

- Document — an open PDF or EPUB the user is reading.
- Backend — the machinery that renders one document kind (PDF via Obsidian's
  PDF.js; EPUB via foliate-js). Identified by a `BackendId`.
- Locator — a backend-specific, persisted pointer to an exact passage in a
  document (a PDF page+rect/selection, or an EPUB CFI). Encoded into/decoded from
  note links by a `LocatorCodec`.
- Highlight — the colored overlay drawn over a document passage. Always a
  *projection* of a link found in a note, never stored geometry.
- Annotation — the act/record of linking a note passage to a document passage.
- Backlink — the reverse index from a document to the notes that link into it,
  used to know which highlights to draw.

The architecture cannot be understood from any single file — read this whole
document before non-trivial work.

## Architecture (the parts that span files)

Maki is ports and adapters (hexagonal) around a pure core, with one hard rule:
dependencies point inward. Three layers:

- Core (`src/core/`) — pure, framework-free, unit-tested. Holds *all real
  logic*, as a flat set of files (only `locator/` starts as a directory). Never
  imports `obsidian`, `pdfjs`, foliate-js, or touches the DOM. Key pieces:
  `AnnotationService` (create an annotation), `HighlightReconciler` (render notes as
  highlights — identical for both backends), `PdfLocatorCodec`/`EpubLocatorCodec`,
  `TemplateEngine`, `ColorModel`, `PdfGeometry` (pure rect math), `ViewerRegistry`,
  `SelectionAutoAnnotator`, the note-insertion rules (`note-insertion.ts`).
  Shared vocabulary that no single module owns (`Locator`, `Highlight`, `Color`,
  `DocumentRef`, …) lives in `src/core/types.ts` — limited to that shared
  vocabulary, not a catch-all; module-owned types co-locate with their owner. Files
  are placed by *owner*, not by "it's a type / a port".
- Ports (`src/core/document-viewer.ts`, `src/core/viewer-provider.ts`) —
  only two interface-only seams, one file each. These are the
  genuinely-polymorphic boundaries (PDF / EPUB). There is no
  `src/ports/` directory and no pooled `ports.ts` — placement is by *owner*, not by
  "it's a port".
- Injected concretes, *not* ports — `LocatorCodec` is a structural dispatch
  type (`Record<BackendId, …>`), not an interface; `ObsidianBacklinkIndex` and
  `ObsidianNoteWriter` are concrete classes injected into the core. They have
  exactly one implementation forever, so they earn no port. The core stays testable
  because it is *injected* (structural fakes), not because these are interfaces.
- Adapters / integration (`src/backends/`, `src/obsidian/`) — *humble*:
  thin, logic-free bindings to Obsidian, PDF.js, foliate-js, the DOM, the
  filesystem.

The single most important abstraction is `DocumentViewer`: one open document =
one `DocumentViewer`, and it is all the core needs to drive *any* backend. It
deliberately exposes no pages, iframes, CFIs, or DOM nodes — those leak only into
adapters.

Two backends, one workflow:

- PDF reuses Obsidian's built-in PDF.js viewer by *monkey-patching* its
  private, undocumented view classes in place (same strategy as obsidian-pdf-plus).
  This is inherently fragile across Obsidian versions — patches must version-guard
  and degrade gracefully.
- EPUB is rendered by foliate-js in a plugin-owned `ItemView` (`maki-epub`),
  because Obsidian has no native EPUB viewer. foliate-js (no npm release, not
  API-stable) is consumed from a patched fork pinned as a git submodule
  (`vendor/foliate-js/`, fork branch `maki`). It is not dependency-free: EPUB
  reading requires `@zip.js/zip.js` (regular npm dependency).

## Non-negotiable invariants

These are easy to violate and expensive to get wrong:

- The link/locator format is a persisted contract. Users' notes store these
  links, so changing the on-disk shape risks breaking existing notes. PDF subpaths
  reuse Obsidian's native conventions (`page`, `selection`, `rect`, …) for
  interoperability; EPUB uses one `epubcfi` key holding a percent-encoded,
  unwrapped CFI body. Codecs must round-trip (`decode(encode(x)) === x`) and
  match the spec's golden examples.
- Markdown is the source of truth. Highlights are a *projection* of links found
  in notes; geometry is derived on demand, never stored. The document file is
  never modified.
- Logic goes in the pure core, never in adapters. If a piece contains a
  decision, it belongs in `core/` and must be unit-tested with injected structural
  fakes — no framework mocks. If a piece touches a framework, it belongs in an
  adapter and must be trivial (no logic). When a concern's placement is ambiguous,
  decide by this rule: decisions in `core/`, framework contact in adapters.
- EPUB security: EPUB sections are arbitrary HTML/JS rendered in iframes and
  MUST be served under a strict CSP that blocks scripts. The section iframes are
  same-origin with Obsidian's node-integrated renderer, so a running book script
  means RCE. The fork's renderers take the sandbox from a `sandbox` attribute, and
  `MakiEpubView` must set `sandbox="allow-same-origin"` on `<foliate-view>`
  before `open()` — the upstream default keeps `allow-scripts`.
  `epub-security.ts` layers resource vetoes and per-section CSP metas on top.
  Never inject DOM into foliate section bodies (it breaks CFI round-tripping) —
  draw highlights only in foliate's separate SVG overlayer.

## Dependency policy

The dependency policy is deliberately minimalist — several things are
*intentionally absent*: no template engine, no CFI parser, no UI framework, no
bundled PDF.js (the built-in one is reused). Runtime dependencies are intentionally
minimal: `monkey-around` + `@zip.js/zip.js` + the foliate-js submodule.

## foliate-js submodule wiring

The submodule `vendor/foliate-js/` tracks the fork's `maki` branch
([tkuramot/foliate-js](https://github.com/tkuramot/foliate-js): upstream + two
`[maki]` patches — attribute-configurable iframe sandbox, `makeBook` split out of
`view.js`). Source imports use the `foliate-js/*` specifier: esbuild `alias`
resolves it to the submodule, tsconfig `paths` resolves it to the hand-written
declarations in `src/types/foliate-js/` (check those for drift on every bump — a
mismatch type-checks fine and fails at runtime). Update flow: rebase the fork's
`maki` onto upstream → tag → bump the submodule pin → `pnpm test && pnpm build` →
open an EPUB manually.
