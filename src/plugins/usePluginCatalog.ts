import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listRepos, pluginUpdates, repoCatalog, type CatalogEntry, type InstalledPlugin, type PluginUpdate, type Repo } from "./api";
import { usePlugins } from "./usePlugins";
import { setPluginUpdates } from "./usePluginUpdates";

export type CatalogAction = { kind: "install" } | { kind: "installed" } | { kind: "update"; to: string };

export interface CatalogRow {
  entry: CatalogEntry;
  action: CatalogAction;
  /** The installed copy, when there is one (its manifest has the license). */
  installed?: InstalledPlugin;
}

/** A stable key of a catalog row: the same plugin id can come from two repositories. */
export const rowKey = (row: CatalogRow): string => `${row.entry.repo}/${row.entry.id}`;

/** Each catalog entry with what the user can do with it. An update only counts for the repository it comes from. */
export function joinCatalog(catalog: readonly CatalogEntry[], installed: readonly InstalledPlugin[], updates: readonly PluginUpdate[]): CatalogRow[] {
  const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
  return catalog.map((entry) => {
    const update = updates.find((candidate) => candidate.id === entry.id && candidate.repo === entry.repo);
    const action: CatalogAction = update ? { kind: "update", to: update.to } : installedById.has(entry.id) ? { kind: "installed" } : { kind: "install" };
    // The installed copy may come from another repository (or from a zip): then its license and source are not this entry's.
    const copy = installedById.get(entry.id);
    return { entry, action, installed: copy && (!copy.source.repo || copy.source.repo === entry.repo) ? copy : undefined };
  });
}

interface Loaded {
  catalog: readonly CatalogEntry[];
  repos: readonly Repo[];
  updates: readonly PluginUpdate[];
}

const EMPTY: Loaded = { catalog: [], repos: [], updates: [] };

/** The repository catalog joined with the installed plugins (the Plugins page: Browse now, Installed and Repositories later). */
export function usePluginCatalog() {
  const { plugins, error: pluginsError } = usePlugins();
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const [catalog, repos, updates] = await Promise.all([repoCatalog(), listRepos(), pluginUpdates()]);
      if (mine !== latest.current) return;
      setLoaded({ catalog, repos, updates });
      setPluginUpdates(updates);
      setError(null);
    } catch (failure) {
      if (mine !== latest.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      // An answer after unmount is dropped. Not a DOM ref, so the value read here is the one wanted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      latest.current++;
    };
  }, [refresh]);

  const rows = useMemo(() => joinCatalog(loaded.catalog, plugins, loaded.updates), [loaded.catalog, plugins, loaded.updates]);
  return { rows, repos: loaded.repos, updates: loaded.updates, loading, error: error ?? pluginsError, refresh };
}
