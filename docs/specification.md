# Maki — Specification

> Status: draft. This document describes **what** Maki does and the contracts it
> exposes to users and their notes. For **how** it is built, see [design.md](./design.md).

## 1. Purpose

Maki turns Obsidian into a place to **read and annotate** PDF and EPUB documents
without leaving the vault.

The central loop:

1. Open a document (PDF or EPUB) in a preview pane.
2. Select a passage and highlight it.
3. Maki produces a markdown snippet containing a **link to that exact passage** and
   inserts it into a note, where you write your commentary.
4. The link in the note is the **source of truth**: whenever the document is open,
   Maki re-draws every linked passage as a colored highlight.
5. Clicking the link scrolls the document to the passage and flashes it; clicking a
   highlight in the document opens the note that references it.

This is the [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus)
workflow, generalized so that PDF and EPUB behave the same way.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **Document** | A PDF or EPUB file stored in the vault. |
| **Preview** | Maki's rendered, on-screen view of a document. |
| **Backend** | The technology that renders a document and resolves positions in it: the *PDF backend* (Obsidian's native PDF.js viewer) or the *EPUB backend* (foliate-js). |
| **Selection** | A user's text selection inside the preview. |
| **Locator** | A serializable address of a point or range *within* a document (e.g. a PDF page + text range, or an EPUB CFI). Stable across re-rendering. |
| **Highlight** | A colored mark drawn over a locator's range in the preview. |
| **Annotation** | A markdown entry that links to a locator and optionally carries a comment. The annotation link is the source of truth for one highlight. |
| **Backlink** | Any link in a note that targets a document locator. Maki indexes these to know which highlights to draw. |
| **Source note** | The note that contains a given annotation/backlink. |

> A **highlight** is what you see in the document; an **annotation** is the markdown
> that causes it. One annotation ⇔ one highlight.

## 3. Goals and non-goals

### Goals

- One read-and-annotate workflow that is **identical for PDF and EPUB** from the
  user's point of view.
- **Markdown notes are the canonical store** of annotations: plain, greppable,
  diff-able text that survives even if the plugin is uninstalled.
- **Precise, durable locators** that keep pointing at the right passage after the
  document is re-rendered, re-paginated, resized, or re-themed.
- PDF **reuses Obsidian's built-in viewer**; EPUB is rendered with **foliate-js**.
- Maximize shared behavior; isolate format-specific code.
- Keep the codebase **testable** (see [design.md](./design.md) §"Humble object pattern").

### Non-goals (initial release)

- Editing document **content** (text, layout, pages).
- Writing highlights **into the EPUB file** — there is no portable standard for it.
  (Writing real annotations into a **PDF** file is an *optional, secondary* mode; see
  §6.5.)
- Cloud sync, OCR, document conversion, or library management.
- Formats beyond PDF and EPUB. (foliate-js also reads MOBI/AZW3/FB2/CBZ; these are
  possible **future** backends but out of scope now.)

## 4. Supported formats

| Format | Backend | Rendering | Status |
| --- | --- | --- | --- |
| PDF | PDF (Obsidian native, PDF.js) | Obsidian's built-in viewer, patched in place | Primary |
| EPUB (reflowable) | EPUB (foliate-js) | foliate-js paginator in a plugin-owned view | Primary |
| EPUB (fixed-layout) | EPUB (foliate-js) | foliate-js fixed-layout renderer | Supported |
| MOBI / AZW3 / FB2 / CBZ | — | (foliate-js capable) | Future |

## 5. Functional requirements

### FR-1 — Preview documents

- **FR-1.1** Open a PDF in the preview using Obsidian's native PDF viewer.
- **FR-1.2** Open an EPUB in the preview, with reflowable pagination (configurable
  column count, margins, font) and fixed-layout support.
- **FR-1.3** Open documents from the file explorer, from links, and as embeds where
  the backend allows it.
- **FR-1.4** Remember and restore the last reading position per document (PDF: page +
  scroll; EPUB: location/CFI). This is a *reading* position, not an annotation.
- **FR-1.5** Apply Obsidian's theme (light/dark) to the EPUB preview.
- **FR-1.6** Provide EPUB reading navigation, styled after Obsidian's built-in PDF
  toolbar: a table-of-contents button, previous/next page, a "page" number display
  and input (pages are foliate's synthetic fixed-size locations), a
  paginated/scrolled layout toggle, and a reading-progress indicator. (PDF needs
  none of this — Obsidian's built-in viewer already has thumbnails, outline, and
  search.)

### FR-2 — Select text

- **FR-2.1** Let the user select text in the preview using normal selection gestures.
- **FR-2.2** Convert any selection into a **locator** (§6) plus its plain text.

### FR-3 — Create highlights

- **FR-3.1** Turn the current selection into a highlight in one action.
- **FR-3.2** Let the user pick a **color** from a configurable palette at creation
  time.
- **FR-3.3** Support highlighting a **rectangular region** of a PDF page (image/area
  capture). *(PDF only; EPUB has no page geometry.)*

### FR-4 — Annotate (write back to markdown)

- **FR-4.1** Generate a markdown snippet for the current selection that embeds a link
  to its locator (§6). Each annotate action has exactly one destination, named by the
  command's verb: **copy** to the clipboard, or **insert** into a target note.
- **FR-4.2** **Insert** places the snippet into the target note without leaving
  the preview (the target is the last-edited / last-active note, configurable).
- **FR-4.3** Format the inserted snippet with a user-configurable **template** that
  can include the link, the quoted text, the color, page/chapter labels, and a
  comment placeholder (§6.6).
- **FR-4.4** Optionally include the selected text as a quote in the snippet.

### FR-5 — Markdown as the source of truth

- **FR-5.1** Index every backlink (in any note) that targets an open document.
- **FR-5.2** Render each indexed backlink as a highlight at its locator, in its color.
- **FR-5.3** Keep highlights in sync **live**: editing, recoloring, or deleting the
  link in markdown adds, changes, or removes the corresponding highlight without a
  reload.
- **FR-5.4** No data is written to the document file in this mode — highlights are
  purely a rendering of the notes.
- **FR-5.5** A backlink whose locator cannot be decoded or resolved is **skipped
  without affecting other highlights**, and skipped entries are surfaced to the user
  (e.g. a count in the preview toolbar) — never silently dropped, never an error that
  blocks rendering.
- **FR-5.6** When multiple annotations target the same locator, they are drawn as
  **one** highlight with merged sources (all of them reachable per FR-6.3). If their
  colors differ, the color of the first entry in note-path order wins — a
  deterministic rule, so rendering never flickers between reloads.

### FR-6 — Navigate both directions

- **FR-6.1** Clicking a backlink (in a note, hover preview, or backlink pane) opens
  the document, scrolls to the locator, and briefly flashes the passage.
- **FR-6.2** Clicking a highlight in the preview reveals / opens its source note(s).
- **FR-6.3** When several annotations target the same passage, surface all of them.
- **FR-6.4** If a locator no longer resolves exactly (the document changed since the
  annotation was made), degrade gracefully: navigate to the nearest coarse position
  (PDF: the page; EPUB: the chapter/section) and tell the user the exact passage could
  not be found. Never fail silently, and never let one broken link block others.

### FR-7 — Manage highlights

- **FR-7.1** Recoloring or removing a highlight is done by editing or deleting its
  annotation link in markdown (consistent with FR-5).
- **FR-7.2** Hovering a highlight shows its source note(s) and comment via Obsidian's
  hover preview.
- **FR-7.3** *(convenience)* Right-clicking a highlight in the preview offers *Show
  source note*, *Copy link*, and *Delete annotation*. Delete works by **editing the
  source note** (removing the link) — a shortcut to FR-7.1, not a second store, so
  markdown remains the source of truth.

### FR-8 — Configuration

- **FR-8.1** A configurable color palette (names → colors).
- **FR-8.2** Configurable snippet and link-display templates (§6.6).
- **FR-8.3** Target-selection strategy for insert, plus an
  **annotate-on-selection mode** (`onSelect`: *off* / *copy* / *insert*): when not
  off, a text selection that is confirmed in the preview — pointer released, then
  briefly stable — acts as the corresponding annotate command (with the toolbar
  color), no command needed. A selection still being dragged never fires. There are no
  per-effect toggles — the destination of a command is fixed by its verb (FR-4.1).
- **FR-8.4** EPUB rendering preferences (columns, margins, font size, line height,
  theme follow).

### FR-9 — Commands and UI

- **FR-9.1** Commands: *Copy link to selection* and *Insert link into note*
  (each also as a *(pick color)* and a *with comment* variant), *Start rectangular
  selection* (PDF), and *Cycle what selecting text does* (FR-8.3's `onSelect`
  mode). Command names state the destination; nothing is toggled implicitly.
- **FR-9.2** A color picker in the preview toolbar (PDF and EPUB alike). The picked
  color is remembered (persisted in settings) and used by every subsequent
  copy/insert annotation action until picked again.
- **FR-9.3** A right-click context menu in the preview offering the same actions.
- **FR-9.4** Every action whose effect is not visible in place (copy to clipboard,
  insert into a note in another pane, mode changes) confirms itself with an
  Obsidian notice (e.g. "Link copied") — the user should never wonder whether the
  action fired.

### FR-10 — Optional: embed annotations into the file *(secondary)*

- **FR-10.1** *(PDF only, opt-in)* Write the highlight into the PDF file as a real PDF
  text-markup annotation, so it is visible in other PDF readers. Even then, a markdown
  backlink is still created (FR-4).
- **FR-10.2** *(EPUB)* Not supported — there is no portable in-file annotation format.

## 6. The locator and link format (data contract)

Annotation links are **persisted in users' notes**, so their format is a stable
contract — changing it risks breaking existing notes. This section defines it
normatively. (The encoder/decoder is described in [design.md](./design.md); here we
specify the on-disk shape.)

### 6.1 Link shape

An annotation link is an ordinary Obsidian link to the document file with a **subpath**
fragment that encodes the locator and presentation:

```
[[<document path>#<key>=<value>&<key>=<value>...|<display text>]]
```

The subpath is the part after `#`: `&`-separated `key=value` pairs. Maki reuses
Obsidian's native PDF subpath conventions so that PDF links are interoperable with
Obsidian itself and with obsidian-pdf-plus. EPUB adds one new key (`epubcfi`).

### 6.2 Common keys

| Key | Value | Applies to | Meaning |
| --- | --- | --- | --- |
| `color` | a palette name (`yellow`) **or** `r,g,b` (three 0–255 ints) | both | Highlight color. |

### 6.3 PDF keys

| Key | Value | Meaning |
| --- | --- | --- |
| `page` | integer, 1-based | Page number. Required for any PDF location. |
| `selection` | `beginIndex,beginOffset,endIndex,endOffset` (4 ints) | A text range within the page, addressed by the **index of the text item** in the page's text layer and a **character offset** within it. This is Obsidian's own selection format. |
| `rect` | `left,bottom,right,top` (4 numbers, PDF coordinates) | A rectangular region (used for area/image highlights and region navigation). |
| `annotation` | annotation id (e.g. `123R`) | An existing PDF annotation object (used when annotations are embedded in the file, FR-10). |
| `offset` | `left,top,zoom` (numbers; any may be empty) | A scroll destination. |

PDF examples:

```
[[paper.pdf#page=3&selection=4,0,5,20&color=yellow|paper, p.3]]
[[paper.pdf#page=3&selection=4,0,5,20]]
[[paper.pdf#page=7&rect=72,500,520,560&color=0,200,120]]
```

### 6.4 EPUB keys

EPUB has no pages or page geometry. Positions are addressed with an **EPUB CFI**
(Canonical Fragment Identifier) — a standard, stable, range-capable address into the
book's content (e.g. `/6/14[chap05]!/4/2/2,/1:0,/1:280`).

| Key | Value | Meaning |
| --- | --- | --- |
| `epubcfi` | a CFI **body** (the text inside `epubcfi( … )`), percent-encoded | The point or range. A range CFI addresses both ends of the selection in one value. |

Because a raw CFI contains characters that conflict with link and subpath parsing
(`[ ] , : ! |` and the `( )` of the wrapper), the CFI is stored **without the
`epubcfi( )` wrapper** and **percent-encoded**. The reserved set is at least
`% [ ] , & = # | ( ) :`. The decoder reverses this and re-wraps the value before
handing it to the backend.

EPUB example (logical CFI `/6/14[chap05]!/4/2/2,/1:0,/1:280`, color `yellow`):

```
[[book.epub#epubcfi=/6/14%5Bchap05%5D!/4/2/2%2C/1%3A0%2C/1%3A280&color=yellow|book, ch.5]]
```

> Rationale for CFI: it is the W3C/IDPF standard for addressing EPUB content, it
> expresses ranges directly, it is resilient to re-pagination and font changes, and
> foliate-js can both generate it from a selection and resolve it back to a live range
> for highlighting and navigation.

### 6.5 Source of truth and resilience

- In the default mode, the **link in the note is the only record** of a highlight; the
  document file is never modified. If Maki is uninstalled, the links remain as plain,
  meaningful text and the annotations are not lost.
- In the optional PDF embed mode (FR-10), the highlight is *additionally* written into
  the PDF file; a backlink is still created so the note remains the index.

### 6.6 Templates

Two user-configurable templates control generated text:

- **Snippet template** — the whole block inserted into the note. Default:

  ```
  > [!quote] {{linkWithDisplay}}
  > {{text}}
  ```

- **Display-text template** — the link's alias (the text after `|`). Defaults differ
  per backend: e.g. `{{file.basename}}, p.{{page}}` (PDF) and
  `{{file.basename}}, {{chapter}}` (EPUB).

Available variables (subject to the backend providing them): `link`, `linkWithDisplay`,
`display`, `text` (selected text), `comment`, `color`, `colorName`, `file`, and
backend-specific labels — `page`, `pageLabel`, `pageCount` (PDF); `chapter`,
`progress` (EPUB).

## 7. User workflows

### 7.1 Annotate a passage

1. Open the document; select a passage.
2. Click a palette color (or run *Copy link to selection* / *Insert link into
   note*).
3. Maki builds the locator, fills the snippet template, and delivers it to the
   command's destination — the clipboard, or the target note.
4. The user writes a comment beside the quoted text. The highlight appears in the
   preview immediately (FR-5.3).

### 7.2 Review while reading

- Opening a document draws every existing annotation as a colored highlight (FR-5.2).
- Hovering a highlight previews its note and comment (FR-7.2).

### 7.3 Jump from a note to the passage

- Clicking the annotation link opens the document at the passage and flashes it
  (FR-6.1).

### 7.4 Jump from the passage to the note

- Clicking a highlight opens its source note (FR-6.2).

## 8. Constraints and assumptions

- **EPUB rendering is plugin-owned.** Obsidian has no native EPUB viewer, so Maki
  hosts foliate-js. foliate-js renders each EPUB section in a sandboxed `<iframe>`.
- **Untrusted content / security.** EPUBs are arbitrary HTML/CSS/JS. Maki MUST render
  them under a strict Content Security Policy that blocks scripts; book scripts are not
  executed. (See [design.md](./design.md) §"EPUB backend".)
- **PDF depends on Obsidian internals.** The PDF backend patches Obsidian's private,
  undocumented PDF viewer classes; it can break across Obsidian updates and must
  degrade gracefully and version-guard.
- **Locator stability.** PDF text-item indices can drift if the PDF.js text
  segmentation changes; EPUB CFIs can drift if the book file itself changes. The
  selected text may be stored alongside the locator to help re-anchor (see design).
- **foliate-js is not API-stable** and ships no npm release; it is consumed from a
  patched fork pinned as a git submodule (see [design.md](./design.md) §"EPUB backend").
- **Platform.** Desktop is the primary target for the initial release. Obsidian Mobile
  is best-effort: the PDF view patches and iframe/CSP behavior differ in mobile
  WebViews and are unverified there. Features must detect an unsupported environment
  and disable themselves gracefully rather than break.

## 9. Out of scope / future

- Additional foliate formats (MOBI/AZW3/FB2/CBZ).
- Two-way edit of embedded PDF annotations created by other tools.
- Full-text search inside the EPUB preview (PDF search comes free with Obsidian's
  viewer).
- A dedicated annotations side panel (beyond Obsidian's backlink pane).
- Migration to a **native Obsidian EPUB viewer** when one ships — planned for and made
  cheap by the design (see [design.md](./design.md) §"Migration plan"), but not a
  user-facing feature.
