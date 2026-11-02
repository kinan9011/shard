import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { DiffMerge } from "@/components/tools/DiffMerge";
import { FolderTable } from "@/components/tools/diff-merge/folder/FolderTable";
import { defaultAction, groupRows, makeRow } from "@/utils/diff-merge/folder";

const desktop = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  pickFolder: vi.fn(),
  scanFolder: vi.fn(),
  compareContents: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  applyFolderMerge: vi.fn(),
  undoFolderMerge: vi.fn(),
  revealPath: vi.fn(),
}));
vi.mock("@/lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop")>()),
  ...desktop,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

// Radix Select measures and scrolls with APIs jsdom does not have.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const f = (path: string, size = 1, modifiedMs = 0) => ({ path, isDir: false, size, modifiedMs });
const LEFT = [f("go.mod", 5), f("only-left.db")];
const RIGHT = [f("go.mod", 6), f("api")];

async function openFolders(left = LEFT, right = RIGHT) {
  desktop.isDesktop.mockReturnValue(true);
  desktop.pickFolder.mockResolvedValueOnce("/L").mockResolvedValueOnce("/R");
  desktop.scanFolder.mockImplementation(async (root: string) => (root === "/L" ? left : right));
  render(<DiffMerge />);
  fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
  const [browseLeft, browseRight] = screen.getAllByRole("button", { name: /^Browse/ });
  fireEvent.click(browseLeft);
  await waitFor(() => expect(desktop.pickFolder).toHaveBeenCalledTimes(1));
  await screen.findByText("/L");
  fireEvent.click(browseRight);
  await screen.findByText("/R");
  // Let the scan finish so no state update lands after the test.
  await waitFor(() => expect(screen.queryByText(/^Comparing…/)).not.toBeInTheDocument());
}

/** A both-sided row loads the lower diff; wait for it so no update lands after the test. */
const lowerLoaded = () => screen.findByText("No differences");

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name.replace(".", "\\.")) });

beforeEach(() => {
  vi.resetAllMocks();
  desktop.readTextFile.mockResolvedValue("x\n");
  desktop.compareContents.mockResolvedValue([]);
});

