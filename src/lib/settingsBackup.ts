import { installTheme, listThemes, saveFile, saveTheme } from "@/lib/desktop";
import { addRepo, listPlugins, listRepos, repoSettings, setRepoEnabled, setRepoSettings, syncRepos } from "@/plugins/api";
import { buildBackup, type Backup } from "@/utils/settings-backup";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Writes the backup file. `native` adds what lives in the app's folder: repositories, plugins and themes. Resolves to false when the user cancels. */
export async function exportBackup(native: boolean): Promise<boolean> {
  const [repos, settings, plugins, themes] = native
    ? await Promise.all([listRepos(), repoSettings(), listPlugins(), listThemes()])
    : [[], undefined, [], { themes: [], errors: [] }];
  const backup = buildBackup({ storage: localStorage, repos, repoSettings: settings, plugins, themes: themes.themes });
  const name = `shard-settings-${backup.exportedAt.slice(0, 10)}.json`;
  return saveFile(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), name);
}

export interface Restored {
  /** One line per thing that was restored, skipped or refused. */
  lines: string[];
  /** The plugins of the backup that are not installed. Installing them needs the user's approval, so the caller asks. */
  plugins: Backup["plugins"];
  /** Settings were written: the app reads them at start, so it has to reload to show them. */
  needsReload: boolean;
}

/**
 * Applies a backup. Settings, repositories and themes go in at once; plugins do not, because each one asks for
 * permissions, so they are handed back. Whatever fails is a line of the result and does not stop the rest.
 */
export async function restoreBackup(backup: Backup, native: boolean): Promise<Restored> {
  const lines: string[] = [];
  const prefs = Object.entries(backup.prefs);
  for (const [key, value] of prefs) localStorage.setItem(key, value);
  if (prefs.length) lines.push(`Restored ${prefs.length} ${prefs.length === 1 ? "setting" : "settings"}.`);
  if (!native) return { lines, plugins: [], needsReload: prefs.length > 0 };

  const have = new Set((await listRepos()).map((repo) => repo.url));
  let added = 0;
  for (const repo of backup.repos) {
    if (have.has(repo.url)) continue;
    try {
      await addRepo(repo.url);
      if (!repo.enabled) await setRepoEnabled(repo.url, false);
      added++;
    } catch (error) {
      lines.push(`Repository ${repo.url}: ${message(error)}`);
    }
  }
  if (added) lines.push(`Added ${added} ${added === 1 ? "repository" : "repositories"}.`);
  if (backup.repoSettings) {
    try {
      await setRepoSettings(backup.repoSettings);
    } catch (error) {
      lines.push(`Repository settings: ${message(error)}`);
    }
  }

  const fromRepo = backup.themes.some((theme) => theme.repo) || backup.plugins.length > 0;
  if (added || fromRepo) await syncRepos().catch(() => []);

  const installedThemes = new Set((await listThemes()).themes.map((theme) => theme.id));
  let themes = 0;
  for (const item of backup.themes) {
    if (installedThemes.has(item.id)) continue;
    try {
      if (item.theme) await saveTheme(item.theme, false);
      else if (item.repo) await installTheme(item.repo, item.id);
      themes++;
    } catch (error) {
      lines.push(`Theme ${item.id}: ${message(error)}`);
    }
  }
  if (themes) lines.push(`Restored ${themes} ${themes === 1 ? "theme" : "themes"}.`);

  const installed = new Set((await listPlugins()).map((plugin) => plugin.id));
  return { lines, plugins: backup.plugins.filter((plugin) => !installed.has(plugin.id)), needsReload: prefs.length > 0 };
}
