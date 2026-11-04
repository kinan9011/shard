import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { platform as getOsPlatform } from "@tauri-apps/plugin-os";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isMobileApp } from "@/lib/platform";
import type { UserTheme } from "@/utils/theme";
import type { ToolManifest } from "@/utils/tool-manifest";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: number;
  message?: string;
  currentVersion?: string;
}

export interface DesktopBridge {
  /** Node-style platform name: "darwin", "win32", or "linux". */
  platform: string;
  getVersion: () => Promise<string>;
  getUpdateState: () => Promise<UpdateState>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<boolean>;
  /**
   * Sets the native window appearance. The macOS sidebar material follows it,
   * so it must match the app theme. Pass null to follow the system.
   */
  setWindowTheme?: (theme: "light" | "dark" | null) => Promise<void>;
  /** Zooms the whole webview, plugin frames included. Resolves to false where the platform cannot (a phone). */
  setZoom?: (factor: number) => Promise<boolean>;
  /**
   * Calls back with each shard:// link: the one that launched the app, then any that
   * arrive while it runs. Returns a function that stops listening.
   */
  onDeepLink?: (callback: (url: string) => void) => () => void;
  /** Writes the tool list that launchers such as Raycast read. */
  writeToolManifest?: (manifest: ToolManifest) => Promise<void>;
  /**
   * Registers the system-wide shortcut (an accelerator such as "Command+Shift+Space"), or turns
   * it off with null. Resolves to an error message when the system refuses it, otherwise null.
   */
  setGlobalShortcut?: (accelerator: string | null) => Promise<string | null>;
  /** Calls back when the tray menu or the global shortcut asks for the command palette. */
  onOpenCommandPalette?: (callback: () => void) => () => void;
  /**
   * Calls back with the paths of files dropped on the window and the point they landed at (CSS px).
   * Only where the window takes drops natively (Linux). Elsewhere a page gets the drop as a DOM event.
   */
  onFileDrop?: (callback: (paths: string[], x: number, y: number) => void) => () => void;
  /**
   * Turns automatic updating on or off. When on, the app downloads updates in the background
   * and installs a downloaded update when it quits.
   */
  setAutoUpdate?: (enabled: boolean) => void;
}

const UPDATE_CHECK_DELAY_MS = 15000;
/** The app can stay open for days in the menu bar, so it checks again while it runs. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** The shell sends this when the user quits with a downloaded update; see main.rs. */
const INSTALL_ON_QUIT_EVENT = "install-update-and-quit";
const UPDATE_CHECK_TIMEOUT_MS = 30000;

function toNodePlatform(osPlatform: string): string {
  if (osPlatform === "macos") {
    return "darwin";
  }

  if (osPlatform === "windows") {
    return "win32";
  }

  return osPlatform;
}

