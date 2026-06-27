# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Maki** is an Obsidian plugin for reading PDF and EPUB documents inside Obsidian and
annotating them from notes. You highlight a passage in the document preview; Maki writes
a link to that exact passage into a markdown note. The **note is the source of truth** —
every such link is rendered back as a colored highlight over the document, and clicking
either side jumps to the other. It generalizes the
[obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) workflow from PDF
to EPUB.

## Project status

**Pre-implementation.** The repository currently contains only design documents
(`docs/`), a Nix dev shell (`flake.nix`), and license/readme files. There is **no
source tree, no `package.json`, no `manifest.json`, and no build/test tooling yet** —
these are described in the docs as the intended setup but do not exist on disk. When
implementing, you are creating this structure for the first time; follow the
design docs as the spec.

## Read the docs first

The architecture cannot be understood from any single file. Before non-trivial work,
read in this order:

1. **`docs/specification.md`** — *what* Maki does. Defines the terminology (document,
   backend, locator, highlight, annotation, backlink) that everything else relies on,
   the functional requirements (FR-1…FR-10), and — most importantly — **the link/locator
   format (§6), which is a persisted data contract**.
2. **`docs/design.md`** — *how* it is built: the ports-and-adapters architecture, the
   pure core, the PDF/EPUB backends, the humble-object testability split, and the
   proposed module layout (§13).

## Architecture (the parts that span files)

Maki is **ports and adapters (hexagonal) around a pure core**, with one hard rule:
**dependencies point inward**. Three layers:

- **Core** (`src/core/`, planned) — pure, framework-free, unit-tested. Holds *all real
  logic*. Never imports `obsidian`, `pdfjs`, foliate-js, or touches the DOM. Key pieces:
  `AnnotationService` (create an annotation), `HighlightReconciler` (render notes as
  highlights — identical for both backends), `PdfLocatorCodec`/`EpubLocatorCodec`,
  `TemplateEngine`, `ColorModel`, `PdfGeometry` (pure rect math), `ViewerRegistry`.
- **Ports** (`src/ports/`, planned) — interface-only seams: `DocumentViewer`,
  `ViewerProvider`, `LocatorCodec`, `BacklinkIndex`, `NoteWriter`. The core is written
  entirely against these.
- **Adapters / integration** (`src/backends/`, `src/obsidian/`, planned) — *humble*:
  thin, logic-free bindings to Obsidian, PDF.js, foliate-js, the DOM, the filesystem.

The single most important abstraction is **`DocumentViewer`**: one open document = one
`DocumentViewer`, and it is all the core needs to drive *any* backend. It deliberately
exposes no pages, iframes, CFIs, or DOM nodes — those leak only into adapters.

**Two backends, one workflow:**
- **PDF** reuses Obsidian's built-in PDF.js viewer by *monkey-patching* its private,
  undocumented view classes in place (same strategy as obsidian-pdf-plus). This is
  inherently fragile across Obsidian versions — patches must version-guard and degrade
  gracefully.
- **EPUB** is rendered by **foliate-js** in a plugin-owned `ItemView` (`maki-epub`),
  because Obsidian has no native EPUB viewer. foliate-js is **vendored at a pinned
  revision** (no npm release, not API-stable) under `src/vendor/foliate-js/`.

A future native-Obsidian-EPUB backend is planned to slot in behind the same ports
without touching the core (design §7, §12).

## Non-negotiable invariants

These are easy to violate and expensive to get wrong:

- **The link/locator format is a persisted contract** (spec §6). Users' notes store
  these links, so changing the on-disk shape risks breaking existing notes. PDF subpaths
  reuse Obsidian's native conventions (`page`, `selection`, `rect`, …) for
  interoperability; EPUB uses one `epubcfi` key holding a **percent-encoded, unwrapped**
  CFI body. Codecs must round-trip (`decode(encode(x)) === x`) and match the spec's
  golden examples.
- **Markdown is the source of truth.** Highlights are a *projection* of links found in
  notes; geometry is derived on demand, never stored. In default mode the document file
  is **never modified**. (Embedding annotations into a PDF file is an opt-in secondary
  mode, FR-10, isolated behind `PdfFileIO`.)
- **Logic goes in the pure core, never in adapters.** If a piece contains a decision, it
  belongs in `core/` and must be unit-tested with fake ports — no framework mocks. If a
  piece touches a framework, it belongs in an adapter and must be trivial (no logic).
  The "testability map" in design §10 is the authority on which side each concern lives.
- **EPUB security:** EPUB sections are arbitrary HTML/JS rendered in iframes and MUST be
  served under a strict CSP that blocks scripts. Never inject DOM into foliate section
  bodies (it breaks CFI round-tripping) — draw highlights only in foliate's separate SVG
  overlayer.

## Intended toolchain (per the docs — not yet set up)

The design specifies **Node 22 + pnpm + TypeScript + esbuild**, with a fast unit runner
(e.g. Vitest) over `core/`. The Nix dev shell (`flake.nix`) already provides `nodejs_22`
and `pnpm`; enter it via `direnv` (an `.envrc` is present) or `nix develop`. When you
add tooling, prefer these choices to stay consistent with the design, and update this
section with the actual `pnpm` scripts once they exist. The core has no DOM/Obsidian
imports, so its tests run without a browser environment.
