import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  desktopMock.bridge = null;
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("shard-first-run-done", "true");
});

const createBridge = (version: string, updateState: Awaited<ReturnType<DesktopBridge["getUpdateState"]>>) => {
  const bridge: DesktopBridge = {
    platform: "darwin",
    getVersion: vi.fn(async () => version),
    getUpdateState: vi.fn(async () => updateState),
    onUpdateState: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => updateState),
    downloadUpdate: vi.fn(async () => true),
    installUpdate: vi.fn(async () => true),
  };

  desktopMock.bridge = bridge;
  return bridge;
};

const setupMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("Shard updates", () => {
  it("shows the version and a pending update in the sidebar footer, and acts on it in Settings", async () => {
    setupMatchMedia();

    const bridge = createBridge("1.2.3", {
      status: "available",
      version: "1.3.0",
      currentVersion: "1.2.3",
    });

    render(<Shard />);

    expect(await screen.findByText("v1.2.3")).toBeInTheDocument();
    // The footer has no update button any more, only a pointer to Settings.
    expect(screen.queryByRole("button", { name: "Update to v1.3.0" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Version 1.3.0 is available." }));

    await waitFor(() => {
      expect(bridge.getVersion).toHaveBeenCalled();
      expect(bridge.getUpdateState).toHaveBeenCalled();
    });

    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update to v1.3.0" }));

    await waitFor(() => {
      expect(bridge.downloadUpdate).toHaveBeenCalled();
    });
  });

  it("checks for updates from Settings → General when none is pending", async () => {
    setupMatchMedia();
    const bridge = createBridge("1.2.3", { status: "idle", currentVersion: "1.2.3" });
    render(<Shard />);
    await screen.findByText("v1.2.3");
    expect(screen.queryByRole("button", { name: /^Version / })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByText("You have version 1.2.3.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));
    await waitFor(() => expect(bridge.checkForUpdates).toHaveBeenCalled());
  });

  it("shows what's new on first launch after a version bump and persists dismissal", async () => {
    setupMatchMedia();

    createBridge("1.0.0", { status: "not-available", currentVersion: "1.0.0" });

    const { unmount } = render(<Shard />);

    const dialog = await screen.findByRole("dialog", { name: "Shard v1.0.0" });

    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Highlights")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Shard now has plugins");

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Shard v1.0.0" })).not.toBeInTheDocument();
    });

    expect(localStorage.getItem("shard-whats-new-seen-version")).toBe("1.0.0");

    unmount();
    render(<Shard />);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Shard v1.0.0" })).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "What's new" })).toBeInTheDocument();
  });
});

it.each(["darwin", "win32"])("uses desktop tab shortcuts on %s without intercepting app switching", async (platform) => {
  setupMatchMedia();
  const bridge = createBridge("0.0.0", { status: "idle" });
  bridge.platform = platform;
  render(<Shard />);
  fireEvent.click(screen.getByRole("button", { name: "JSON Viewer", exact: true }));
  const input = await screen.findByRole("textbox", { name: "JSON Input" });
  fireEvent.change(input, { target: { value: '{"saved":true}' } });
  fireEvent.click(screen.getByRole("button", { name: "Home", exact: true }));
  // Open the tool from the sidebar search, so the test does not depend on the Quick Access order.
  fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "JWT Decoder" } });
  fireEvent.click(screen.getByRole("button", { name: "JWT Decoder", exact: true }));
  await screen.findByRole("tab", { name: "JWT Decoder", exact: true }, { timeout: 5000 });
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
  expect(screen.getByRole("tab", { name: "JSON Viewer", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("textbox", { name: "JSON Input" })).toHaveValue('{"saved":true}');
  fireEvent.keyDown(window, { key: "Tab", metaKey: true });
  expect(screen.getByRole("tab", { name: "JSON Viewer", exact: true })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(window, { key: "w", metaKey: platform === "darwin", ctrlKey: platform !== "darwin" });
  expect(screen.queryByRole("tab", { name: "JSON Viewer", exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "JWT Decoder", exact: true })).toHaveAttribute("aria-selected", "true");
});
