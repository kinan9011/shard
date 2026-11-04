import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { themeCatalog, type ThemeCatalogEntry } from "@/lib/desktop";
import { repoCatalog, type CatalogEntry } from "@/plugins/api";

/** A plugin or a theme of a repository that the palette offers to install. */
export interface InstallableItem {
  /** Unique across both kinds. */
  id: string;
  kind: "plugin" | "theme";
  name: string;
  category: string;
  keywords: string[];
  /** The second line: "Plugin · Shard Official". */
  subtitle: string;
  run: () => void;
}

interface Listed {
  plugins: readonly CatalogEntry[];
  themes: readonly ThemeCatalogEntry[];
}

interface Actions {
  installPlugin: (entry: CatalogEntry) => void;
  installTheme: (entry: ThemeCatalogEntry) => void;
}

/** What the palette can offer: listed plugins and themes that are not installed. */
export function buildInstallables(listed: Listed, installedPluginIds: ReadonlySet<string>, installedThemeIds: ReadonlySet<string>, actions: Actions): InstallableItem[] {
  const seen = new Set<string>();
  const out: InstallableItem[] = [];
  for (const entry of listed.plugins) {
    // The same plugin listed by two repositories shows once.
    if (installedPluginIds.has(entry.id) || seen.has(`plugin:${entry.id}`)) continue;
    seen.add(`plugin:${entry.id}`);
    out.push({ id: `plugin:${entry.repo}/${entry.id}`, kind: "plugin", name: entry.name, category: entry.category ?? "Plugin", keywords: [entry.description].filter(Boolean), subtitle: t("shell.palette.subtitlePlugin", { repo: entry.repoName }), run: () => actions.installPlugin(entry) });
  }
  for (const entry of listed.themes) {
    if (installedThemeIds.has(entry.id) || seen.has(`theme:${entry.id}`)) continue;
    seen.add(`theme:${entry.id}`);
    out.push({ id: `theme:${entry.repo}/${entry.id}`, kind: "theme", name: entry.name, category: "Theme", keywords: [entry.description].filter(Boolean), subtitle: t("shell.palette.subtitleTheme", { repo: entry.repoName }), run: () => actions.installTheme(entry) });
  }
  return out;
}

/**
 * The installable plugins and themes, read from the repositories' last sync each time the palette opens (a local read,
 * not a download). Empty in the browser preview and when a read fails.
 */
export function usePaletteListed(open: boolean): Listed {
  const [listed, setListed] = useState<Listed>({ plugins: [], themes: [] });
  useEffect(() => {
    if (!open) return;
    let current = true;
    void Promise.all([
      Promise.resolve().then(() => repoCatalog()).catch(() => []),
      Promise.resolve().then(() => themeCatalog()).catch(() => []),
    ]).then(([plugins, themes]) => {
      if (current) setListed({ plugins: Array.isArray(plugins) ? plugins : [], themes: Array.isArray(themes) ? themes : [] });
    });
    return () => {
      current = false;
    };
  }, [open]);
  return listed;
}
