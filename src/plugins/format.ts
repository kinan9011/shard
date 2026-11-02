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
  return kind === "zip" ? "Zip file" : "Folder";
}

/** A repository address without the scheme, as the Repositories table shows it. */
export const repoAddress = (url: string): string => url.replace(/^https?:\/\//, "");

/** When a repository was last read, as the Status column words it. */
export function syncedAgo(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Synced yesterday" : `Synced ${days} days ago`;
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
