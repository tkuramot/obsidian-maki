import { describe, expect, it } from "vitest";
import { FakeDocumentViewer } from "../../test/fake-document-viewer";
import type { DocumentViewer } from "./document-viewer";
import { SelectionAutoAnnotator, type Schedule } from "./selection-auto-annotator";
import type { TextSelection } from "./types";

/** A hand-cranked scheduler: `settle()` is the settle window elapsing. */
class ManualScheduler {
  private pending: Array<{ cb: () => void; cancelled: boolean }> = [];

  readonly schedule: Schedule = (cb) => {
    const task = { cb, cancelled: false };
    this.pending.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  settle(): void {
    const tasks = this.pending;
    this.pending = [];
    for (const task of tasks) if (!task.cancelled) task.cb();
  }
}

function sel(text: string): TextSelection {
  return {
    locator: {
      backend: "pdf",
      page: 1,
      target: { kind: "text", begin: [0, 0], end: [0, text.length] },
    },
    text,
  };
}

function setup(opts: { enabled?: boolean } = {}) {
  const state = { enabled: opts.enabled ?? true };
  const scheduler = new ManualScheduler();
  const annotated: DocumentViewer[] = [];
  const annotator = new SelectionAutoAnnotator({
    enabled: () => state.enabled,
    annotate: (viewer) => annotated.push(viewer),
    schedule: scheduler.schedule,
  });
  const viewer = new FakeDocumentViewer({ path: "Books/doc.pdf", backend: "pdf" });
  return { state, scheduler, annotated, annotator, viewer };
}

describe("SelectionAutoAnnotator", () => {
  it("annotates once the selection settles", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    expect(annotated).toEqual([]);
    scheduler.settle();
    expect(annotated).toEqual([viewer]);
  });

  it("debounces while the selection is still growing", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("h"));
    annotator.onSelection(viewer, sel("he"));
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    expect(annotated).toHaveLength(1);
  });

  it("does not re-annotate an identical settled selection", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    expect(annotated).toHaveLength(1);
  });

  it("annotates again when the settled selection changed", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    annotator.onSelection(viewer, sel("hello world"));
    scheduler.settle();
    expect(annotated).toHaveLength(2);
  });

  it("clearing the selection re-arms the same passage", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    annotator.onSelection(viewer, null);
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    expect(annotated).toHaveLength(2);
  });

  it("clearing before the window elapses cancels the pending fire", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    annotator.onSelection(viewer, null);
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("never schedules while the mode is off", () => {
    const { scheduler, annotated, annotator, viewer } = setup({ enabled: false });
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("stays quiet when the mode is toggled off during the window", () => {
    const { state, scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    state.enabled = false;
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("keeps independent state per viewer", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    const other = new FakeDocumentViewer({ path: "Books/other.pdf", backend: "pdf" });
    annotator.onSelection(viewer, sel("hello"));
    annotator.onSelection(other, sel("hello"));
    scheduler.settle();
    expect(annotated).toEqual([viewer, other]);
  });

  it("detach cancels pending work", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    annotator.detach(viewer);
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("holds fire while the pointer is down, fires after release settles", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("h"));
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle(); // pausing mid-drag must not annotate
    expect(annotated).toEqual([]);
    annotator.onDragChange(viewer, false);
    expect(annotated).toEqual([]); // release arms the window, not the fire
    scheduler.settle();
    expect(annotated).toEqual([viewer]);
  });

  it("coalesces a selection event trailing the release into one fire", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("hell"));
    annotator.onDragChange(viewer, false);
    annotator.onSelection(viewer, sel("hello")); // selectionchange after pointerup
    scheduler.settle();
    expect(annotated).toHaveLength(1);
  });

  it("a new press cancels the pending fire of the previous release", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("hello"));
    annotator.onDragChange(viewer, false);
    annotator.onDragChange(viewer, true); // user extends before the window elapses
    scheduler.settle();
    expect(annotated).toEqual([]);
    annotator.onSelection(viewer, sel("hello world"));
    annotator.onDragChange(viewer, false);
    scheduler.settle();
    expect(annotated).toEqual([viewer]);
  });

  it("a release with nothing held does nothing", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onDragChange(viewer, false);
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("a stray release does not disturb an armed non-drag selection", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello")); // keyboard selection: no drag
    annotator.onDragChange(viewer, false); // doc-level pointerup elsewhere
    scheduler.settle();
    expect(annotated).toEqual([viewer]);
  });

  it("a selection cleared during the drag is not fired on release", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("hello"));
    annotator.onSelection(viewer, null);
    annotator.onDragChange(viewer, false);
    scheduler.settle();
    expect(annotated).toEqual([]);
  });

  it("dragging back to the already-annotated selection does not refire", () => {
    const { scheduler, annotated, annotator, viewer } = setup();
    annotator.onSelection(viewer, sel("hello"));
    scheduler.settle();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("hello world"));
    annotator.onSelection(viewer, sel("hello")); // shrunk back to the annotated one
    annotator.onDragChange(viewer, false);
    scheduler.settle();
    expect(annotated).toHaveLength(1);
  });

  it("stays quiet when the mode is toggled off during the drag", () => {
    const { state, scheduler, annotated, annotator, viewer } = setup();
    annotator.onDragChange(viewer, true);
    annotator.onSelection(viewer, sel("hello"));
    state.enabled = false;
    annotator.onDragChange(viewer, false);
    scheduler.settle();
    expect(annotated).toEqual([]);
  });
});
