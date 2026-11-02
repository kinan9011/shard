import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";
import type { DesktopBridge } from "@/lib/desktop";

const desktopMock = vi.hoisted(() => ({ bridge: null as DesktopBridge | null }));

vi.mock("@/lib/desktop", () => ({
  getDesktopBridge: () => desktopMock.bridge,
  saveFile: vi.fn(async () => true),
  listThemes: vi.fn(async () => ({ themes: [], errors: [] })),
  themeCatalog: vi.fn(async () => []),
}));

let openPalette: () => void = () => {};
let setGlobalShortcut: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
  localStorage.setItem("shard-whats-new-seen-version", "2.0.0");
  localStorage.setItem("shard-first-run-done", "true");
  const idle = { status: "idle" as const, currentVersion: "2.0.0" };
  setGlobalShortcut = vi.fn(async () => null);
  desktopMock.bridge = {
    platform: "darwin",
    getVersion: vi.fn(async () => "2.0.0"),
    getUpdateState: vi.fn(async () => idle),
    onUpdateState: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => idle),
    downloadUpdate: vi.fn(async () => true),
    installUpdate: vi.fn(async () => true),
    setGlobalShortcut,
    onOpenCommandPalette: vi.fn((callback: () => void) => {
      openPalette = callback;
      return () => {};
    }),
  };
});

afterEach(() => {
  localStorage.clear();
  desktopMock.bridge = null;
});

describe("Shard global shortcut", () => {
  it("registers Ctrl+Shift+Space by default and pauses it while a combination is recorded", async () => {
    render(<Shard />);
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith("Control+Shift+Space"));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name: "General" }));
    expect(screen.getByText("Show Shard")).toBeInTheDocument();
    // Nothing is paused just by looking at the setting.
    expect(setGlobalShortcut).toHaveBeenLastCalledWith("Control+Shift+Space");

    fireEvent.click(screen.getByRole("button", { name: "Record Show Shard" }));
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith(null));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith("Control+Shift+Space"));

    fireEvent.click(screen.getByRole("switch", { name: "Use the Show Shard shortcut" }));
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith(null));
    expect(JSON.parse(localStorage.getItem("shard-global-shortcut-v1") ?? "{}")).toMatchObject({ enabled: false });
  });

  it("resumes the shortcut when the user leaves General in the middle of recording", async () => {
    render(<Shard />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const nav = within(screen.getByRole("navigation", { name: "Settings sections" }));
    fireEvent.click(nav.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Show Shard" }));
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith(null));
    fireEvent.click(nav.getByRole("button", { name: "About" }));
    await waitFor(() => expect(setGlobalShortcut).toHaveBeenLastCalledWith("Control+Shift+Space"));
  });

  it("opens the command palette when the tray menu or shortcut asks for it", async () => {
    render(<Shard />);
    await waitFor(() => expect(desktopMock.bridge?.onOpenCommandPalette).toHaveBeenCalled());
    act(() => openPalette());
    expect(await screen.findByPlaceholderText("Search tools...")).toBeInTheDocument();
  });
});
