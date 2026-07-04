# Maki

Read and annotate PDF and EPUB documents inside [Obsidian](https://obsidian.md),
with your markdown notes as the source of truth.

Maki is heavily inspired by
[obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus): it takes the
same "annotate a PDF from your notes" workflow and generalizes it so the exact same
workflow also works for EPUB books.

## The idea

1. Open a PDF or EPUB in Obsidian and select a passage.
2. Maki writes a link to that exact passage into your markdown note (or clipboard):

   ```markdown
   > [!quote] [[book.epub#epubcfi=...|book, Chapter 3]]
   > The selected passage, quoted into your note.
   ```

3. Every such link found in your notes is rendered back as a colored highlight
   over the document. Click the highlight to jump to the note; click the link to
   jump to the passage.

The document file is never modified. Highlights are a projection of the links in
your notes — delete the link and the highlight disappears. No hidden database, no
sidecar files: your annotations live in plain markdown and survive anything that
plain markdown survives.

## Features

- PDF annotation — reuses Obsidian's built-in PDF viewer. Links use Obsidian's
  native subpath conventions (`#page=…&selection=…`), so they stay interoperable
  with core Obsidian and pdf-plus.
- EPUB reading & annotation — a full EPUB reader (powered by
  [foliate-js](https://github.com/johnfactotum/foliate-js)) with paginated or
  scrolled flow, font-size control, light/dark theme following, and per-book
  reading-position memory. Links pin passages by EPUB CFI, so they survive
  re-rendering and layout changes. Book content is untrusted HTML, so sections
  render in script-blocked, sandboxed iframes with a strict CSP.
- Color palette — define your own named highlight colors; pick the active color
  from a toolbar picker in the viewer. Colors are stored by *name* in the link, so
  you can re-tint a whole vault by editing one palette entry.
- Annotate on selection — optionally, just selecting text copies or inserts the
  link automatically, no command needed (off / copy / insert, cyclable by command).
- Comments — attach a comment to an annotation as you create it.
- Templates — customize the inserted snippet and the link display text with
  variables like `{{text}}`, `{{page}}`, `{{chapter}}`, `{{comment}}`.

## Commands

| Command | What it does |
| --- | --- |
| Copy link to selection | Copy an annotation link for the current selection to the clipboard |
| Insert link into note | Insert the annotation snippet into the target note |
| … with comment | Same, but attach a comment |
| Cycle what selecting text does | Toggle the on-selection action: off → copy → insert |

## Settings

- Highlight colors — the palette offered by the toolbar picker (first color is
  the default).
- Snippet template — the markdown block inserted into the note
  (default: a `> [!quote]` callout with the link and the selected text).
- Link display text — the link alias, configurable separately for PDF
  (default `{{file.basename}}, p.{{page}}`) and EPUB
  (default `{{file.basename}}, {{chapter}}`).
- On text selection — what a settled selection does by itself.

EPUB display options (paginated/scrolled, font size, theme following) are adjusted
directly from the viewer toolbar.

## Installation

Maki is not in the community plugin registry yet — install it manually:

1. Build the plugin (see below), or grab `main.js`, `manifest.json`, and
   `styles.css` from a release.
2. Copy them into `<your vault>/.obsidian/plugins/obsidian-maki/`.
3. Reload Obsidian and enable Maki in *Settings → Community plugins*.

Desktop only (the PDF backend binds to Obsidian's desktop PDF viewer).

## Building from source

Requires Node 22 and pnpm (a Nix flake + `.envrc` are provided if you use
direnv/Nix).

```sh
git clone https://github.com/tkuramot/obsidian-maki
cd obsidian-maki
git submodule update --init   # vendored foliate-js fork
pnpm install
pnpm build                    # typecheck + bundle to main.js
```

Other scripts: `pnpm dev` (watch mode), `pnpm test` (unit tests),
`pnpm typecheck`.

## Status

Early development (v0.1.0). The plugin is implemented, unit-tested, and in active
personal use, but still young — expect rough edges, and please report issues.

## Acknowledgements

- [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) by Ryota
  Ushio — the direct inspiration for Maki's note-first annotation workflow.
- [foliate-js](https://github.com/johnfactotum/foliate-js) by John Factotum — the
  EPUB rendering engine.

## License

[MIT](LICENSE). The bundled `main.js` includes third-party code whose licenses
are collected in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) — a generated file
(`pnpm licenses`) derived from whatever esbuild actually bundles.
