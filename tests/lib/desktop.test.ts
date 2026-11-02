import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
  getVersion: vi.fn(async () => "1.3.0"),
  platform: vi.fn(() => "macos"),
  openUrl: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
  relaunch: vi.fn(async () => {}),
  check: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauri.getVersion }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: tauri.platform }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: tauri.openUrl,
  revealItemInDir: tauri.revealItemInDir,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauri.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauri.check }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

const blobOf = (bytes: number[]) =>
  ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as Blob;

const loadDesktop = async () => {
  vi.resetModules();
  return import("@/lib/desktop");
};

beforeEach(() => {
  vi.stubEnv("DEV", false);
  tauri.isTauri.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getDesktopBridge", () => {
  it("returns null outside the desktop runtime", async () => {
    tauri.isTauri.mockReturnValue(false);
    const { getDesktopBridge } = await loadDesktop();

    expect(getDesktopBridge()).toBeNull();
  });

  it("maps the OS platform to Node-style names", async () => {
    tauri.platform.mockReturnValue("windows");
    const { getDesktopBridge } = await loadDesktop();

    expect(getDesktopBridge()?.platform).toBe("win32");
  });

  it("checks, downloads, and installs an available update when updating by hand", async () => {
    const update = {
      version: "1.4.0",
      download: vi.fn(async (onEvent: (event: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 100 } });
        onEvent({ event: "Finished" });
      }),
      install: vi.fn(async () => {}),
    };
    tauri.check.mockResolvedValue(update);

    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;
    bridge.setAutoUpdate?.(false);
    const states: string[] = [];
    bridge.onUpdateState((state) => states.push(`${state.status}:${state.progress ?? ""}`));

    await expect(bridge.checkForUpdates()).resolves.toEqual({
      status: "available",
      version: "1.4.0",
      currentVersion: "1.3.0",
    });

    await expect(bridge.downloadUpdate()).resolves.toBe(true);
    await expect(bridge.installUpdate()).resolves.toBe(true);

    expect(states).toEqual([
      "checking:",
      "available:",
      "downloading:0",
      "downloading:50",
      "downloaded:100",
    ]);
    expect(update.install).toHaveBeenCalled();
    expect(tauri.relaunch).toHaveBeenCalled();
  });

  it("downloads an update in the background and tells the shell it is ready", async () => {
    const update = { version: "1.4.0", download: vi.fn(async () => {}), install: vi.fn(async () => {}) };
    tauri.check.mockResolvedValue(update);
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;

    await bridge.checkForUpdates();

    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("set_update_ready", { ready: true }));
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled();
    // A manual download after the automatic one does not download again.
    await expect(bridge.downloadUpdate()).resolves.toBe(true);
    expect(update.download).toHaveBeenCalledTimes(1);
  });

  it("does not download in the background when automatic updates are off", async () => {
    const update = { version: "1.4.0", download: vi.fn(async () => {}), install: vi.fn(async () => {}) };
    tauri.check.mockResolvedValue(update);
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;
    bridge.setAutoUpdate?.(false);

    await bridge.checkForUpdates();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(update.download).not.toHaveBeenCalled();
    // Turning it back on downloads the update that was found.
    bridge.setAutoUpdate?.(true);
    await vi.waitFor(() => expect(update.download).toHaveBeenCalledTimes(1));
  });

  it("checks again every six hours while the app runs", async () => {
    vi.useFakeTimers();
    try {
      tauri.check.mockResolvedValue(null);
      const { getDesktopBridge, UPDATE_CHECK_INTERVAL_MS } = await loadDesktop();
      await getDesktopBridge()!.getUpdateState();

      await vi.advanceTimersByTimeAsync(15000);
      expect(tauri.check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
      expect(tauri.check).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
      expect(tauri.check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("installs a downloaded update when the shell reports a quit, then quits", async () => {
    const update = { version: "1.4.0", download: vi.fn(async () => {}), install: vi.fn(async () => {}) };
    tauri.check.mockResolvedValue(update);
    let onQuit: (() => Promise<void>) | undefined;
    tauri.listen.mockImplementation(async (event: string, handler: () => Promise<void>) => {
      if (event === "install-update-and-quit") onQuit = handler;
      return () => {};
    });
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;
    await bridge.getUpdateState();
    await bridge.checkForUpdates();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("set_update_ready", { ready: true }));

    await onQuit!();

    expect(update.install).toHaveBeenCalled();
    expect(tauri.invoke).toHaveBeenLastCalledWith("quit_now");
    expect(tauri.relaunch).not.toHaveBeenCalled();
  });

  it("still quits when installing on quit fails", async () => {
    const update = { version: "1.4.0", download: vi.fn(async () => {}), install: vi.fn(async () => { throw new Error("disk full"); }) };
    tauri.check.mockResolvedValue(update);
    let onQuit: (() => Promise<void>) | undefined;
    tauri.listen.mockImplementation(async (event: string, handler: () => Promise<void>) => {
      if (event === "install-update-and-quit") onQuit = handler;
      return () => {};
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;
    await bridge.getUpdateState();
    await bridge.checkForUpdates();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("set_update_ready", { ready: true }));

    await onQuit!();

    expect(tauri.invoke).toHaveBeenLastCalledWith("quit_now");
  });

  it("reports when no update is available", async () => {
    tauri.check.mockResolvedValue(null);
    const { getDesktopBridge } = await loadDesktop();

    await expect(getDesktopBridge()!.checkForUpdates()).resolves.toMatchObject({
      status: "not-available",
    });
    await expect(getDesktopBridge()!.downloadUpdate()).resolves.toBe(false);
  });

  it("reports update check errors", async () => {
    tauri.check.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getDesktopBridge } = await loadDesktop();

    await expect(getDesktopBridge()!.checkForUpdates()).resolves.toMatchObject({
      status: "error",
      message: "offline",
    });
  });

  it("passes a timeout to the update check", async () => {
    tauri.check.mockResolvedValue(null);
    const { getDesktopBridge } = await loadDesktop();

    await getDesktopBridge()!.checkForUpdates();

    expect(tauri.check).toHaveBeenCalledWith({ timeout: 30000 });
  });

  it("does not start a new check while an update downloads", async () => {
    let finishDownload = () => {};
    const update = {
      version: "1.4.0",
      download: vi.fn(() => new Promise<void>((resolve) => (finishDownload = resolve))),
      install: vi.fn(async () => {}),
    };
    tauri.check.mockResolvedValue(update);
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;

    await bridge.checkForUpdates();
    const download = bridge.downloadUpdate();

    await expect(bridge.checkForUpdates()).resolves.toMatchObject({ status: "downloading" });
    expect(tauri.check).toHaveBeenCalledTimes(1);

    finishDownload();
    await download;
    await expect(bridge.checkForUpdates()).resolves.toMatchObject({ status: "downloaded" });
    await expect(bridge.installUpdate()).resolves.toBe(true);
    expect(update.install).toHaveBeenCalled();
  });

  it("reports download errors and rethrows them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tauri.check.mockResolvedValue({
      version: "1.4.0",
      download: vi.fn(async () => {
        throw new Error("connection reset");
      }),
      install: vi.fn(),
    });
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;

    await bridge.checkForUpdates();

    await expect(bridge.downloadUpdate()).rejects.toThrow("connection reset");
    await expect(bridge.getUpdateState()).resolves.toMatchObject({
      status: "error",
      message: "connection reset",
    });
  });

  it("does not install or relaunch without a pending update", async () => {
    tauri.check.mockResolvedValue(null);
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;

    await expect(bridge.installUpdate()).resolves.toBe(false);
    expect(tauri.relaunch).not.toHaveBeenCalled();
  });

  it("does not relaunch when the install fails", async () => {
    const update = {
      version: "1.4.0",
      download: vi.fn(async () => {}),
      install: vi.fn(async () => {
        throw new Error("install failed");
      }),
    };
    tauri.check.mockResolvedValue(update);
    const { getDesktopBridge } = await loadDesktop();
    const bridge = getDesktopBridge()!;

    await bridge.checkForUpdates();
    await bridge.downloadUpdate();

    await expect(bridge.installUpdate()).rejects.toThrow("install failed");
    expect(tauri.relaunch).not.toHaveBeenCalled();
  });

  it("disables updates in development builds", async () => {
    vi.stubEnv("DEV", true);
    const { getDesktopBridge } = await loadDesktop();

    await expect(getDesktopBridge()!.getUpdateState()).resolves.toMatchObject({
      status: "unsupported",
    });
    await expect(getDesktopBridge()!.checkForUpdates()).resolves.toMatchObject({
      status: "unsupported",
    });
    expect(tauri.check).not.toHaveBeenCalled();
  });
});

