import { useEffect, useSyncExternalStore } from "react";
import { onPluginUpdates, pluginUpdates, type PluginUpdate } from "./api";

// One list of pending updates for the whole shell (sidebar badge, Home banner, Plugins page).
const NONE: readonly PluginUpdate[] = [];
let state: readonly PluginUpdate[] = NONE;
let started = false;
let stopListening: (() => void) | undefined;
let latest = 0;
const listeners = new Set<() => void>();

function publish(next: readonly PluginUpdate[]) {
  if (next.length === 0 && state.length === 0) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Reads the pending updates again. A failure keeps the last list. */
export async function refreshPluginUpdates(): Promise<void> {
  const mine = ++latest;
  try {
    const updates = await pluginUpdates();
    // A newer read or a pushed list came meanwhile: it wins.
    if (mine === latest) publish(Array.isArray(updates) ? updates : NONE);
  } catch {
    // The old list stays; the Plugins page shows its own error.
  }
}

/** Replaces the list with one the caller already has (the Plugins page fetched it). */
export function setPluginUpdates(updates: readonly PluginUpdate[]): void {
  latest++;
  publish(updates);
}

/** Forgets the shared list (tests). */
export function resetPluginUpdates(): void {
  started = false;
  stopListening?.();
  stopListening = undefined;
  latest++;
  state = NONE;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The installed plugins that have a newer version. Reads once on first use and again when the start-up check reports. */
export function usePluginUpdates(): readonly PluginUpdate[] {
  const updates = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (started) return;
    started = true;
    void refreshPluginUpdates();
    Promise.resolve(onPluginUpdates(() => void refreshPluginUpdates()))
      .then((stop) => {
        stopListening = stop;
      })
      .catch(() => {});
  }, []);
  return updates;
}
