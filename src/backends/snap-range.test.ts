// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { snapToTextEndpoints } from "./snap-range";

/** A paragraph with three text nodes separated by inline elements. */
function fixture(): HTMLElement {
  document.body.innerHTML = "<p id='p'>alpha<b>bold</b>omega</p><p id='empty'></p>";
  return document.getElementById("p")!;
}

function textNodesOf(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

describe("snapToTextEndpoints", () => {
  it("returns the range unchanged when both endpoints are in text", () => {
    const p = fixture();
    const [alpha, , omega] = textNodesOf(p);
    const range = document.createRange();
    range.setStart(alpha!, 1);
    range.setEnd(omega!, 3);
    expect(snapToTextEndpoints(range)).toBe(range);
  });

  it("snaps an element-node start to the first intersecting text node", () => {
    const p = fixture();
    const [, , omega] = textNodesOf(p);
    const range = document.createRange();
    range.setStart(p, 0); // (element, child index) — how browsers report block drags
    range.setEnd(omega!, 3);
    const snapped = snapToTextEndpoints(range)!;
    expect(snapped).not.toBeNull();
    expect(snapped.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(snapped.startContainer.textContent).toBe("alpha");
    expect(snapped.startOffset).toBe(0);
    expect(snapped.toString()).toBe("alphaboldome");
  });

  it("snaps an element-node end to the outer edge of the last text node", () => {
    const p = fixture();
    const [alpha] = textNodesOf(p);
    const range = document.createRange();
    range.setStart(alpha!, 2);
    range.setEnd(p, p.childNodes.length);
    const snapped = snapToTextEndpoints(range)!;
    expect(snapped).not.toBeNull();
    expect(snapped.endContainer.textContent).toBe("omega");
    expect(snapped.endOffset).toBe(5);
    expect(snapped.toString()).toBe("phaboldomega");
  });

  it("returns null when the range contains no text at all", () => {
    fixture();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("empty")!);
    expect(snapToTextEndpoints(range)).toBeNull();
  });

  it("returns null when snapping collapses the range", () => {
    const p = fixture();
    const [alpha] = textNodesOf(p);
    const range = document.createRange();
    // Starts at the very end of "alpha" and ends on the element boundary
    // right after it — there is no text strictly inside.
    range.setStart(alpha!, 5);
    range.setEnd(p, 1);
    expect(snapToTextEndpoints(range)).toBeNull();
  });
});