describe("saveFile", () => {
  it("sends the file bytes and encoded name to the save_file command", async () => {
    tauri.invoke.mockResolvedValue("/tmp/qr code.png");
    const { saveFile } = await loadDesktop();

    await expect(saveFile(blobOf([1, 2, 3]), "qr code.png")).resolves.toBe(true);

    const [command, body, options] = tauri.invoke.mock.calls[0];
    expect(command).toBe("save_file");
    expect(Array.from(body as Uint8Array)).toEqual([1, 2, 3]);
    expect(options).toEqual({ headers: { "x-file-name": "qr%20code.png" } });
  });

  it("returns false when the user cancels the dialog", async () => {
    tauri.invoke.mockResolvedValue(null);
    const { saveFile } = await loadDesktop();

    await expect(saveFile(blobOf([120]), "a.txt")).resolves.toBe(false);
  });

  it("falls back to an anchor download in the browser", async () => {
    tauri.isTauri.mockReturnValue(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { saveFile } = await loadDesktop();

    await expect(saveFile(new Blob(["x"]), "a.txt")).resolves.toBe(true);
    expect(click).toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("installExternalLinkHandler", () => {
  it("opens external links in the system browser", async () => {
    const { installExternalLinkHandler } = await loadDesktop();
    const uninstall = installExternalLinkHandler();

    const external = document.createElement("a");
    external.href = "https://example.com/docs";
    const internal = document.createElement("a");
    internal.href = "#section";
    document.body.append(external, internal);

    const externalEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    external.dispatchEvent(externalEvent);
    const internalEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    internal.dispatchEvent(internalEvent);

    expect(externalEvent.defaultPrevented).toBe(true);
    expect(internalEvent.defaultPrevented).toBe(false);
    expect(tauri.openUrl).toHaveBeenCalledTimes(1);
    expect(tauri.openUrl).toHaveBeenCalledWith("https://example.com/docs");

    uninstall();
    external.remove();
    internal.remove();
  });
});

describe("folder bridge", () => {
  it("folder bridge maps to commands", async () => {
    const d = await loadDesktop();
    tauri.invoke.mockResolvedValue([]);
    await d.scanFolder("/a");
    expect(tauri.invoke).toHaveBeenCalledWith("scan_folder", { root: "/a" });
    await d.applyFolderMerge("/l", "/r", [{ path: "x", action: "toRight" }], true);
    expect(tauri.invoke).toHaveBeenCalledWith("apply_folder_merge", {
      leftRoot: "/l",
      rightRoot: "/r",
      ops: [{ path: "x", action: "ToRight" }],
      backup: true,
    });
    await d.applyFolderMerge("/l", "/r", [{ path: "y", action: "toLeft" }], false);
    expect(tauri.invoke).toHaveBeenLastCalledWith("apply_folder_merge", {
      leftRoot: "/l",
      rightRoot: "/r",
      ops: [{ path: "y", action: "ToLeft" }],
      backup: false,
    });
  });

  it("passes the other folder commands their camelCase arguments", async () => {
    const d = await loadDesktop();
    tauri.invoke.mockResolvedValue("ok");
    await d.pickFolder();
    expect(tauri.invoke).toHaveBeenCalledWith("pick_folder");
    await d.compareContents("/l", "/r", ["a"]);
    expect(tauri.invoke).toHaveBeenCalledWith("compare_contents", { leftRoot: "/l", rightRoot: "/r", paths: ["a"] });
    await d.readTextFile("/l", "a");
    expect(tauri.invoke).toHaveBeenCalledWith("read_text_file", { root: "/l", path: "a" });
    await d.writeTextFile("/l", "a", "text");
    expect(tauri.invoke).toHaveBeenCalledWith("write_text_file", { root: "/l", path: "a", contents: "text" });
    await d.undoFolderMerge("/j/journal.json");
    expect(tauri.invoke).toHaveBeenCalledWith("undo_folder_merge", { journal: "/j/journal.json" });
    await d.revealPath("/l/a");
    expect(tauri.revealItemInDir).toHaveBeenCalledWith("/l/a");
  });

  it("returns what the backend returns and lets its error text through", async () => {
    const d = await loadDesktop();
    tauri.invoke.mockResolvedValueOnce("/picked");
    expect(await d.pickFolder()).toBe("/picked");
    tauri.invoke.mockRejectedValueOnce("This file is not UTF-8 text.");
    await expect(d.readTextFile("/l", "a")).rejects.toBe("This file is not UTF-8 text.");
  });

  it("folder bridge refuses outside the desktop app", async () => {
    tauri.isTauri.mockReturnValue(false);
    const d = await loadDesktop();
    expect(d.isDesktop()).toBe(false);
    await expect(d.scanFolder("/a")).rejects.toThrow("Folder compare needs the desktop app.");
    await expect(d.pickFolder()).rejects.toThrow("Folder compare needs the desktop app.");
    await expect(d.revealPath("/a")).rejects.toThrow("Folder compare needs the desktop app.");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
