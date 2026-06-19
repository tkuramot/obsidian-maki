# Maki — Documentation

Maki is an Obsidian plugin for **reading PDF and EPUB documents inside Obsidian and
annotating them from your notes**. You highlight a passage in the document preview;
Maki writes a link to that exact passage into a markdown note where you add your
commentary. The note is the source of truth — every such link is rendered back as a
colored highlight over the document, and clicking either side jumps to the other.

It is modeled on [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus)
and generalizes its workflow from PDF to EPUB.

## Documents

| Document | Audience | Contents |
| --- | --- | --- |
| [specification.md](./specification.md) | Everyone | **What** Maki does — purpose, terminology, requirements, the link/locator format (a persisted data contract), user workflows, constraints. |
| [design.md](./design.md) | Implementers | **How** Maki is built — the document abstraction (ports & adapters), the shared core, the PDF and EPUB backends, the humble-object split for testability, data flows, and the native-EPUB migration plan. |

Read the specification first; it defines the terms the design relies on.

## At a glance

- **PDF** reuses Obsidian's built-in PDF viewer (PDF.js), patched in place — the same
  strategy as obsidian-pdf-plus.
- **EPUB** is rendered by [foliate-js](https://github.com/johnfactotum/foliate-js)
  inside a plugin-owned view, because Obsidian has no native EPUB viewer.
- Both formats share one workflow, one link model, and one set of core services.
  Only the parts that genuinely differ (viewer acquisition, selection capture,
  location addressing, highlight geometry) are backend-specific.
- A **document abstraction** isolates those differences behind a stable port, so when
  Obsidian ships a native EPUB viewer, only one adapter is swapped — the rest is
  untouched.
- The **humble object pattern** keeps framework-bound code (Obsidian, PDF.js,
  foliate-js, the DOM) thin and pushes all real logic into pure, unit-testable
  modules.