describe("Folders mode", () => {
  it("browser shows desktop-only notice", () => {
    desktop.isDesktop.mockReturnValue(false);
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
    expect(screen.getByText("Folder compare needs the desktop app")).toBeInTheDocument();
    expect(screen.getByText("Download Shard for macOS, Windows or Linux to compare folders.")).toBeInTheDocument();
    expect(desktop.pickFolder).not.toHaveBeenCalled();
    expect(desktop.scanFolder).not.toHaveBeenCalled();
  });

  it("asks for two folders before anything is scanned", () => {
    desktop.isDesktop.mockReturnValue(true);
    render(<DiffMerge />);
    fireEvent.click(screen.getByRole("radio", { name: "Folders" }));
    expect(screen.getByText("Choose two folders to compare")).toBeInTheDocument();
    expect(desktop.scanFolder).not.toHaveBeenCalled();
  });

  it("lists rows with kinds, counts and actions", async () => {
    await openFolders();
    expect(await screen.findByText("only-left.db")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Left only 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Right only 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Different 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Identical 0" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Start merge (2)")).toBeInTheDocument();
    expect(screen.getByText("Planned: 1 to the right · 1 to the left · 1 without an action")).toBeInTheDocument();
    expect(screen.getByText("3 differences")).toBeInTheDocument();
    expect(within(screen.getByTestId("diff-merge-folders")).getByText("Local processing")).toBeInTheDocument();
  });

  it("compares equal-sized files by content in batches of 500", async () => {
    const many = Array.from({ length: 1100 }, (_, i) => f(`f${String(i).padStart(4, "0")}`, 7));
    desktop.compareContents.mockImplementation(async (_l: string, _r: string, paths: string[]) => paths.map((p) => p !== "f0003"));
    await openFolders(many, many);
    expect(await screen.findByRole("row", { name: /f0003/ })).toBeInTheDocument();
    expect(desktop.compareContents.mock.calls.map((c) => c[2].length)).toEqual([500, 500, 100]);
    expect(screen.getByRole("button", { name: "Different 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Identical 1099" })).toBeInTheDocument();
    expect(screen.getByText("1099 identical hidden")).toBeInTheDocument();
  });

  it("space cycles the action, Delete ignores, the right-click menu sets it", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    const row = rowOf("go.mod");
    fireEvent.click(row);
    await lowerLoaded();
    expect(within(row).getByTitle("Different, no action yet")).toBeInTheDocument();
    fireEvent.keyDown(row, { key: " " });
    expect(within(row).getByTitle("Copy left to right")).toBeInTheDocument();
    fireEvent.keyDown(row, { key: "Delete" });
    expect(within(row).getByTitle("Ignored")).toBeInTheDocument();
    fireEvent.contextMenu(row);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("go.mod differs on both sides")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy right to left/ }));
    expect(within(row).getByTitle("Copy right to left")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking the action chip switches to the next action every time, without a menu or opening the file", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    const row = rowOf("go.mod");
    desktop.readTextFile.mockClear();
    const chip = () => within(row).getByRole("button");
    // different: none → toRight → toLeft → ignore → none
    for (const title of ["Copy left to right", "Copy right to left", "Ignored", "Different, no action yet"]) {
      fireEvent.click(chip());
      expect(within(row).getByTitle(title)).toBeInTheDocument();
    }
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(desktop.readTextFile).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+Arrow sets a direction and skips actions the row does not allow", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    const left = rowOf("only-left.db");
    fireEvent.click(left);
    fireEvent.keyDown(left, { key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    expect(within(left).getByTitle("Copy left to right")).toBeInTheDocument();
    const both = rowOf("go.mod");
    fireEvent.click(both);
    await lowerLoaded();
    fireEvent.keyDown(both, { key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    expect(within(both).getByTitle("Copy right to left")).toBeInTheDocument();
  });

  it("menu hides actions the row does not allow", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.contextMenu(rowOf("only-left.db"));
    expect(screen.getByText("only-left.db is only on the left")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Copy right to left/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Ignore/ })).toBeInTheDocument();
  });

  it("an action applies to every selected row", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(rowOf("api"));
    fireEvent.click(rowOf("only-left.db"), { ctrlKey: true });
    fireEvent.keyDown(rowOf("api"), { key: "Delete" });
    expect(within(rowOf("api")).getByTitle("Ignored")).toBeInTheDocument();
    expect(within(rowOf("only-left.db")).getByTitle("Ignored")).toBeInTheDocument();
    expect(screen.getByText("Start merge")).toBeDisabled();
  });

  it("shift+click selects a range and arrow keys move the selection", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(rowOf("api"));
    fireEvent.click(rowOf("only-left.db"), { shiftKey: true });
    expect(rowOf("go.mod")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(rowOf("api"));
    fireEvent.keyDown(rowOf("api"), { key: "ArrowDown" });
    expect(rowOf("go.mod")).toHaveAttribute("aria-selected", "true");
    expect(rowOf("api")).toHaveAttribute("aria-selected", "false");
    await lowerLoaded();
  });

  it("filter chips and filter box hide rows", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(screen.getByRole("button", { name: "Left only 1" }));
    expect(screen.getByRole("button", { name: "Left only 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("only-left.db")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter by name or path"), { target: { value: "API" } });
    expect(screen.getByRole("row", { name: /api/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /go\.mod/ })).not.toBeInTheDocument();
  });

  it("selecting a diff text file loads the lower diff", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    desktop.readTextFile.mockReset();
    desktop.readTextFile.mockResolvedValueOnce("a\n").mockResolvedValueOnce("b\n");
    fireEvent.click(screen.getAllByText("go.mod")[0]);
    expect(await screen.findByText("1 of 1 difference")).toBeInTheDocument();
    expect(desktop.readTextFile.mock.calls).toEqual([["/L", "go.mod"], ["/R", "go.mod"]]);
  });

  it("a file on one side does not load the lower diff", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(rowOf("only-left.db"));
    expect(desktop.readTextFile).not.toHaveBeenCalled();
  });

  it("binary file shows the Binary or non-text file empty state", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    desktop.readTextFile.mockRejectedValue("This file is not UTF-8 text.");
    fireEvent.click(rowOf("go.mod"));
    expect(await screen.findByText("Binary or non-text file")).toBeInTheDocument();
    expect(screen.getByText("Only text files can be merged line by line.")).toBeInTheDocument();
  });

  it("Save both writes both sides with their EOL and rescans", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    desktop.readTextFile.mockReset();
    desktop.readTextFile.mockResolvedValueOnce("a\r\n").mockResolvedValueOnce("b\r\n");
    fireEvent.click(rowOf("go.mod"));
    await screen.findByText("1 of 1 difference");
    desktop.scanFolder.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Save both" }));
    await waitFor(() => expect(desktop.scanFolder).toHaveBeenCalledTimes(2));
    expect(desktop.writeTextFile.mock.calls).toEqual([["/L", "go.mod", "a\r\n"], ["/R", "go.mod", "b\r\n"]]);
  });

  it("the file view has the same options as Text mode, without a second mode switch", async () => {
    await openFolders();
    fireEvent.click(rowOf("go.mod"));
    await lowerLoaded();
    const file = screen.getByTestId("diff-merge-file");
    for (const name of ["Ignore", "Highlight"]) expect(within(file).getByRole("combobox", { name })).toBeInTheDocument();
    expect(within(file).getByRole("switch", { name: "Sync scroll" })).toBeInTheDocument();
    expect(within(file).getByRole("button", { name: "Swap" })).toBeInTheDocument();
    expect(within(file).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(file).getByRole("button", { name: "Language of Original" })).toBeInTheDocument();
    expect(within(file).queryByRole("radiogroup", { name: "Mode" })).toBeNull();
  });

  it("Merge by hand in the menu loads the row it was opened from", async () => {
    const both = [f("go.mod", 5), f("other.txt", 5)];
    await openFolders(both, [f("go.mod", 6), f("other.txt", 6)]);
    await screen.findByRole("row", { name: /other\.txt/ });
    fireEvent.click(rowOf("go.mod"));
    await lowerLoaded();
    desktop.readTextFile.mockClear();
    fireEvent.contextMenu(rowOf("other.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Merge by hand below/ }));
    await waitFor(() => expect(desktop.readTextFile.mock.calls).toEqual([["/L", "other.txt"], ["/R", "other.txt"]]));
    await lowerLoaded();
  });

  it("an action never changes a selected row the filter has hidden", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(rowOf("go.mod"));
    await lowerLoaded();
    fireEvent.change(screen.getByPlaceholderText("Filter by name or path"), { target: { value: "api" } });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });
    fireEvent.change(screen.getByPlaceholderText("Filter by name or path"), { target: { value: "" } });
    expect(within(rowOf("go.mod")).getByTitle("Different, no action yet")).toBeInTheDocument();
  });

  it("opens the shortcuts panel with the folder keys", async () => {
    await openFolders();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(within(panel).getByText("Space")).toBeInTheDocument();
  });

  it("Refresh keeps the actions the user chose", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    fireEvent.click(rowOf("only-left.db"));
    fireEvent.keyDown(rowOf("only-left.db"), { key: "Delete" });
    desktop.scanFolder.mockClear();
    fireEvent.click(screen.getByTitle("Compare again"));
    await waitFor(() => expect(desktop.scanFolder).toHaveBeenCalledTimes(2));
    expect(within(await screen.findByRole("row", { name: /only-left\.db/ })).getByTitle("Ignored")).toBeInTheDocument();
  });
});

