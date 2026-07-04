/**
 * `SelectionAutoAnnotator` — the annotate-on-selection mode (pdf-plus's
 * "auto-copy mode"): when enabled, a text selection that is confirmed —
 * pointer released, then no change for a short window — triggers the annotate
 * pipeline, exactly as if the user had run the copy or insert command (which
 * one is the caller's decision).
 *
 * All decisions live here: that a selection still being dragged never fires
 * (pausing mid-drag must not annotate), when a released selection counts as
 * settled, that one selection fires once, that clearing re-arms it, and that
 * the mode toggle applies immediately. The timer and the annotate effect are
 * injected, so the logic is unit-testable with structural fakes.
 */

import type { DocumentViewer } from "./document-viewer";
import type { TextSelection } from "./types";

/** Cancelable delayed call; returns the canceler. Injectable for tests. */
export type Schedule = (cb: () => void, delayMs: number) => () => void;

const defaultSchedule: Schedule = (cb, delayMs) => {
  const handle = setTimeout(cb, delayMs);
  return () => clearTimeout(handle);
};

/**
 * `selectionchange` can trail the pointer release (and keyboard selection has
 * no release at all); the selection counts as settled once it has been stable
 * this long after the last change outside a drag.
 */
export const SELECTION_SETTLE_MS = 300;

interface ViewerState {
  /** Canceler of the pending settle timer, if one is running. */
  cancel: (() => void) | null;
  /** Key of the last annotated selection, so one selection fires once. */
  lastKey: string | null;
  /** A selection-adjusting pointer is currently down (`onDragChange`). */
  dragging: boolean;
  /** Key streamed during the current drag, held until the pointer releases. */
  heldKey: string | null;
}

function selectionKey(sel: TextSelection): string {
  // Adapters build locators with a fixed property order, so JSON is a
  // stable identity for "the same selection, unchanged".
  return `${JSON.stringify(sel.locator)}\0${sel.text}`;
}

export class SelectionAutoAnnotator {
  private readonly states = new Map<DocumentViewer, ViewerState>();

  constructor(
    private readonly deps: {
      /** Read per event so a runtime toggle applies immediately. */
      enabled: () => boolean;
      annotate: (viewer: DocumentViewer) => void;
      schedule?: Schedule;
      settleMs?: number;
    },
  ) {}

  /** Feed every `DocumentViewer.onSelectionChange` event here. */
  onSelection(viewer: DocumentViewer, sel: TextSelection | null): void {
    const state = this.state(viewer);
    state.cancel?.();
    state.cancel = null;

    if (sel === null) {
      // Cleared: re-arm, so re-selecting the same passage fires again.
      state.lastKey = null;
      state.heldKey = null;
      return;
    }
    if (!this.deps.enabled()) return;

    const key = selectionKey(sel);
    if (key === state.lastKey) {
      // Already annotated, unchanged — nothing to hold or schedule.
      state.heldKey = null;
      return;
    }
    if (state.dragging) {
      // Mid-drag: the selection is still being adjusted. Hold it; the
      // release (`onDragChange(false)`) arms the settle timer.
      state.heldKey = key;
      return;
    }
    this.arm(viewer, state, key);
  }

  /** Feed every `DocumentViewer.onSelectionDrag` event here. */
  onDragChange(viewer: DocumentViewer, dragging: boolean): void {
    const state = this.state(viewer);
    state.dragging = dragging;
    if (dragging) {
      // A new press means the user is adjusting again; nothing may fire
      // mid-gesture.
      state.cancel?.();
      state.cancel = null;
      state.heldKey = null;
      return;
    }
    // Released. A release with nothing held (unrelated click, stray
    // doc-level pointerup) must not disturb an already-armed timer.
    const key = state.heldKey;
    state.heldKey = null;
    if (key === null || key === state.lastKey || !this.deps.enabled()) return;
    this.arm(viewer, state, key);
  }

  /** Drop a viewer's state and cancel its pending work (viewer closed). */
  detach(viewer: DocumentViewer): void {
    this.states.get(viewer)?.cancel?.();
    this.states.delete(viewer);
  }

  private arm(viewer: DocumentViewer, state: ViewerState, key: string): void {
    const schedule = this.deps.schedule ?? defaultSchedule;
    state.cancel = schedule(() => {
      state.cancel = null;
      // The mode may have been toggled off while the timer ran.
      if (!this.deps.enabled()) return;
      state.lastKey = key;
      this.deps.annotate(viewer);
    }, this.deps.settleMs ?? SELECTION_SETTLE_MS);
  }

  private state(viewer: DocumentViewer): ViewerState {
    let state = this.states.get(viewer);
    if (!state) {
      state = { cancel: null, lastKey: null, dragging: false, heldKey: null };
      this.states.set(viewer, state);
    }
    return state;
  }
}
