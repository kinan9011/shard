import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { DiffMerge } from "@/components/tools/DiffMerge";
import { TextDiffView } from "@/components/tools/diff-merge/TextDiffView";
import { counterText } from "@/components/tools/diff-merge/TextToolbar";
import type { PaneDoc } from "@/components/tools/diff-merge/DiffPanes";
import { computeBlocks } from "@/utils/diff-merge/blocks";
import { isDesktop, pickFolder, readTextFile, saveFile, scanFolder } from "@/lib/desktop";
import { SETTINGS_KEY } from "@/utils/diff-merge/settings";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop")>()),
  saveFile: vi.fn(() => Promise.resolve(true)),
  isDesktop: vi.fn(() => false),
  pickFolder: vi.fn(),
  scanFolder: vi.fn(),
  readTextFile: vi.fn(),
}));

// Radix Select measures and scrolls with APIs jsdom does not have.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const doc = (name: string, text: string, eol: "LF" | "CRLF" = "LF"): PaneDoc => ({ name, text, eol, language: null });
const PANE = { Original: "pane-a", Modified: "pane-b" } as const;

function viewOf(label: keyof typeof PANE): EditorView {
  const dom = screen.getByTestId(PANE[label]).querySelector(".cm-editor") as HTMLElement;
  return EditorView.findFromDOM(dom)!;
}

async function typeInto(label: keyof typeof PANE, text: string) {
  const view = viewOf(label);
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
}

const root = () => screen.getByTestId("diff-merge");

async function selectOption(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

const twoChanges = async () => {
  await typeInto("Original", "a\nb\nc\nd\n");
  await typeInto("Modified", "a\nB\nc\nD\n");
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(isDesktop).mockReturnValue(false);
});

describe("counterText", () => {
  it("picks the copy in the documented order", () => {
    expect(counterText(0, 0, true)).toBe("Nothing to compare");
    expect(counterText(0, 0, false)).toBe("No differences");
    expect(counterText(1, 0, false)).toBe("1 of 1 difference");
    expect(counterText(3, 1, false)).toBe("2 of 3 differences");
  });
});

