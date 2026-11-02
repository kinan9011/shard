import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import Shard from "@/app/Shard";
import type { DesktopBridge, UpdateState } from "@/lib/desktop";

const desktopMock = vi.hoisted(() => ({ bridge: null as DesktopBridge | null }));

vi.mock("@/lib/desktop", () => ({
  getDesktopBridge: () => desktopMock.bridge,
  saveFile: vi.fn(async () => true),
}));

/** The update controls live in Settings → General. */
const openGeneral = () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name: "General" }));
};

let pushState: (state: UpdateState) => void = () => {};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
  localStorage.setItem("shard-whats-new-seen-version", "2.1.1");
  localStorage.setItem("shard-first-run-done", "true");
  localStorage.setItem("shard-plugins-intro-seen", "true");
  const idle = { status: "idle" as const, currentVersion: "2.1.1" };
  desktopMock.bridge = {
    platform: "darwin",
    getVersion: vi.fn(async () => "2.1.1"),
    getUpdateState: vi.fn(async () => idle),
    onUpdateState: vi.fn((callback) => {
      pushState = callback;
      return () => {};
    }),
    checkForUpdates: vi.fn(async () => idle),
    downloadUpdate: vi.fn(async () => true),
    installUpdate: vi.fn(async () => true),
    setAutoUpdate: vi.fn(),
  };
});

afterEach(() => {
  localStorage.clear();
  desktopMock.bridge = null;
});

describe("Shard automatic updates", () => {
  it("turns automatic updates on by default and saves the switch", async () => {
    render(<Shard />);
    await waitFor(() => expect(desktopMock.bridge?.setAutoUpdate).toHaveBeenLastCalledWith(true));

    openGeneral();
    fireEvent.click(screen.getByRole("switch", { name: "Update automatically" }));

    await waitFor(() => expect(desktopMock.bridge?.setAutoUpdate).toHaveBeenLastCalledWith(false));
    expect(localStorage.getItem("shard-auto-update")).toBe("false");
  });

  it("keeps automatic updates off after a restart when the user turned them off", async () => {
    localStorage.setItem("shard-auto-update", "false");
    render(<Shard />);
    await waitFor(() => expect(desktopMock.bridge?.setAutoUpdate).toHaveBeenLastCalledWith(false));
    openGeneral();
    expect(screen.getByRole("switch", { name: "Update automatically" })).toHaveAttribute("aria-checked", "false");
  });

  it("announces a downloaded update once and restarts from the notice", async () => {
    render(
      <>
        <Shard />
        <Toaster />
      </>,
    );
    await waitFor(() => expect(desktopMock.bridge?.onUpdateState).toHaveBeenCalled());

    act(() => pushState({ status: "downloaded", version: "2.2.0", progress: 100 }));

    expect(await screen.findByText("Shard 2.2.0 is ready")).toBeInTheDocument();
    // The sidebar footer keeps a pointer to it, which opens Settings → General.
    fireEvent.click(screen.getByRole("button", { name: "Version 2.2.0 is ready. It installs when you quit Shard." }));
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(desktopMock.bridge?.installUpdate).toHaveBeenCalled();
  });
});