function createTauriBridge(): DesktopBridge {
  const isDev = import.meta.env.DEV;
  const listeners = new Set<(state: UpdateState) => void>();
  let pendingUpdate: Update | null = null;
  let updateCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  let updateState: UpdateState = { status: isDev ? "unsupported" : "idle" };
  let autoUpdate = true;
  let installOnQuitListening = false;

  const setUpdateState = (nextState: UpdateState) => {
    updateState = nextState;
    listeners.forEach((listener) => listener(updateState));
  };

  const withCurrentVersion = async (): Promise<UpdateState> => ({
    ...updateState,
    currentVersion: await getVersion(),
  });

  const runUpdateCheck = async (): Promise<UpdateState> => {
    if (isDev) {
      setUpdateState({
        status: "unsupported",
        message: "Update checks are disabled in development builds.",
      });
      return withCurrentVersion();
    }

    // A new check would drop the update that is in progress or ready to install.
    if (["checking", "downloading", "downloaded"].includes(updateState.status)) {
      return withCurrentVersion();
    }

    setUpdateState({ status: "checking" });

    try {
      pendingUpdate = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      setUpdateState(
        pendingUpdate
          ? { status: "available", version: pendingUpdate.version }
          : { status: "not-available" },
      );
      if (pendingUpdate && autoUpdate) {
        // Download in the background; the user only restarts, or the update installs on quit.
        void downloadUpdate().catch(() => {});
      }
    } catch (error) {
      console.error("Update check failed:", error);
      setUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : String(error ?? "Unable to check for updates."),
      });
    }

    return withCurrentVersion();
  };

  const scheduleUpdateCheck = () => {
    if (isDev || updateCheckTimeout) {
      return;
    }

    // Let the renderer settle before starting network/update work, then check again
    // periodically while the app stays open.
    updateCheckTimeout = setTimeout(() => {
      void runUpdateCheck();
      setInterval(() => void runUpdateCheck(), UPDATE_CHECK_INTERVAL_MS);
    }, UPDATE_CHECK_DELAY_MS);
    listenForInstallOnQuit();
  };

  // When the user quits with a downloaded update, install it before the app exits. The shell
  // waits for this and exits by itself after a timeout, so a failed install never blocks quitting.
  const listenForInstallOnQuit = () => {
    if (installOnQuitListening) return;
    installOnQuitListening = true;
    listen(INSTALL_ON_QUIT_EVENT, async () => {
      try {
        if (pendingUpdate && updateState.status === "downloaded") await pendingUpdate.install();
      } catch (error) {
        console.error("Installing the update on quit failed:", error);
      } finally {
        try {
          await invoke("quit_now");
        } catch {
          // The shell's timeout quits the app anyway.
        }
      }
    }).catch((error) => console.error("Failed to listen for quit:", error));
  };

  const downloadUpdate = async () => {
    if (isDev || !pendingUpdate) {
      if (isDev) {
        setUpdateState({
          status: "unsupported",
          message: "Updates are disabled in development builds.",
        });
      }
      return false;
    }
    if (updateState.status === "downloading" || updateState.status === "downloaded") return true;

    let contentLength = 0;
    let downloaded = 0;
    let lastEmit = 0;

    setUpdateState({ ...updateState, status: "downloading", progress: 0 });

    try {
      await pendingUpdate.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          // ponytail: ~10 updates/s; each one re-renders the app shell. The final state is set after download().
          const now = Date.now();
          if (now - lastEmit < 100) return;
          lastEmit = now;
          setUpdateState({
            ...updateState,
            status: "downloading",
            progress: contentLength ? (downloaded / contentLength) * 100 : undefined,
          });
        }
      });
    } catch (error) {
      console.error("Update download failed:", error);
      setUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : String(error ?? "Unable to download the update."),
      });
      throw error;
    }

    setUpdateState({ status: "downloaded", version: pendingUpdate.version, progress: 100 });
    // Tell the shell, so quitting installs the update.
    try {
      await invoke("set_update_ready", { ready: true });
    } catch (error) {
      console.error("Could not mark the update as ready to install on quit:", error);
    }
    return true;
  };

  const setWindowTheme = async (theme: "light" | "dark" | null) => {
    try {
      await invoke("set_window_theme", { theme });
    } catch (error) {
      console.error("Failed to set the window theme:", error);
    }
  };

  const setZoom = async (factor: number) => {
    try {
      await getCurrentWebview().setZoom(factor);
      return true;
    } catch (error) {
      console.error("Failed to zoom the webview:", error);
      return false;
    }
  };

  const onDeepLink = (callback: (url: string) => void) => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const deliver = (urls: string[] | null) => {
      if (active) urls?.forEach(callback);
    };
    getCurrentDeepLinks().then(deliver).catch(() => {});
    onOpenUrl(deliver)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error) => console.error("Failed to listen for links:", error));
    return () => {
      active = false;
      unlisten?.();
    };
  };

  const nodePlatform = toNodePlatform(getOsPlatform());

  // Linux only (tauri.linux.conf.json): WebKitGTK gives a page no File and no path for a file dragged from a file manager,
  // so the window hands the drop to Tauri, which sends the real paths and the point where it landed.
  // ponytail: the point is in CSS px on Linux. Divide by devicePixelRatio before turning native drag-drop on elsewhere.
  const onFileDrop = (callback: (paths: string[], x: number, y: number) => void) => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<{ paths: string[]; position: { x: number; y: number } }>("tauri://drag-drop", ({ payload }) => {
      if (active) callback(payload.paths, payload.position.x, payload.position.y);
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error) => console.error("Failed to listen for dropped files:", error));
    return () => {
      active = false;
      unlisten?.();
    };
  };

  const writeToolManifest = async (manifest: ToolManifest) => {
    try {
      await invoke("write_tool_manifest", { manifest });
    } catch (error) {
      console.error("Failed to write the tool list for launchers:", error);
    }
  };

  const setGlobalShortcut = async (accelerator: string | null) => {
    try {
      await invoke("set_global_shortcut", { accelerator });
      return null;
    } catch (error) {
      return String(error);
    }
  };

  const onOpenCommandPalette = (callback: () => void) => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("open-command-palette", () => {
      if (active) callback();
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error) => console.error("Failed to listen for the command palette event:", error));
    return () => {
      active = false;
      unlisten?.();
    };
  };

  return {
    setWindowTheme,
    setZoom,
    setGlobalShortcut,
    onOpenCommandPalette,
    onFileDrop: nodePlatform === "linux" ? onFileDrop : undefined,
    writeToolManifest,
    onDeepLink,
    platform: nodePlatform,
    getVersion,
    getUpdateState: async () => {
      scheduleUpdateCheck();
      return withCurrentVersion();
    },
    onUpdateState: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    checkForUpdates: runUpdateCheck,
    downloadUpdate,
    setAutoUpdate: (enabled: boolean) => {
      autoUpdate = enabled;
      if (enabled && updateState.status === "available") void downloadUpdate().catch(() => {});
    },
    installUpdate: async () => {
      if (isDev || !pendingUpdate) {
        return false;
      }

      await pendingUpdate.install();
      await relaunch();
      return true;
    },
  };
}

