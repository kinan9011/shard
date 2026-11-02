import { useRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDiffEditors, type DiffEditors } from "@/components/tools/diff-merge/useDiffEditors";
import { DEFAULT_SETTINGS, type DiffSettings } from "@/utils/diff-merge/settings";

let last: DiffEditors | null = null;
const latest = () => last as DiffEditors;

function Harness({ a, b, settings = DEFAULT_SETTINGS, current = 0, expanded = new Set<number>() }: {
  a: string; b: string; settings?: DiffSettings; current?: number; expanded?: ReadonlySet<number>;
}) {
  const hostA = useRef<HTMLDivElement>(null);
  const hostB = useRef<HTMLDivElement>(null);
  last = useDiffEditors(hostA, hostB, { settings, current, expanded, initialA: a, initialB: b });
  return (
    <>
      <div ref={hostA} data-testid="a" />
      <div ref={hostB} data-testid="b" />
    </>
  );
}

describe("useDiffEditors", () => {
  it("computes blocks and decorates both editors", async () => {
    const { container } = render(<Harness a={"a\nb\n"} b={"a\nc\n"} />);
    await waitFor(() => expect(latest().blocks).toHaveLength(1));
    expect(container.querySelectorAll(".dm-mod")).toHaveLength(2);
  });

  it("recomputes after an edit", async () => {
    render(<Harness a={"a\n"} b={"a\n"} />);
    await waitFor(() => expect(latest().a).not.toBeNull());
    act(() => latest().b!.dispatch({ changes: { from: 0, insert: "z" } }));
    await waitFor(() => expect(latest().blocks).toHaveLength(1));
  });

  it("marks added and removed lines and the current block", async () => {
    const { container } = render(<Harness a={"a\nx\nb\nc\nd\n"} b={"a\nb\nc\nd\ny\n"} />);
    await waitFor(() => expect(latest().blocks).toHaveLength(2));
    expect(container.querySelectorAll(".dm-del")).toHaveLength(1);
    expect(container.querySelectorAll(".dm-add")).toHaveLength(1);
    expect(container.querySelectorAll(".dm-cur")).toHaveLength(1);
    // Each side with no lines for a block gets a 2px gap widget.
    expect(container.querySelectorAll(".dm-gap")).toHaveLength(2);
  });

  it("collapses long unchanged runs into a fold bar and expands on dm-expand", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const a = lines.join("\n") + "\n";
    const b = a.replace("line 29", "changed");
    const settings = { ...DEFAULT_SETTINGS, collapse: true };
    const { container, rerender } = render(<Harness a={a} b={b} settings={settings} />);
    await waitFor(() => expect(container.querySelectorAll(".dm-fold")).toHaveLength(2));
    expect(container.textContent).toContain("23 unchanged lines");
    expect(container.textContent).toContain("Click to expand");
    const seen: number[] = [];
    container.addEventListener("dm-expand", (e) => seen.push((e as CustomEvent<number>).detail));
    (container.querySelector(".dm-fold") as HTMLElement).click();
    expect(seen).toEqual([3]);
    rerender(<Harness a={a} b={b} settings={settings} expanded={new Set([3])} />);
    await waitFor(() => expect(container.querySelectorAll(".dm-fold")).toHaveLength(0));
  });

  it("reconfigures line wrapping from settings", async () => {
    const { container, rerender } = render(<Harness a={"a\n"} b={"a\n"} />);
    await waitFor(() => expect(latest().a).not.toBeNull());
    expect(container.querySelector(".cm-lineWrapping")).toBeNull();
    rerender(<Harness a={"a\n"} b={"a\n"} settings={{ ...DEFAULT_SETTINGS, wrap: true }} />);
    await waitFor(() => expect(container.querySelector(".cm-lineWrapping")).not.toBeNull());
  });

  it("coalesces several edits into one recompute", async () => {
    render(<Harness a={"a\n"} b={"a\n"} />);
    await waitFor(() => expect(latest().a).not.toBeNull());
    const before = latest().blocks;
    act(() => {
      for (let i = 0; i < 5; i++) latest().b!.dispatch({ changes: { from: 0, insert: "z" } });
    });
    await waitFor(() => expect(latest().blocks).not.toBe(before));
    const settled = latest().blocks;
    await new Promise((r) => setTimeout(r, 60));
    expect(latest().blocks).toBe(settled);
  });
});
