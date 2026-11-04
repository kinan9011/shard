import { t } from "@/i18n";
import type { InstalledPlugin, Repo } from "./api";
import type { PluginRuntime } from "./types";

export const DASH = "—";

export const RUNTIME_LABEL: Record<PluginRuntime, string> = { web: "Web", wasm: "WASM", "web+wasm": "Web + WASM" };

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where a plugin came from, as the Source column and the permission dialog word it. */
export function sourceLabel(plugin: InstalledPlugin, repos: readonly Repo[]): string {
  const { kind, repo, url } = plugin.source;
  if (kind === "repo" && repo) return repos.find((item) => item.url === repo)?.name ?? repo.replace(/^https:\/\/github\.com\//, "");
  if (kind === "url" && url) return url.replace(/^https?:\/\/(www\.)?(github\.com\/)?/, "");
  return kind === "zip" ? t("plugins.format.zipFile") : t("plugins.format.folder");
}

/** A repository address without the scheme, as the Repositories table shows it. */
export const repoAddress = (url: string): string => url.replace(/^https?:\/\//, "");

/** When a repository was last read, as the Status column words it. */
export function syncedAgo(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("plugins.format.syncedNow");
  if (minutes < 60) return t("plugins.format.syncedMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("plugins.format.syncedHours", { count: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t("plugins.format.syncedYesterday") : t("plugins.format.syncedDays", { count: days });
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : t("plugins.format.listAnd", { head: names.slice(0, -1).join(t("plugins.format.listSeparator")), last: names[names.length - 1] });
}
