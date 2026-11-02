import { useEffect, useSyncExternalStore } from "react";
import { listThemes, themeCatalog } from "@/lib/desktop";
import { onPluginUpdates } from "@/plugins/api";
import { themeUpdates } from "@/utils/theme-updates";

// How many installed themes have a newer version in their repository, for the Plugins badge and the Themes tab.
let count = 0;
let latest = 0;
const listeners = new Set<() => void>();

/** Compares the installed themes with the repositories' last sync. A failure keeps the last number. */
export async function refreshThemeUpdates(): Promise<void> {
  const mine = ++latest;
  try {
    const [{ themes }, catalog] = await Promise.all([listThemes(), themeCatalog()]);
    const next = themeUpdates(themes, catalog).length;
    if (mine === latest && next !== count) {
      count = next;
      listeners.forEach((listener) => listener());
    }
  } catch {
    // The old number stays.
  }
}

/** Forgets the number (tests). */
export function resetThemeUpdates(): void {
  latest++;
  count = 0;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The number of theme updates. */
export const useThemeUpdateCount = (): number => useSyncExternalStore(subscribe, () => count);

/**
 * Keeps the number current: reads it at start, when the themes folder changes (`folderVersion`), and when the start-up
 * check has synced the repositories. Mounted once, by the shell, on the desktop only.
 */
export function useThemeUpdateSync(enabled: boolean, folderVersion: unknown): void {
  useEffect(() => {
    if (enabled) void refreshThemeUpdates();
  }, [enabled, folderVersion]);
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | undefined;
    let gone = false;
    try {
      Promise.resolve(onPluginUpdates(() => void refreshThemeUpdates()))
        .then((off) => (gone ? off?.() : (stop = off)))
        .catch(() => {});
    } catch {
      // No event source: the number is still read when the themes change.
    }
    return () => {
      gone = true;
      stop?.();
    };
  }, [enabled]);
}
