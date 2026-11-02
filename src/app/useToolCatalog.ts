import { useMemo, useSyncExternalStore } from "react";
import { Puzzle } from "lucide-react";
import { buildCatalog, groupByCategory, type CatalogTool } from "@/app/catalog";
import { ALL_TOOLS } from "@/app/toolRegistry";
import type { InstalledPlugin } from "@/plugins/api";
import { usePlugins } from "@/plugins/usePlugins";

export const HIDDEN_TOOLS_STORAGE_KEY = "shard-hidden-tools";

/** The enabled plugins as catalog tools. A disabled plugin is installed but not shown. */
export function pluginCatalogTools(plugins: readonly InstalledPlugin[]): CatalogTool[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .map(({ id, manifest }) => ({
      id,
      name: manifest.name,
      category: manifest.category ?? "Plugins",
      keywords: manifest.keywords ?? [],
      icon: Puzzle,
      source: "plugin" as const,
      pluginId: id,
    }));
}

const NO_TOOLS: ReadonlySet<string> = new Set();
const hiddenListeners = new Set<() => void>();
let hiddenCache: { raw: string | null; ids: ReadonlySet<string> } = { raw: null, ids: NO_TOOLS };

function readHiddenTools(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(HIDDEN_TOOLS_STORAGE_KEY);
  } catch {
    return NO_TOOLS;
  }
  // The same text gives the same Set, so useSyncExternalStore sees no change.
  if (raw === hiddenCache.raw && hiddenCache.ids !== NO_TOOLS) return hiddenCache.ids;
  let ids: ReadonlySet<string> = NO_TOOLS;
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    ids = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    // Unreadable: nothing is hidden.
  }
  hiddenCache = { raw, ids };
  return ids;
}

/** Hides or shows a tool in the shell (the built-in list on the Installed tab). Storage that cannot be written keeps the old set. */
export function setToolHidden(id: string, hidden: boolean): void {
  const next = new Set(readHiddenTools());
  if (hidden) next.add(id);
  else next.delete(id);
  try {
    window.localStorage.setItem(HIDDEN_TOOLS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    return;
  }
  hiddenListeners.forEach((listener) => listener());
}

function subscribeHidden(listener: () => void) {
  hiddenListeners.add(listener);
  return () => {
    hiddenListeners.delete(listener);
  };
}

/** The ids of the tools the user hid. */
export function useHiddenTools(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeHidden, readHiddenTools);
}

/** The tools the shell shows: builtins and plugins, minus the ones the user hid. */
export function useToolCatalog() {
  const hidden = useHiddenTools();
  const { plugins, ready, error } = usePlugins();
  return useMemo(() => {
    const tools = buildCatalog(ALL_TOOLS, pluginCatalogTools(plugins), hidden);
    return {
      tools,
      byId: new Map(tools.map((tool) => [tool.id, tool])),
      ids: new Set(tools.map((tool) => tool.id)),
      categories: groupByCategory(tools),
      // The installed plugins have been read, so a stored id that is still missing is really gone.
      pluginsReady: ready && !error,
      // The read failed: the stored ids cannot be checked, so they are kept as they are.
      pluginsFailed: ready && Boolean(error),
      pluginCount: plugins.length,
      // Every installed plugin, enabled or not.
      installedIds: new Set(plugins.map((plugin) => plugin.id)) as ReadonlySet<string>,
    };
  }, [hidden, plugins, ready, error]);
}
