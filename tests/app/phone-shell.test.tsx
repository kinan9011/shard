import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";
import type { DesktopBridge } from "@/lib/desktop";
import { setViewport } from "../helpers/viewport";

const desktopMock = vi.hoisted(() => ({ bridge: null as DesktopBridge | null }));
vi.mock("@/lib/desktop", () => ({
  getDesktopBridge: () => desktopMock.bridge,
  saveFile: vi.fn(async () => true),
  listThemes: vi.fn(async () => ({ themes: [], errors: [] })),
  themeCatalog: vi.fn(async () => []),
}));

let restore = () => {};
beforeEach(() => {
  localStorage.setItem("shard-whats-new-seen-version", "2.0.0");
  localStorage.setItem("shard-first-run-done", "true");
});
afterEach(() => {
  restore();
  localStorage.clear();
  desktopMock.bridge = null;
});

const nav = () => within(screen.getByRole("navigation", { name: "Main" }));

describe("Phone shell (390 px wide)", () => {
  beforeEach(() => {
    restore = setViewport(390);
  });

  it("has a top bar and a bottom bar, and no sidebar or tab strip", () => {
    render(<Shard />);
    expect(nav().getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Search", "Plugins", "Settings"]) expect(nav().getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tools" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Open tools" })).toBeNull();
    expect(screen.getByTestId("phone-title")).toHaveTextContent("Shard");
    expect(document.querySelector('[data-phone="true"]')).not.toBeNull();
  });

  it("ignores a saved Sidebar layout: a phone always gets the Launcher", () => {
    localStorage.setItem("shard-layout", "sidebar");
    render(<Shard />);
    expect(document.querySelector('[data-layout="launcher"]')).not.toBeNull();
    // The saved choice stays for when the window is wide again.
    expect(localStorage.getItem("shard-layout")).toBe("sidebar");
  });

  it("opens Plugins and Settings from the bottom bar, and offers no keyboard shortcuts", async () => {
    render(<Shard />);
    fireEvent.click(nav().getByRole("button", { name: "Plugins" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByTestId("phone-title")).toHaveTextContent("Plugins");
    expect(nav().getByRole("button", { name: "Plugins" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(nav().getByRole("button", { name: "Settings" }));
    const sections = within(screen.getByRole("navigation", { name: "Settings sections" }));
    expect(sections.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
    expect(sections.queryByRole("button", { name: "Shortcuts" })).toBeNull();
    // The layout choice is not offered either.
    expect(screen.queryByRole("group", { name: "Layout" })).toBeNull();
  });

  it("opens a tool full screen with a back button, and lists open tools in a sheet", async () => {
    render(<Shard />);
    fireEvent.click(nav().getByRole("button", { name: "Search" }));
    const palette = await screen.findByRole("dialog", { name: "Command Palette" });
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "json viewer" } });
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("phone-title")).toHaveTextContent("JSON Viewer"));
    fireEvent.click(screen.getByRole("button", { name: "Open tools, 1" }));
    const sheet = screen.getByRole("dialog", { name: "Open tools" });
    expect(within(sheet).getByRole("button", { name: "JSON Viewer" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(screen.getByTestId("phone-title")).toHaveTextContent("Shard");
  });

  it("closes a tool from the sheet", async () => {
    render(<Shard />);
    fireEvent.click(nav().getByRole("button", { name: "Search" }));
    const palette = await screen.findByRole("dialog", { name: "Command Palette" });
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "regex" } });
    fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Open tools, 1" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Open tools" })).getByRole("button", { name: /^Close Regex/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Open tools/ })).toBeNull());
  });
});

describe("Desktop width", () => {
  beforeEach(() => {
    restore = setViewport(1200);
  });

  it("keeps the sidebar and has no phone bar", () => {
    render(<Shard />);
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(document.querySelector('[data-phone="true"]')).toBeNull();
  });
});

describe("The Android app", () => {
  it("is a phone even in a wide window, and none of the desktop-only features start", async () => {
    restore = setViewport(1200);
    const idle = { status: "idle" as const, currentVersion: "1.0.0" };
    const bridge = {
      platform: "android",
      getVersion: vi.fn(async () => "1.0.0"),
      getUpdateState: vi.fn(async () => idle),
      onUpdateState: vi.fn(() => () => {}),
      checkForUpdates: vi.fn(async () => idle),
      downloadUpdate: vi.fn(async () => true),
      installUpdate: vi.fn(async () => true),
      setGlobalShortcut: vi.fn(async () => null),
      setWindowTheme: vi.fn(async () => {}),
      writeToolManifest: vi.fn(async () => {}),
      setAutoUpdate: vi.fn(),
      onOpenCommandPalette: vi.fn(() => () => {}),
      onDeepLink: vi.fn(() => () => {}),
    };
    desktopMock.bridge = bridge as unknown as DesktopBridge;
    render(<Shard />);
    expect(nav().getByRole("button", { name: "Home" })).toBeInTheDocument();
    await waitFor(() => expect(bridge.getVersion).toHaveBeenCalled());
    // Deep links work on a phone.
    expect(bridge.onDeepLink).toHaveBeenCalled();
    await act(async () => {});
    for (const unwanted of ["setGlobalShortcut", "getUpdateState", "onUpdateState", "setAutoUpdate", "setWindowTheme", "writeToolManifest", "onOpenCommandPalette"] as const) {
      expect(bridge[unwanted], unwanted).not.toHaveBeenCalled();
    }
  });
});