let bridge: DesktopBridge | null | undefined;

/** Returns the desktop runtime bridge, or `null` when the app runs in a plain browser. */
export function getDesktopBridge(): DesktopBridge | null {
  if (bridge === undefined) {
    bridge = isTauri() ? createTauriBridge() : null;
  }

  return bridge;
}

/**
 * Reads the clipboard as text. The desktop webview (WebKitGTK especially) refuses
 * navigator.clipboard.readText(), so the desktop app reads it through the Tauri plugin.
 */
export async function readClipboardText(): Promise<string> {
  if (!isTauri()) return navigator.clipboard.readText();
  const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
  return readText();
}

/** Writes text to the clipboard. The desktop app uses the Tauri plugin, which also works while a plugin frame has focus. */
export async function writeClipboardText(text: string): Promise<void> {
  if (!isTauri()) return navigator.clipboard.writeText(text);
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  return writeText(text);
}

/**
 * Saves a file to disk. The desktop app shows a native save dialog.
 * A browser falls back to an anchor download.
 * Returns false when the user cancels the save dialog.
 */
export async function saveFile(data: Blob, fileName: string): Promise<boolean> {
  // A phone has no save dialog: the webview downloads the file.
  if (!isTauri() || isMobileApp()) {
    const downloadUrl = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);
    return true;
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const savedPath = await invoke<string | null>("save_file", bytes, {
    headers: { "x-file-name": encodeURIComponent(fileName) },
  });

  return savedPath !== null;
}

// Folder compare (Diff & Merge, Folders mode). The Rust side, src-tauri/src/folder_compare.rs,
// confines every path to its root. Errors from it arrive as plain strings.

