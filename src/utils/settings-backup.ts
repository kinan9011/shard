import type { UserTheme } from "@/utils/theme";

/** One file that holds what a person set up in Shard, to move it to another machine or to keep it before a reset. */
export interface Backup {
  schema: 1;
  app: "shard";
  exportedAt: string;
  /** Preferences kept in the webview's storage, by key. Only the keys of `PREF_KEYS`. */
  prefs: Record<string, string>;
  /** Repositories the user added (the built-in ones are always there). */
  repos: { url: string; enabled: boolean }[];
  repoSettings?: { checkOnStart: boolean; allowOutside: boolean };
  /** Plugins installed from a repository. Zip, folder and URL installs cannot be restored from a name. */
  plugins: { id: string; repo: string; version: string; enabled: boolean }[];
  /** A theme the user made in full, a theme from a repository by id. */
  themes: { id: string; repo?: string; theme?: UserTheme }[];
}

/** The user preferences of the webview. Never first-run, what's-new or other state that belongs to one install. */
export const PREF_KEYS: readonly string[] = [
  "shard-pinned",
  "shard-theme-preference",
  "shard-color-scheme",
  "shard-accent",
  "shard-fonts",
  "shard-sidebar-categories",
  "shard-open-tools-in",
  "shard-layout",
  "shard-hidden-tools",
  "shard-shortcuts-v1",
  "shard-global-shortcut-v1",
  "shard-auto-update",
  "shard-diff-merge-settings",
  "shard-json-layout",
  "shard-recent-tools",
  "shard-sidebar-expanded",
];

/** `shard-<tool>-layout` is one key per tool, with a name that depends on the tool. */
const TOOL_LAYOUT = /^shard-[a-z0-9-]{1,40}-layout$/;

export const isPrefKey = (key: string): boolean => PREF_KEYS.includes(key) || TOOL_LAYOUT.test(key);

const MAX_VALUE = 50_000;
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 300;
const ID = /^[a-z0-9-]{1,40}$/;
const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type Storage = Pick<globalThis.Storage, "length" | "key" | "getItem">;

/** The preferences in storage, and only those. */
export function collectPrefs(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    const value = key && isPrefKey(key) ? storage.getItem(key) : null;
    if (key && value !== null && value.length <= MAX_VALUE) out[key] = value;
  }
  return out;
}

/** A value is kept only if it can be a stored value: text, and valid JSON where it looks like JSON. */
const sane = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > MAX_VALUE) return false;
  if (!/^\s*[[{]/.test(value)) return true;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

export type Parsed = { ok: true; backup: Backup; skipped: string[] } | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a backup file. What is wrong with a part of it is left out and named in `skipped`; a file that is not a backup is an error. */
export function parseBackup(text: string): Parsed {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "The file is larger than 2 MB, so it is not a Shard backup." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not JSON." };
  }
  if (!record(data) || data.app !== "shard") return { ok: false, error: "This is not a Shard backup." };
  if (data.schema !== 1) return { ok: false, error: `This backup has schema ${String(data.schema)}; this version of Shard reads schema 1.` };

  const skipped: string[] = [];
  const prefs: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(data.prefs) ? data.prefs : {})) {
    if (!isPrefKey(key)) skipped.push(`${key}: not a setting`);
    else if (!sane(value)) skipped.push(`${key}: not a usable value`);
    else prefs[key] = value;
  }
  const list = (name: string): unknown[] => (Array.isArray(data[name]) ? (data[name] as unknown[]).slice(0, MAX_ITEMS) : []);

  const repos = list("repos").flatMap((item) => {
    if (record(item) && typeof item.url === "string" && GITHUB.test(item.url)) return [{ url: item.url, enabled: item.enabled !== false }];
    skipped.push(`repository ${record(item) ? String(item.url) : "?"}: not a GitHub address`);
    return [];
  });
  const plugins = list("plugins").flatMap((item) => {
    if (record(item) && typeof item.id === "string" && ID.test(item.id) && typeof item.repo === "string" && GITHUB.test(item.repo)) {
      return [{ id: item.id, repo: item.repo, version: typeof item.version === "string" ? item.version : "", enabled: item.enabled !== false }];
    }
    skipped.push(`plugin ${record(item) ? String(item.id) : "?"}: not listed with a repository`);
    return [];
  });
  const themes = list("themes").flatMap((item): Backup["themes"] => {
    if (!record(item) || typeof item.id !== "string" || !ID.test(item.id)) {
      skipped.push("a theme without a valid id");
      return [];
    }
    if (typeof item.repo === "string" && GITHUB.test(item.repo)) return [{ id: item.id, repo: item.repo }];
    // The Rust side checks every token of a full theme when it saves it.
    if (record(item.theme) && item.theme.id === item.id) return [{ id: item.id, theme: item.theme as unknown as UserTheme }];
    skipped.push(`theme ${item.id}: nothing to restore it from`);
    return [];
  });
  const rs = data.repoSettings;
  const repoSettings = record(rs) ? { checkOnStart: rs.checkOnStart !== false, allowOutside: rs.allowOutside === true } : undefined;
  return { ok: true, skipped, backup: { schema: 1, app: "shard", exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "", prefs, repos, repoSettings, plugins, themes } };
}

export interface BackupSources {
  storage: Storage;
  repos: { url: string; enabled: boolean; official?: boolean }[];
  repoSettings?: { checkOnStart: boolean; allowOutside: boolean };
  plugins: { id: string; version: string; enabled: boolean; source: { kind: string; repo?: string } }[];
  themes: UserTheme[];
}

/** What goes into a backup, from what the app has now. */
export function buildBackup(sources: BackupSources, now: Date = new Date()): Backup {
  return {
    schema: 1,
    app: "shard",
    exportedAt: now.toISOString(),
    prefs: collectPrefs(sources.storage),
    repos: sources.repos.filter((repo) => !repo.official).map((repo) => ({ url: repo.url, enabled: repo.enabled })),
    ...(sources.repoSettings ? { repoSettings: sources.repoSettings } : {}),
    plugins: sources.plugins.flatMap((plugin) => (plugin.source.kind === "repo" && plugin.source.repo ? [{ id: plugin.id, repo: plugin.source.repo, version: plugin.version, enabled: plugin.enabled }] : [])),
    themes: sources.themes.map((theme) => (theme.repo ? { id: theme.id, repo: theme.repo } : { id: theme.id, theme })),
  };
}
