import { createRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { DiffPanes, type DiffPanesHandle, type PaneDoc } from "@/components/tools/diff-merge/DiffPanes";
import { DEFAULT_SETTINGS } from "@/utils/diff-merge/settings";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

type DropCallback = (paths: string[], x: number, y: number) => void;
const desktop = vi.hoisted(() => ({ callbacks: [] as DropCallback[], stop: vi.fn(), readTextFile: vi.fn() }));
vi.mock("@/lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop")>()),
  // Linux: the bridge hands the page the paths of a dropped file and the point it landed on.
  getDesktopBridge: () => ({
    onFileDrop: (callback: DropCallback) => {
      desktop.callbacks.push(callback);
      return desktop.stop;
    },
  }),
  readTextFile: desktop.readTextFile,
}));

const doc = (name: string, text: string): PaneDoc => ({ name, text, eol: "LF", language: null });
const empty = (): [PaneDoc, PaneDoc] => [doc("", ""), doc("", "")];

function setup() {
  const ref = createRef<DiffPanesHandle>();
  const utils = render(<DiffPanes ref={ref} settings={DEFAULT_SETTINGS} current={0} onCurrentChange={() => {}} onApplied={() => {}} onStateChange={() => {}} initial={empty()} />);
  return { ref, ...utils };
}

/** jsdom has no layout, so the element under the drop point is chosen by the test. */
const dropAt = (element: Element | null, paths: string[]) => {
  document.elementFromPoint = vi.fn(() => element);
  act(() => desktop.callbacks.forEach((callback) => callback(paths, 10, 10)));
};

beforeEach(() => {
  desktop.callbacks = [];
  desktop.stop.mockReset();
  desktop.readTextFile.mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => {
  // @ts-expect-error jsdom does not define it, so there is nothing to restore
  delete document.elementFromPoint;
});

describe("Diff & Merge: a file dropped natively (Linux)", () => {
  it("loads the file into the pane it landed on, reading it by folder and name", async () => {
    desktop.readTextFile.mockResolvedValue("hello\nworld\n");
    const { ref } = setup();
    dropAt(screen.getByTestId("pane-b"), ["/home/kinan/docs/notes.txt"]);
    // The text is in the editor at once, the name only after React commits the pane's meta: wait for both.
    await waitFor(() => {
      expect(ref.current!.getDocs()[1].text).toBe("hello\nworld\n");
      expect(ref.current!.getDocs()[1].name).toBe("notes.txt");
    });
    expect(desktop.readTextFile).toHaveBeenCalledWith("/home/kinan/docs", "notes.txt");
    expect(ref.current!.getDocs()[0].text).toBe("");
  });

  it("also lands on the other pane, and takes the first file of several", async () => {
    desktop.readTextFile.mockResolvedValue("x\n");
    const { ref } = setup();
    dropAt(screen.getByTestId("pane-a"), ["/tmp/one.txt", "/tmp/two.txt"]);
    await waitFor(() => expect(ref.current!.getDocs()[0].text).toBe("x\n"));
    expect(desktop.readTextFile).toHaveBeenCalledTimes(1);
    expect(desktop.readTextFile).toHaveBeenCalledWith("/tmp", "one.txt");
  });

  it("reads a file in the root folder from /", async () => {
    desktop.readTextFile.mockResolvedValue("r\n");
    setup();
    dropAt(screen.getByTestId("pane-a"), ["/top.txt"]);
    await waitFor(() => expect(desktop.readTextFile).toHaveBeenCalledWith("/", "top.txt"));
  });

  it("shows the app's own refusal and leaves the pane alone", async () => {
    desktop.readTextFile.mockRejectedValue("This file is larger than 5 MiB.");
    const { ref } = setup();
    dropAt(screen.getByTestId("pane-a"), ["/tmp/big.log"]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This file is larger than 5 MiB."));
    expect(ref.current!.getDocs()[0].text).toBe("");
  });

  it("ignores a drop that is not on a pane", () => {
    setup();
    dropAt(document.body, ["/tmp/a.txt"]);
    dropAt(null, ["/tmp/a.txt"]);
    expect(desktop.readTextFile).not.toHaveBeenCalled();
  });

  it("ignores a drop with no files", () => {
    setup();
    dropAt(screen.getByTestId("pane-a"), []);
    expect(desktop.readTextFile).not.toHaveBeenCalled();
  });

  it("leaves a pane of another Diff & Merge on the page to that one", async () => {
    desktop.readTextFile.mockResolvedValue("only second\n");
    const first = setup();
    const second = setup();
    // Both are mounted and listening. The drop is on the second one's pane.
    dropAt(screen.getAllByTestId("pane-a")[1], ["/tmp/s.txt"]);
    await waitFor(() => expect(second.ref.current!.getDocs()[0].text).toBe("only second\n"));
    expect(first.ref.current!.getDocs()[0].text).toBe("");
    expect(desktop.readTextFile).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the tool closes", () => {
    const { unmount } = setup();
    expect(desktop.stop).not.toHaveBeenCalled();
    unmount();
    expect(desktop.stop).toHaveBeenCalledTimes(1);
  });
});