const REPORT = { copiedRight: ["only-left.db"], copiedLeft: ["api"], backedUp: [], journal: "/j", backupDir: null };

async function startMerge() {
  await openFolders();
  await screen.findByText("only-left.db");
  fireEvent.click(screen.getByText("Start merge (2)"));
  return screen.findByRole("dialog", { name: "Start merge" });
}

describe("Merge dialog and result", () => {
  it("confirms, merges, shows notice, undoes", async () => {
    desktop.applyFolderMerge.mockResolvedValue(REPORT);
    desktop.undoFolderMerge.mockResolvedValue({ restored: 1, removed: 1, unrestorable: [] });
    const dlg = await startMerge();
    expect(within(dlg).getByText("2 files will be written.")).toBeInTheDocument();
    expect(within(dlg).getByRole("checkbox", { name: "Back up files before replacing them" })).toBeChecked();
    expect(within(dlg).getByText("Copy to the right")).toBeInTheDocument();
    expect(within(dlg).getByText("Copy to the left")).toBeInTheDocument();
    expect(within(dlg).getByText("go.mod")).toBeInTheDocument();
    expect(within(dlg).getByText(/have no action yet|has no action yet/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
    expect(desktop.applyFolderMerge).toHaveBeenCalledWith(
      "/L",
      "/R",
      [{ path: "only-left.db", action: "toRight" }, { path: "api", action: "toLeft" }],
      true,
    );
    expect(await screen.findByText("Merged 2 items: 1 copied to the right, 1 copied to the left.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Start merge" })).not.toBeInTheDocument();
    await waitFor(() => expect(desktop.scanFolder).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole("button", { name: "Show backup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo merge" }));
    await waitFor(() => expect(desktop.undoFolderMerge).toHaveBeenCalledWith("/j"));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Merge undone."));
    await waitFor(() => expect(desktop.scanFolder).toHaveBeenCalledTimes(6));
    expect(screen.queryByText(/^Merged 2 items/)).not.toBeInTheDocument();
  });

  it("Ctrl+Enter opens the dialog; Escape cancels without writing", async () => {
    await openFolders();
    await screen.findByText("only-left.db");
    const row = rowOf("go.mod");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
    const dlg = await screen.findByRole("dialog", { name: "Start merge" });
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Start merge" })).not.toBeInTheDocument();
    expect(desktop.applyFolderMerge).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without writing", async () => {
    const dlg = await startMerge();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Start merge" })).not.toBeInTheDocument();
    expect(desktop.applyFolderMerge).not.toHaveBeenCalled();
  });

  it("warns about replacements, lists ignored files and passes the backup choice", async () => {
    desktop.applyFolderMerge.mockResolvedValue({ ...REPORT, copiedRight: ["go.mod"], copiedLeft: [] });
    await openFolders();
    await screen.findByText("only-left.db");
    const go = rowOf("go.mod");
    fireEvent.click(go);
    await lowerLoaded();
    fireEvent.keyDown(go, { key: "ArrowRight", ctrlKey: true, shiftKey: true });
    fireEvent.click(rowOf("api"));
    fireEvent.keyDown(rowOf("api"), { key: "Delete" });
    fireEvent.click(screen.getByText("Start merge (2)"));
    const dlg = await screen.findByRole("dialog", { name: "Start merge" });
    expect(within(dlg).getByText("2 files will be written. 1 existing file will be replaced.")).toBeInTheDocument();
    expect(within(dlg).getByText("replaces the right copy")).toBeInTheDocument();
    expect(within(dlg).getByText(/is ignored\./)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Back up files before replacing them" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
    expect(desktop.applyFolderMerge.mock.calls[0][3]).toBe(false);
    await screen.findByText(/^Merged /);
    await waitFor(() => expect(desktop.scanFolder).toHaveBeenCalledTimes(4));
  });

  it("Show backup reveals the backup folder", async () => {
    desktop.applyFolderMerge.mockResolvedValue({ ...REPORT, backedUp: ["go.mod"], backupDir: "/data/backups/1" });
    const dlg = await startMerge();
    fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show backup" }));
    expect(desktop.revealPath).toHaveBeenCalledWith("/data/backups/1");
  });

  it("undo with unrestorable files shows an error toast", async () => {
    desktop.applyFolderMerge.mockResolvedValue(REPORT);
    desktop.undoFolderMerge.mockResolvedValue({ restored: 0, removed: 0, unrestorable: ["a", "b"] });
    const dlg = await startMerge();
    fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo merge" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("2 files could not be restored because they were not backed up."));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("shows the backend's rejection as a toast and changes nothing else", async () => {
    desktop.applyFolderMerge.mockRejectedValue("Path escapes the folder.");
    const dlg = await startMerge();
    fireEvent.click(within(dlg).getByRole("button", { name: "Start merge" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Path escapes the folder."));
    expect(screen.queryByText(/^Merged /)).not.toBeInTheDocument();
    expect(desktop.scanFolder).toHaveBeenCalledTimes(2);
  });
});

describe("FolderTable", () => {
  it("renders only a window of rows past 2,000", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => {
      const path = `f${String(i).padStart(4, "0")}`;
      return makeRow({ path, left: f(path), right: null }, "left", defaultAction("left"));
    });
    render(
      <FolderTable
        groups={groupRows(rows)}
        selected={new Set()}
        onSelect={() => {}}
        onChip={() => {}}
        onCommand={() => {}}
      />,
    );
    const rendered = screen.getAllByRole("row").length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(300);
  });
});