describe("Text mode screen", () => {
  it("counts and navigates", async () => {
    render(<DiffMerge />);
    await twoChanges();
    expect(await screen.findByText("1 of 2 differences")).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "F7" });
    expect(await screen.findByText("2 of 2 differences")).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "F7" });
    expect(await screen.findByText("1 of 2 differences")).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "F7", shiftKey: true });
    expect(await screen.findByText("2 of 2 differences")).toBeInTheDocument();
  });

  it("navigates with the toolbar buttons", async () => {
    render(<DiffMerge />);
    await twoChanges();
    await screen.findByText("1 of 2 differences");
    fireEvent.click(screen.getByTitle("Next difference (F7)"));
    expect(await screen.findByText("2 of 2 differences")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Previous difference (Shift+F7)"));
    expect(await screen.findByText("1 of 2 differences")).toBeInTheDocument();
  });

  it("empty and identical states", async () => {
    render(<DiffMerge />);
    expect(screen.getByText("Nothing to compare")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await typeInto("Original", "x");
    await typeInto("Modified", "x");
    expect(await screen.findByText("No differences")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("applies with Ctrl+Shift+→ and reports the undo hint", async () => {
    render(<DiffMerge />);
    await twoChanges();
    await screen.findByText("1 of 2 differences");
    fireEvent.keyDown(root(), { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(await screen.findByText("Applied change 1 — Ctrl+Z to undo")).toBeInTheDocument();
    expect(await screen.findByText("1 of 1 difference")).toBeInTheDocument();
    // The message survives the recompute its own apply causes, and goes on the next edit.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Applied change 1 — Ctrl+Z to undo")).toBeInTheDocument();
    await typeInto("Modified", "zzz\n");
    await waitFor(() => expect(screen.queryByText(/Applied change/)).not.toBeInTheDocument());
  });

  it("applies right to left with Ctrl+Shift+←", async () => {
    render(<DiffMerge />);
    await twoChanges();
    await screen.findByText("1 of 2 differences");
    fireEvent.keyDown(root(), { key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(viewOf("Original").state.doc.toString()).toBe("a\nB\nc\nd\n"));
  });

  it("swaps sides", async () => {
    render(<TextDiffView initial={[doc("left.txt", "a\n"), doc("right.txt", "b\n")]} />);
    await screen.findByText("1 of 1 difference");
    fireEvent.keyDown(root(), { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(viewOf("Original").state.doc.toString()).toBe("b\n"));
    expect(viewOf("Modified").state.doc.toString()).toBe("a\n");
    expect(screen.getAllByTitle("Rename").map((b) => b.textContent)).toEqual(["right.txt", "left.txt"]);
  });

  it("toggles collapse with Ctrl+Shift+C and persists it", async () => {
    render(<DiffMerge />);
    expect(screen.getByRole("switch", { name: "Collapse unchanged" })).not.toBeChecked();
    fireEvent.keyDown(root(), { key: "C", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("switch", { name: "Collapse unchanged" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).collapse).toBe(true);
  });

  it("Ctrl+O opens the file picker of the focused pane", async () => {
    render(<DiffMerge />);
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.keyDown(root(), { key: "o", ctrlKey: true });
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("status shows stats", async () => {
    render(<TextDiffView initial={[doc("a.txt", "a\nb\n"), doc("b.txt", "a\nc\n")]} />);
    expect(await screen.findByText("1 modified")).toBeInTheDocument();
    expect(screen.getByText("0 added")).toBeInTheDocument();
    expect(screen.getByText("0 removed")).toBeInTheDocument();
    expect(screen.getByText("Local processing")).toBeInTheDocument();
  });

  it("status bar shows the original EOL", async () => {
    render(<TextDiffView initial={[doc("a.txt", "a\nb\n"), doc("b.txt", "a\nc\n", "CRLF")]} />);
    expect(await screen.findByText("UTF-8 · CRLF")).toBeInTheDocument();
  });

  it("shows the approximate notice when the diff is imprecise", async () => {
    const lines = (p: string) => Array.from({ length: 2000 }, (_, i) => `${p}${i}`).join("\n");
    render(<TextDiffView initial={[doc("a.txt", lines("a")), doc("b.txt", lines("b"))]} />);
    const notice = await screen.findByText("Diff is approximate for very large input");
    expect(notice).toHaveAttribute("role", "status");
  });

  it("has no notice for a small diff", async () => {
    render(<TextDiffView initial={[doc("a.txt", "a\n"), doc("b.txt", "b\n")]} />);
    await screen.findByText("1 of 1 difference");
    expect(screen.queryByText("Diff is approximate for very large input")).not.toBeInTheDocument();
  });
});

describe("TextToolbar", () => {
  it("lists the controls with their titles", () => {
    render(<DiffMerge />);
    expect(screen.getByTitle("Previous difference (Shift+F7)")).toBeInTheDocument();
    expect(screen.getByTitle("Next difference (F7)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Sync scroll" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Viewer" })).toHaveTextContent("Side-by-side");
    expect(screen.getByRole("combobox", { name: "Ignore" })).toHaveTextContent("Do not ignore");
    expect(screen.getByRole("combobox", { name: "Highlight" })).toHaveTextContent("Words");
    expect(screen.getByText("Nothing to compare")).toHaveAttribute("aria-live", "polite");
  });

  it("persists an Ignore choice", async () => {
    render(<DiffMerge />);
    await selectOption("Ignore", "Ignore whitespace");
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).ignore).toBe("whitespace");
  });

  it("shows the Text | Folders switch only when a mode handler is given", () => {
    const { unmount } = render(<TextDiffView />);
    expect(screen.queryByRole("radio", { name: "Folders" })).not.toBeInTheDocument();
    unmount();
    const onModeChange = vi.fn();
    render(<TextDiffView onModeChange={onModeChange} />);
    expect(within(root()).getByRole("radio", { name: "Text" })).toBeChecked();
    fireEvent.click(within(root()).getByRole("radio", { name: "Folders" }));
    expect(onModeChange).toHaveBeenCalledWith("folders");
  });

  it("disables Sync scroll in the unified viewer", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ viewer: "unified" }));
    render(<DiffMerge />);
    expect(screen.getByRole("switch", { name: "Sync scroll" })).toBeDisabled();
  });
});

describe("Unified viewer", () => {
  const unifiedView = async (a = "a\nb\n", b = "a\nc\n", names: [string, string] = ["left.txt", "right.txt"], eol: "LF" | "CRLF" = "LF") => {
    render(<TextDiffView initial={[doc(names[0], a), doc(names[1], b, eol)]} />);
    await screen.findByText("1 of 1 difference");
    await selectOption("Viewer", "Unified");
  };

  it("shows −/+ rows and Keep chips apply", async () => {
    await unifiedView();
    expect(await screen.findByText("−")).toBeInTheDocument();
    expect(screen.getByText("+")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep left (change 1)" }));
    expect(await screen.findByText("No differences")).toBeInTheDocument();
    expect(viewOf("Modified").state.doc.toString()).toBe("a\nb\n");
  });

  it("Keep right applies to the left side", async () => {
    await unifiedView();
    fireEvent.click(await screen.findByRole("button", { name: "Keep right (change 1)" }));
    expect(await screen.findByText("No differences")).toBeInTheDocument();
    expect(viewOf("Original").state.doc.toString()).toBe("a\nc\n");
  });

  it("shows the unified header with names and patch buttons", async () => {
    await unifiedView();
    expect(await screen.findByText("left.txt → right.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy patch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy result" })).toBeInTheDocument();
  });

  it("Copy patch copies a unified patch", async () => {
    await unifiedView();
    fireEvent.click(await screen.findByRole("button", { name: "Copy patch" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(text).toContain("--- a/left.txt");
    expect(text).toContain("+++ b/right.txt");
    expect(text).toContain("-b");
    expect(text).toContain("+c");
  });

  it("Copy result writes the modified text with its original EOL", async () => {
    await unifiedView("a\nb\n", "a\nc\n", ["l.txt", "r.txt"], "CRLF");
    fireEvent.click(await screen.findByRole("button", { name: "Copy result" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("a\r\nc\r\n"));
  });

  it("keeps the side-by-side editors mounted but hidden", async () => {
    await unifiedView();
    expect(screen.getByTestId("pane-a")).toBeInTheDocument();
    expect(screen.getByTestId("pane-a").closest(".hidden")).not.toBeNull();
    await selectOption("Viewer", "Side-by-side");
    expect(screen.getByTestId("pane-a").closest(".hidden")).toBeNull();
  });

  it("Ctrl+Z undoes a Keep chip", async () => {
    await unifiedView();
    fireEvent.click(await screen.findByRole("button", { name: "Keep left (change 1)" }));
    await screen.findByText("No differences");
    fireEvent.keyDown(root(), { key: "z", ctrlKey: true });
    expect(await screen.findByText("1 of 1 difference")).toBeInTheDocument();
    expect(viewOf("Modified").state.doc.toString()).toBe("a\nc\n");
  });

  it("Ctrl+Z in unified leaves edits made in the side-by-side view alone", async () => {
    render(<TextDiffView initial={[doc("l.txt", "a\n"), doc("r.txt", "b\n")]} />);
    await screen.findByText("1 of 1 difference");
    await typeInto("Modified", "zz\n");
    await selectOption("Viewer", "Unified");
    fireEvent.keyDown(root(), { key: "z", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(viewOf("Modified").state.doc.toString()).toBe("zz\n");
  });

  it("folds long unchanged runs", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ collapse: true }));
    const same = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    await unifiedView(`${same}\nx\n`, `${same}\ny\n`);
    expect(await within(screen.getByTestId("unified-pane")).findByText(/unchanged lines/)).toBeInTheDocument();
  });
});

const blobText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const stored = () => JSON.parse(localStorage.getItem(SETTINGS_KEY)!);

describe("Panels", () => {
  it("settings persist and reset", async () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Compare settings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Wrap long lines" }));
    expect(stored().wrap).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByRole("switch", { name: "Wrap long lines" })).not.toBeChecked();
    expect(stored().wrap).toBe(false);
  });

  it("renders the panel in <body>, outside the clipping content area, above the sidebar", () => {
    const { container } = render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const panel = screen.getByRole("dialog");
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
    expect(panel).toHaveClass("fixed", "z-[90]");
  });

  it("lists every setting from the design", () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    for (const name of ["Wrap long lines", "Show whitespace", "Ignore case", "Detect language from content"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Context lines")).toBeInTheDocument();
    expect(screen.getByText("Kept around changes when collapsed")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Detect language from content" })).toBeChecked();
    // The design's panel switches are 34×19 with a 15px thumb; the toolbar ones stay 44×24.
    expect(screen.getByRole("switch", { name: "Ignore case" })).toHaveClass("dm-switch-sm");
    expect(screen.getByRole("switch", { name: "Collapse unchanged" })).not.toHaveClass("dm-switch-sm");
  });

  it("context lines stepper clamps 0..20", () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const less = screen.getByRole("button", { name: "Fewer context lines" });
    for (let i = 0; i < 4; i++) fireEvent.click(less);
    expect(screen.getByTestId("context-lines")).toHaveTextContent("0");
    expect(stored().contextLines).toBe(0);
    const more = screen.getByRole("button", { name: "More context lines" });
    for (let i = 0; i < 25; i++) fireEvent.click(more);
    expect(screen.getByTestId("context-lines")).toHaveTextContent("20");
    expect(stored().contextLines).toBe(20);
  });

  it("shortcuts panel lists the design's rows", () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByText("Push change to the right")).toBeInTheDocument();
    expect(screen.getByText("F7")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+→")).toBeInTheDocument();
    expect(screen.getByText("Click the change map on the right edge to jump to a change.")).toBeInTheDocument();
  });

  it("closes on Escape and on an outside pointerdown, and focuses its first control", async () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fewer context lines" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Compare settings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByText("Keyboard shortcuts", { selector: "div" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("Click the change map on the right edge to jump to a change.")).not.toBeInTheDocument();
  });

  it("opens one panel at a time", () => {
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.queryByText("Compare settings")).not.toBeInTheDocument();
    expect(screen.getByText("Push change to the right")).toBeInTheDocument();
  });
});

describe("Collapse and export", () => {
  const long = Array.from({ length: 27 }, (_, i) => `line ${i}`).join("\n");
  const folded = () => screen.queryAllByText("21 unchanged lines");

  it("collapse toggle folds long unchanged runs", async () => {
    render(<TextDiffView initial={[doc("a.txt", `${long}\nx\n`), doc("b.txt", `${long}\ny\n`)]} />);
    await screen.findByText("1 of 1 difference");
    expect(folded()).toHaveLength(0);
    fireEvent.click(screen.getByRole("switch", { name: "Collapse unchanged" }));
    await waitFor(() => expect(folded().length).toBeGreaterThan(0));
  });

  it("a fold opens on click and folds again once collapse is toggled off and on", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ collapse: true }));
    render(<TextDiffView initial={[doc("a.txt", `${long}\nx\n`), doc("b.txt", `${long}\ny\n`)]} />);
    await waitFor(() => expect(folded().length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Click to expand")[0]);
    await waitFor(() => expect(folded().length).toBeLessThan(2));
    const left = folded().length;
    fireEvent.click(screen.getByRole("switch", { name: "Collapse unchanged" }));
    await waitFor(() => expect(folded()).toHaveLength(0));
    fireEvent.click(screen.getByRole("switch", { name: "Collapse unchanged" }));
    await waitFor(() => expect(folded().length).toBeGreaterThan(left));
  });

  it("Save writes the pane's text with its original EOL", async () => {
    render(<TextDiffView initial={[doc("l.txt", "a\nb\n"), doc("r.txt", "a\nc\n", "CRLF")]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save Modified" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    const [blob, name] = vi.mocked(saveFile).mock.calls[0];
    expect(name).toBe("r.txt");
    expect(await blobText(blob)).toBe("a\r\nc\r\n");
  });

  it("has no Save button on an empty pane", () => {
    render(<DiffMerge />);
    expect(screen.queryByRole("button", { name: "Save Original" })).not.toBeInTheDocument();
  });

  it("Save patch saves {nameA}.patch", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ viewer: "unified" }));
    render(<TextDiffView initial={[doc("l.txt", "a\nb\n"), doc("r.txt", "a\nc\n")]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save patch" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    const [blob, name] = vi.mocked(saveFile).mock.calls[0];
    expect(name).toBe("l.txt.patch");
    expect(await blobText(blob)).toContain("--- a/l.txt");
  });
});

describe("Mockup parity", () => {
  /** LEFT and RIGHT exactly as the design prototype defines them (read only, never rendered). */
  function designSample(): { left: string; right: string } {
    const html = readFileSync("docs/side-by-side-diff-merger/project/Diff Merge Tool.dc.html", "utf8");
    const from = html.indexOf("const CHUNK = [");
    const to = html.indexOf("const RIGHT_APPLIED");
    const { LEFT, RIGHT } = new Function(`${html.slice(from, to)}; return { LEFT, RIGHT };`)() as { LEFT: string[]; RIGHT: string[] };
    return { left: LEFT.join("\n"), right: RIGHT.join("\n") };
  }

  // The prototype's SEG lists 7 hunks, split wherever one common line separates two changes. The CodeMirror
  // engine (master plan, Task 2) groups such neighbours, so the same text gives 5 blocks here. Pinned so a
  // change of engine or grouping shows up; see "Deviations" under Task 10.
  it("the design's sample text diffs into the engine's 5 blocks (the design draws 7)", async () => {
    const { left, right } = designSample();
    const blocks = computeBlocks(left, right, { ignore: "none", ignoreCase: false });
    expect(blocks.map((b) => b.kind)).toEqual(["modified", "modified", "modified", "modified", "modified"]);
    expect(blocks.map((b) => [b.linesA.from, b.linesA.to, b.linesB.from, b.linesB.to])).toEqual([
      [1, 5, 1, 6],
      [7, 14, 8, 12],
      [16, 18, 14, 16],
      [20, 24, 18, 21],
      [50, 53, 47, 50],
    ]);
    render(<TextDiffView initial={[doc("check_client_name.py", left), doc("check_invoices.py", right)]} />);
    expect(await screen.findByText("1 of 5 differences")).toBeInTheDocument();
  });

  describe("narrow window", () => {
    const observed: { target: Element; cb: ResizeObserverCallback }[] = [];
    const original = globalThis.ResizeObserver;
    beforeEach(() => {
      observed.length = 0;
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe(target: Element) {
          observed.push({ target, cb: this.cb });
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      return () => {
        globalThis.ResizeObserver = original;
      };
    });
    const resize = (width: number) =>
      act(() => {
        for (const { target, cb } of observed) {
          if (target === root()) cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        }
      });

    it("forces unified below 900px, hides the Viewer select and does not persist the override", async () => {
      render(<TextDiffView initial={[doc("a.txt", "a\n"), doc("b.txt", "b\n")]} />);
      await screen.findByText("1 of 1 difference");
      expect(screen.getByRole("combobox", { name: "Viewer" })).toBeInTheDocument();
      resize(899);
      expect(screen.queryByRole("combobox", { name: "Viewer" })).not.toBeInTheDocument();
      expect(screen.getByTestId("unified-pane")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Sync scroll" })).toBeDisabled();
      expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
      resize(900);
      expect(screen.getByRole("combobox", { name: "Viewer" })).toBeInTheDocument();
      expect(screen.queryByTestId("unified-pane")).not.toBeInTheDocument();
    });

    it("treats a zero width as unknown, not narrow", async () => {
      render(<TextDiffView />);
      resize(0);
      expect(screen.getByRole("combobox", { name: "Viewer" })).toBeInTheDocument();
    });
  });
});

describe("Mode switching", () => {
  it("Open in Text view carries both files into Text mode", async () => {
    vi.mocked(isDesktop).mockReturnValue(true);
    vi.mocked(pickFolder).mockResolvedValueOnce("/L").mockResolvedValueOnce("/R");
    const file = (size: number) => ({ path: "go.mod", isDir: false, size, modifiedMs: 0 });
    vi.mocked(scanFolder).mockImplementation(async (r) => [file(r === "/L" ? 5 : 6)]);
    vi.mocked(readTextFile).mockResolvedValueOnce("a\n").mockResolvedValueOnce("b\n");
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
    const [browseLeft, browseRight] = screen.getAllByRole("button", { name: /^Browse/ });
    fireEvent.click(browseLeft);
    await screen.findByText("/L");
    fireEvent.click(browseRight);
    fireEvent.click((await screen.findAllByText("go.mod"))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Open in Text view" }));
    expect(await screen.findByRole("radio", { name: "Text" })).toBeChecked();
    const text = within(root());
    const docs = ["pane-a", "pane-b"].map((id) => EditorView.findFromDOM(text.getByTestId(id).querySelector(".cm-editor") as HTMLElement)!.state.doc.toString());
    expect(docs).toEqual(["a\n", "b\n"]);
    expect(text.getAllByRole("button", { name: "go.mod" })).toHaveLength(2);
    expect(await text.findByText("1 of 1 difference")).toBeInTheDocument();
  });

  it("keeps both screens mounted, so Text state survives a trip to Folders", async () => {
    render(<DiffMerge />);
    await typeInto("Original", "left\n");
    fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
    expect(root().closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Text" }));
    expect(viewOf("Original").state.doc.toString()).toBe("left\n");
  });
});
