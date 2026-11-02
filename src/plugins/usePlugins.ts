import { useCallback, useEffect, useSyncExternalStore } from "react";
import { listPlugins, type InstalledPlugin } from "./api";

// One list for the whole app (the catalog now, the Plugins page later), so a change shows everywhere.
interface PluginsState {
  plugins: readonly InstalledPlugin[];
  error: string | null;
  /** True once a read has finished, successfully or not. */
  ready: boolean;
}

const NONE: readonly InstalledPlugin[] = [];
let state: PluginsState = { plugins: NONE, error: null, ready: false };
let loaded = false;
let latest = 0;
const listeners = new Set<() => void>();

function publish(next: PluginsState) {
  // Nothing changed (the browser build always reads an empty list): skip the re-render.
  if (next.ready === state.ready && next.error === state.error && next.plugins.length === 0 && state.plugins.length === 0) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Reads the installed plugins again. A failure keeps the last list and sets `error`. */
export async function refreshPlugins(): Promise<void> {
  loaded = true;
  const mine = ++latest;
  try {
    const plugins = await listPlugins();
    // A newer read started meanwhile: its answer wins, even if this one arrives last.
    if (mine === latest) publish({ plugins: Array.isArray(plugins) ? plugins : NONE, error: null, ready: true });
  } catch (error) {
    if (mine !== latest) return;
    loaded = false; // the next mount tries again
    publish({ plugins: state.plugins, error: error instanceof Error ? error.message : String(error), ready: true });
  }
}

/** Forgets the shared list (tests). */
export function resetPlugins(): void {
  loaded = false;
  latest++;
  state = { plugins: NONE, error: null, ready: false };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlugins() {
  const { plugins, error, ready } = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!loaded) void refreshPlugins();
  }, []);
  const refresh = useCallback(() => refreshPlugins(), []);
  return { plugins, error, ready, refresh };
}
