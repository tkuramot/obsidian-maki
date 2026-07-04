# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Maki is an Obsidian plugin for reading PDF and EPUB documents inside Obsidian and
annotating them from notes: a link to the exact passage goes into a markdown note,
and every such link is rendered back as a colored highlight over the document. The
note is the source of truth. It generalizes the
[obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) workflow from
PDF to EPUB.

The architectural source of truth is [docs/architecture.md](docs/architecture.md) —
layering, core vocabulary, and the non-negotiable invariants (persisted link format,
markdown-as-source-of-truth, logic-in-core, EPUB iframe security). Read it before any
non-trivial work; this file covers only project status and the development workflow.

## Project status

All layers are implemented and in use against a live Obsidian (recent work — EPUB
stylesheet-CSP inlining, TOC sidebar, annotate-on-selection refinements — was iterated
manually in the app). The pure core (`src/core/`, incl. the `locator/` codec family)
has full unit tests. The PDF adapter (`src/backends/pdf/`) binds live view instances
and wraps their methods with `monkey-around`; the EPUB adapter (`src/backends/epub/`)
is the `maki-epub` view over foliate-js + `@zip.js/zip.js`. The toolbar color
picker exists in both viewers (DOM-injected into the native PDF toolbar).

This status section drifts — verify claims against the code before relying on them.

## Toolchain

Node 22 + pnpm + TypeScript + esbuild, with Vitest over `core/` plus the
testable pieces of `backends/`. The Nix dev shell (`flake.nix`) provides `nodejs_22`
and `pnpm`; enter it via `direnv` (an `.envrc` is present) or `nix develop`. The core
has no DOM/Obsidian imports, so its tests run in plain node (`environment: "node"` in
`vitest.config.ts`); DOM-dependent backend tests (snap-range, the EPUB section
transforms) opt into jsdom per file via a `// @vitest-environment jsdom` docblock.
`vitest.config.ts` resolves the `foliate-js` alias to the submodule, so backend tests
exercise the real vendored code (e.g. `cfi-order.test.ts` runs foliate's `epubcfi.js`).

Scripts:

- `pnpm test` — run the unit suite once (`pnpm test:watch` to watch). Run a single file
  or test with Vitest's filters, e.g. `pnpm test src/core/locator/pdf-codec.test.ts` or
  `pnpm test -t "round-trips"`
- `pnpm typecheck` — `tsc --noEmit` (strict, incl. `noUncheckedIndexedAccess`)
- `pnpm build` — typecheck + production esbuild bundle to `main.js`
- `pnpm dev` — esbuild watch mode
- `pnpm bump` — version bump (`scripts/bump.mjs`); releases go through the manual
  `.github/workflows/release.yml` workflow

Tests are colocated with their source (`foo.ts` → `foo.test.ts`); the shared codec
contract suite lives in `src/core/locator/codec-contract.ts` and the recording
`DocumentViewer` fake in `test/fake-document-viewer.ts`.

foliate-js submodule. After cloning, run `git submodule update --init`. The
submodule `vendor/foliate-js/` tracks the fork's `maki` branch; imports use the
`foliate-js/*` specifier (esbuild `alias` → submodule, tsconfig `paths` →
hand-written declarations in `src/types/foliate-js/` — check those for drift on
every bump). The full wiring and update flow are in
[docs/architecture.md](docs/architecture.md).

The dependency policy is deliberately minimalist (see docs/architecture.md): runtime
dependencies are `monkey-around` + `@zip.js/zip.js` + the foliate-js submodule only.
