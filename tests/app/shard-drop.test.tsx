import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ bridge: null as unknown }));
vi.mock("@/lib/desktop", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/desktop")>()), getDesktopBridge: () => desktop.bridge }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<typeof import("sonner")>()), toast: toastMock }));

import Shard from "@/app/Shard";
import type { DesktopBridge } from "@/lib/desktop";

/** A drag event from the OS: only the types and files a file manager sends. */
function drag(type: "dragover" | "drop", data: { types?: string[]; files?: File[] } = {}, target: EventTarget = document.body) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { types: data.types ?? ["Files"], files: data.files ?? [], dropEffect: "none" } });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
  desktop.bridge = null;
  toastMock.mockReset();
});

afterEach(() => localStorage.clear());

describe("Shard file drops", () => {
  it("keeps the webview from opening a file dropped outside a drop zone, and stays quiet about it", () => {
    render(<Shard />);
    expect(drag("dragover").defaultPrevented).toBe(true);
    expect(drag("drop", { files: [new File(["%PDF"], "invoice.pdf")] }).defaultPrevented).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Install plugin" })).toBeNull();
  });

  it("points a plugin zip dropped outside the zone at Install plugin", async () => {
    render(<Shard />);
    expect(drag("drop", { files: [new File(["zip"], "plugin.zip")] }).defaultPrevented).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.mock.calls[0]!;
    expect(message).toBe("To install a plugin, drop it on Install plugin.");

    act(() => options.action.onClick());
    expect(await screen.findByRole("dialog", { name: "Install plugin" })).toBeInTheDocument();
  });

  it("leaves a drop that a drop zone already took, and drags that carry no file", () => {
    render(<Shard />);
    const zone = document.createElement("div");
    zone.addEventListener("drop", (event) => event.preventDefault());
    document.body.append(zone);
    drag("drop", { files: [new File(["x"], "plugin.zip")] }, zone);
    expect(toastMock).not.toHaveBeenCalled();
    expect(drag("drop", { types: ["text/plain"] }).defaultPrevented).toBe(false);
    zone.remove();
  });

  it("points a zip dropped natively (Linux) outside the zone at Install plugin, and ignores other files and drops on the zone", () => {
    let fileDrop: (paths: string[], x: number, y: number) => void = () => {};
    const idle = { status: "idle" as const, currentVersion: "1.0.0" };
    desktop.bridge = {
      platform: "linux",
      getVersion: vi.fn(async () => "1.0.0"),
      getUpdateState: vi.fn(async () => idle),
      onUpdateState: vi.fn(() => () => {}),
      checkForUpdates: vi.fn(async () => idle),
      downloadUpdate: vi.fn(async () => true),
      installUpdate: vi.fn(async () => true),
      onFileDrop: (callback: typeof fileDrop) => ((fileDrop = callback), () => {}),
    } satisfies DesktopBridge;
    render(<Shard />);
    const zone = document.createElement("div");
    zone.dataset.dropZone = "";
    document.body.append(zone);
    const at = vi.fn<(x: number, y: number) => Element | null>(() => document.body);
    document.elementFromPoint = at;

    act(() => fileDrop(["/home/u/invoice.pdf"], 5, 5));
    expect(toastMock).not.toHaveBeenCalled();
    at.mockReturnValue(zone);
    act(() => fileDrop(["/home/u/plugin.zip"], 5, 5));
    expect(toastMock).not.toHaveBeenCalled();
    at.mockReturnValue(document.body);
    act(() => fileDrop(["/home/u/plugin.zip"], 5, 5));
    expect(toastMock).toHaveBeenCalledTimes(1);
    zone.remove();
  });
});