export interface FolderEntry {
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export interface FolderMergeReport {
  copiedRight: string[];
  copiedLeft: string[];
  backedUp: string[];
  journal: string;
  backupDir: string | null;
}

export interface FolderUndoReport {
  restored: number;
  removed: number;
  unrestorable: string[];
}

export const isDesktop = (): boolean => isTauri();

function requireDesktop(): void {
  if (!isTauri()) {
    throw new Error("Folder compare needs the desktop app.");
  }
}

/** Asks for a folder with the native dialog. Resolves to null when the user cancels. */
export async function pickFolder(): Promise<string | null> {
  requireDesktop();
  return invoke<string | null>("pick_folder");
}

export async function scanFolder(root: string): Promise<FolderEntry[]> {
  requireDesktop();
  return invoke<FolderEntry[]>("scan_folder", { root });
}

/** For each path, whether the file has the same bytes under both roots. */
export async function compareContents(leftRoot: string, rightRoot: string, paths: string[]): Promise<boolean[]> {
  requireDesktop();
  return invoke<boolean[]>("compare_contents", { leftRoot, rightRoot, paths });
}

export async function readTextFile(root: string, path: string): Promise<string> {
  requireDesktop();
  return invoke<string>("read_text_file", { root, path });
}

export async function writeTextFile(root: string, path: string, contents: string): Promise<void> {
  requireDesktop();
  await invoke("write_text_file", { root, path, contents });
}

/** Copies the listed files between the roots, optionally backing up what it replaces. */
export async function applyFolderMerge(
  leftRoot: string,
  rightRoot: string,
  ops: { path: string; action: "toRight" | "toLeft" }[],
  backup: boolean,
): Promise<FolderMergeReport> {
  requireDesktop();
  // The Rust enum's variant names are the wire values.
  const wireOps = ops.map(({ path, action }) => ({ path, action: action === "toRight" ? "ToRight" : "ToLeft" }));
  return invoke<FolderMergeReport>("apply_folder_merge", { leftRoot, rightRoot, ops: wireOps, backup });
}

export async function undoFolderMerge(journal: string): Promise<FolderUndoReport> {
  requireDesktop();
  return invoke<FolderUndoReport>("undo_folder_merge", { journal });
}

/** Shows a file or folder in the system file manager. */
export async function revealPath(path: string): Promise<void> {
  requireDesktop();
  await revealItemInDir(path);
}

export interface UserThemeList {
  themes: UserTheme[];
  /** `file.json: reason`, one per file in the themes folder that is not usable. */
  errors: string[];
}

/** The theme files of the user. Empty in the browser preview, which has no folder. */
export async function listThemes(): Promise<UserThemeList> {
  return isTauri() ? invoke<UserThemeList>("theme_list") : { themes: [], errors: [] };
}

/** Asks for a theme file and adds it. Resolves to null when the user cancels; rejects with the reason a file is refused. */
export async function importTheme(): Promise<UserTheme | null> {
  if (!isTauri()) {
    throw new Error("Custom themes need the desktop app.");
  }
  return invoke<UserTheme | null>("theme_import");
}

/** A theme a repository lists, as `theme_catalog` returns it. */
export interface ThemeCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  repo: string;
  repoName: string;
}

/** The themes of the enabled repositories, from their last sync. Empty in the browser preview. */
export async function themeCatalog(): Promise<ThemeCatalogEntry[]> {
  return isTauri() ? invoke<ThemeCatalogEntry[]>("theme_catalog") : [];
}

/** Downloads, checks and adds a repository's theme. Installing an installed one updates it. Rejects with the reason. */
export async function installTheme(repo: string, id: string): Promise<UserTheme> {
  return invoke<UserTheme>("theme_install", { repo, id });
}

/** A repository's theme as it would be installed, checked but not saved: for the swatches. */
export async function previewTheme(repo: string, id: string): Promise<UserTheme> {
  return invoke<UserTheme>("theme_preview", { repo, id });
}

/** Saves a theme made in the app. `overwrite` replaces the user's own file of that id, never one a repository installed. */
export async function saveTheme(theme: UserTheme, overwrite: boolean): Promise<UserTheme> {
  return invoke<UserTheme>("theme_save", { theme, overwrite });
}

export async function removeTheme(id: string): Promise<void> {
  await invoke("theme_remove", { id });
}

/** Shows the themes folder in the system file manager. */
export async function openThemesFolder(): Promise<void> {
  requireDesktop();
  await invoke("theme_open_dir");
}

/** Wipes all Shard data and restarts. The browser preview clears its storage and reloads. */
export async function resetAppData(): Promise<void> {
  if (isTauri()) {
    // Files first: if this fails nothing has been cleared and the caller can say why.
    await invoke("reset_app_data");
  }
  // The webview's own storage goes last, so it is empty even where Rust could not delete a locked file.
  localStorage.clear();
  sessionStorage.clear();
  // Fonts the user added live in IndexedDB. A blocked delete (another connection open) is not worth stopping the reset for.
  try {
    indexedDB.deleteDatabase("shard-fonts");
  } catch {
    /* no IndexedDB here */
  }
  // A phone has no restart command: reloading the webview starts the app over from the empty storage.
  if (isTauri() && !isMobileApp()) {
    await relaunch();
  } else {
    location.reload();
  }
}

/** Opens http(s) and mailto links in the system browser instead of the app window. */
export function installExternalLinkHandler(root: Document = document): () => void {
  if (!isTauri()) {
    return () => {};
  }

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) {
      return;
    }

    const url = new URL(anchor.href);
    if (!/^(https?|mailto):$/.test(url.protocol) || url.origin === window.location.origin) {
      return;
    }

    event.preventDefault();
    openUrl(anchor.href).catch((error) => {
      console.error("Failed to open external link:", error);
    });
  };

  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
}
