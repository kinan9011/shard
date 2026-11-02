import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { language } from "@codemirror/language";
import { toast } from "sonner";
import { DiffPanes, type DiffPanesHandle, type PaneDoc } from "@/components/tools/diff-merge/DiffPanes";
import { DEFAULT_SETTINGS, type DiffSettings } from "@/utils/diff-merge/settings";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

const doc = (name: string, text: string): PaneDoc => ({ name, text, eol: "LF", language: null });
const empty = (): [PaneDoc, PaneDoc] => [doc("", ""), doc("", "")];

function setup(initial: [PaneDoc, PaneDoc], extra: { settings?: DiffSettings; onCurrentChange?: (i: number) => void } = {}) {
  const ref = createRef<DiffPanesHandle>();
  const utils = render(
    <DiffPanes
      ref={ref}
      settings={extra.settings ?? DEFAULT_SETTINGS}
      current={0}
      onCurrentChange={extra.onCurrentChange ?? (() => {})}
      onApplied={() => {}}
      onStateChange={() => {}}
      initial={initial}
    />,
  );
  return { ref, ...utils };
}

const texts = (ref: { current: DiffPanesHandle | null }) => ref.current!.getDocs().map((d) => d.text);
const file = (bytes: number[] | string, name: string) =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name);

beforeEach(() => vi.clearAllMocks());

describe("DiffPanes", () => {
  it("renders arrows per change and applies left→right", async () => {
    const { ref } = setup([doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]);
    const btn = await screen.findByRole("button", { name: "Apply left to right (change 1)" });
    expect(screen.getByRole("button", { name: "Apply right to left (change 1)" })).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(ref.current!.getDocs()[1].text).toBe("a\nb\n"));
  });

  it("ctrl-click appends", async () => {
    const { ref } = setup([doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]);
    fireEvent.click(await screen.findByRole("button", { name: "Apply left to right (change 1)" }), { ctrlKey: true });
    await waitFor(() => expect(ref.current!.getDocs()[1].text).toBe("a\nc\nb\n"));
  });

  it("applies right→left", async () => {
    const { ref } = setup([doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]);
    fireEvent.click(await screen.findByRole("button", { name: "Apply right to left (change 1)" }));
    await waitFor(() => expect(texts(ref)[0]).toBe("a\nc\n"));
  });

  it("applies at the end of a doc with no trailing newline without dropping or doubling it", async () => {
    const { ref } = setup([doc("a.txt", "a\nb"), doc("b.txt", "a\nc")]);
    fireEvent.click(await screen.findByRole("button", { name: "Apply left to right (change 1)" }));
    await waitFor(() => expect(texts(ref)[1]).toBe("a\nb"));
  });

  it("pushes into an empty side", async () => {
    const { ref } = setup([doc("a.txt", "x\ny\n"), doc("", "")]);
    fireEvent.click(await screen.findByRole("button", { name: "Apply left to right (change 1)" }));
    await waitFor(() => expect(texts(ref)[1]).toBe("x\ny\n"));
  });

  it("ignores a stale arrow click when the doc changed since the last diff", async () => {
    const { ref } = setup([doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]);
    const btn = await screen.findByRole("button", { name: "Apply left to right (change 1)" });
    const b = ref.current!.editors.b!;
    b.dispatch({ changes: { from: 0, insert: "ZZ" } });
    fireEvent.click(btn);
    expect(texts(ref)[1]).toBe("ZZa\nc\n");
  });

  it("rejects a binary file", async () => {
    const { ref } = setup(empty());
    const input = screen.getByLabelText("Open file into Original") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file([1, 0, 2], "x.bin")] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This file is not UTF-8 text."));
    expect(texts(ref)[0]).toBe("");
  });

  it("rejects bytes that are not valid UTF-8 even without a NUL", async () => {
    const { ref } = setup(empty());
    const input = screen.getByLabelText("Open file into Modified") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file([0xff, 0xfe, 0xfa, 0x41], "latin.txt")] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This file is not UTF-8 text."));
    expect(texts(ref)[1]).toBe("");
  });

  it("rejects a binary file dropped on a pane", async () => {
    const { ref } = setup(empty());
    const dropped = file([0, 1, 2, 3], "blob.dat");
    fireEvent.drop(screen.getByTestId("pane-b"), { dataTransfer: { files: [dropped], types: ["Files"] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This file is not UTF-8 text."));
    expect(texts(ref)[1]).toBe("");
  });

  it("loads a dropped text file", async () => {
    const { ref } = setup(empty());
    fireEvent.drop(screen.getByTestId("pane-a"), { dataTransfer: { files: [file("hello\n", "h.txt")], types: ["Files"] } });
    await waitFor(() => expect(texts(ref)[0]).toBe("hello\n"));
    expect(ref.current!.getDocs()[0].name).toBe("h.txt");
  });

  it("Open normalises CRLF and remembers the original EOL", async () => {
    const { ref } = setup(empty());
    fireEvent.change(screen.getByLabelText("Open file into Original"), { target: { files: [file("a\r\nb\r\n", "w.txt")] } });
    await waitFor(() => expect(ref.current!.getDocs()[0].eol).toBe("CRLF"));
    expect(texts(ref)[0]).toBe("a\nb\n");
    expect(ref.current!.getDocs()[0].name).toBe("w.txt");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows line counts and language from the file name", async () => {
    setup([doc("x.py", "a\nb\n"), doc("y.py", "a\nc\n")]);
    expect((await screen.findAllByText("2 lines")).length).toBe(2);
    expect(screen.getAllByText("Python")[0]).toBeInTheDocument();
  });

  it("loads the language for both panes from their file names", async () => {
    const { ref } = setup([doc("x.py", "a = 1\n"), doc("y.json", "{}\n")]);
    await waitFor(() => expect(ref.current!.editors.a?.state.facet(language)?.name).toBe("python"));
    await waitFor(() => expect(ref.current!.editors.b?.state.facet(language)?.name).toBe("json"));
  });

  it("filters the language list as you type and Enter picks the first match", async () => {
    const { ref } = setup([doc("", "x = 1\n"), doc("", "x = 2\n")]);
    fireEvent.click(screen.getByRole("button", { name: "Language of Original" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter languages" }), { target: { value: "pyt" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Python"]);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter languages" }), { key: "Enter" });
    await waitFor(() => expect(ref.current!.getDocs()[0].language).toBe("Python"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Language of Original" })).toHaveTextContent("Python");
  });

  it("shows the empty copy and only Open and Paste while a side is empty", () => {
    setup(empty());
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.getAllByText("Plain text")).toHaveLength(2);
    expect(screen.getAllByText("Paste text or drop a file")).toHaveLength(2);
    expect(screen.getByText("Ctrl+V to paste, Ctrl+O to open a file")).toBeInTheDocument();
    expect(screen.getByText("Differences appear as soon as both sides have text")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).toBeNull();
    expect(screen.queryByText("Copy")).toBeNull();
  });

  it("Clear empties one side and resets its name", async () => {
    const { ref } = setup([doc("x.py", "a\n"), doc("y.py", "b\n")]);
    fireEvent.click((await screen.findAllByText("Clear"))[0]);
    await waitFor(() => expect(texts(ref)[0]).toBe(""));
    expect(ref.current!.getDocs()[0].name).toBe("");
    expect(texts(ref)[1]).toBe("b\n");
  });

  it("Paste fills a side from the clipboard", async () => {
    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce("p\r\nq\r\n");
    const { ref } = setup(empty());
    fireEvent.click(screen.getAllByText("Paste")[0]);
    await waitFor(() => expect(texts(ref)[0]).toBe("p\nq\n"));
    expect(ref.current!.getDocs()[0].eol).toBe("CRLF");
  });

  it("renames a pane through the inline input", async () => {
    const { ref } = setup([doc("x.py", "a\n"), doc("y.py", "b\n")]);
    fireEvent.click(await screen.findByText("x.py"));
    const input = screen.getByLabelText("Name of Original") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "z.json" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(ref.current!.getDocs()[0].name).toBe("z.json"));
    expect(await screen.findByText("JSON")).toBeInTheDocument();
  });

  it("Escape cancels a rename and Enter commits it once", async () => {
    const { ref } = setup([doc("x.py", "a\n"), doc("y.py", "b\n")]);
    fireEvent.click(await screen.findByText("x.py"));
    let input = screen.getByLabelText("Name of Original") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gone.json" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(ref.current!.getDocs()[0].name).toBe("x.py");
    fireEvent.click(await screen.findByText("x.py"));
    input = screen.getByLabelText("Name of Original") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "kept.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(ref.current!.getDocs()[0].name).toBe("kept.txt"));
  });

  it("goTo moves the B cursor to the block and reports the index", async () => {
    const onCurrentChange = vi.fn();
    const a = "a\nx\nb\nc\nd\n";
    const b = "a\nb\nc\nd\ny\n";
    const { ref } = setup([doc("x.txt", a), doc("y.txt", b)], { onCurrentChange });
    await waitFor(() => expect(ref.current!.editors.blocks).toHaveLength(2));
    ref.current!.goTo(1);
    expect(onCurrentChange).toHaveBeenCalledWith(1);
    expect(ref.current!.editors.b!.state.selection.main.head).toBe(ref.current!.editors.blocks[1].fromB);
  });

  it("clamps current when blocks shrink", async () => {
    const onCurrentChange = vi.fn();
    const ref = createRef<DiffPanesHandle>();
    render(
      <DiffPanes ref={ref} settings={DEFAULT_SETTINGS} current={3} onCurrentChange={onCurrentChange} onApplied={() => {}}
        onStateChange={() => {}} initial={[doc("a", "a\nb\n"), doc("b", "a\nc\n")]} />,
    );
    await waitFor(() => expect(onCurrentChange).toHaveBeenCalledWith(0));
  });

  it("change map ticks jump to their change", async () => {
    const onCurrentChange = vi.fn();
    setup([doc("x.txt", "a\nx\nb\nc\nd\n"), doc("y.txt", "a\nb\nc\nd\ny\n")], { onCurrentChange });
    fireEvent.click(await screen.findByRole("button", { name: "Go to change 2" }));
    expect(onCurrentChange).toHaveBeenCalledWith(1);
    expect(screen.getByTitle("Change map")).toBeInTheDocument();
  });

  it("expands a collapsed run when its fold bar is clicked", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const { container } = setup([doc("a.txt", lines), doc("b.txt", lines.replace("line 29", "changed"))], {
      settings: { ...DEFAULT_SETTINGS, collapse: true },
    });
    await waitFor(() => expect(container.querySelectorAll(".dm-fold")).toHaveLength(2));
    fireEvent.click(container.querySelector(".dm-fold") as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".dm-fold")).toHaveLength(0));
  });

  it("resizes the sides from the gutter separator: arrows move it, double-click resets", () => {
    const { container } = setup([doc("x.py", "a\n"), doc("y.py", "b\n")]);
    const root = container.querySelector(".dm-root") as HTMLElement;
    const sep = screen.getByRole("separator", { name: "Resize left and right side" });
    expect(root.style.gridTemplateColumns).toContain("minmax(0,50fr) 64px minmax(0,50fr)");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "55");
    expect(root.style.gridTemplateColumns).toContain("55fr");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "15");
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute("aria-valuenow", "50");
  });

  it("hides the headers when showHeaders is false", () => {
    const ref = createRef<DiffPanesHandle>();
    render(
      <DiffPanes ref={ref} settings={DEFAULT_SETTINGS} current={0} onCurrentChange={() => {}} onApplied={() => {}}
        onStateChange={() => {}} showHeaders={false} initial={[doc("x.py", "a\n"), doc("y.py", "b\n")]} />,
    );
    expect(screen.queryByText("x.py")).toBeNull();
  });
});
