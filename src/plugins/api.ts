import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir, join } from "@tauri-apps/api/path";
import { isDesktop, revealPath } from "@/lib/desktop";
import { t } from "@/i18n";
import type { PluginBundle, PluginIndexEntry, PluginManifest } from "./types";

// Typed wrappers for the commands in src-tauri/src/plugins/store.rs. Errors arrive as plain strings.

export interface PluginSource {
  kind: "repo" | "zip" | "folder" | "url";
  repo?: string;
  url?: string;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  manifest: PluginManifest;
  source: PluginSource;
  sha256: string;
  verified: boolean;
  enabled: boolean;
  granted: string[];
  /** Epoch milliseconds. */
  installedAt: number;
  /** Notes from the install (skipped links). Only present on the result of an install. */
  warnings?: string[];
}

function requireDesktop(): void {
  if (!isDesktop()) throw new Error(t("plugins.api.needsDesktop"));
}

/** The installed plugins. Empty in the browser build, which has no plugin store. */
export async function listPlugins(): Promise<InstalledPlugin[]> {
  if (!isDesktop()) return [];
  return invoke<InstalledPlugin[]>("plugins_list");
}

// Commands in src-tauri/src/plugins/repos.rs and install.rs.

export interface Repo {
  /** Canonical `https://github.com/<owner>/<repo>`, lowercase. The key for every repository command. */
  url: string;
  name: string;
  /** Null until the first successful sync detects it. */
  type?: "index" | "releases" | null;
  enabled: boolean;
  /** Epoch milliseconds of the last successful sync. */
  lastSync?: number | null;
  lastError?: string | null;
  official?: boolean;
}

/** A plugin as a repository lists it, tagged with that repository. */
export interface CatalogEntry extends Omit<PluginIndexEntry, "size"> {
  size?: number;
  /** URL of the repository, as in `Repo.url`. */
  repo: string;
  repoName: string;
}

/** An installed plugin with a newer version in the repository it came from. */
export interface PluginUpdate {
  id: string;
  name: string;
  from: string;
  to: string;
  changelog?: string | null;
  newPermissions: string[];
  repo: string;
}

/** The repositories. Empty in the browser build. */
export async function listRepos(): Promise<Repo[]> {
  if (!isDesktop()) return [];
  return invoke<Repo[]>("repo_list");
}

/** Detects the repository's type, reads its listing and adds it. Rejects with the reason, for example "Not a plugin repository". */
export async function addRepo(url: string): Promise<Repo> {
  requireDesktop();
  return invoke<Repo>("repo_add", { url });
}

/** Removes a repository and its cached listing. Rejects for the official one. Installed plugins stay. */
export async function removeRepo(url: string): Promise<void> {
  requireDesktop();
  await invoke("repo_remove", { url });
}

export async function setRepoEnabled(url: string, enabled: boolean): Promise<Repo> {
  requireDesktop();
  return invoke<Repo>("repo_set_enabled", { url, enabled });
}

/** Fetches one repository, or every enabled one without a `url`. A failed fetch is not a rejection: it is the repository's `lastError`. Returns the list as it is after. */
export async function syncRepos(url?: string): Promise<Repo[]> {
  requireDesktop();
  return invoke<Repo[]>("repo_sync", { url: url ?? null });
}

/** The plugins of every enabled repository, from the last sync. Empty in the browser build. */
export async function repoCatalog(): Promise<CatalogEntry[]> {
  if (!isDesktop()) return [];
  return invoke<CatalogEntry[]>("repo_catalog");
}

/** The bundles one repository's last sync offers (first run, Launcher layout). Empty in the browser build. */
export async function repoBundles(url: string): Promise<PluginBundle[]> {
  if (!isDesktop()) return [];
  return invoke<PluginBundle[]>("repo_bundles", { url });
}

/** The installed plugins that have a newer version. Empty in the browser build. */
export async function pluginUpdates(): Promise<PluginUpdate[]> {
  if (!isDesktop()) return [];
  return invoke<PluginUpdate[]>("plugin_updates");
}

/**
 * Installs the newer version of an installed plugin from the repository it came from. The grants it has stay;
 * a permission the new version asks for is not granted until `setPluginGrants` says so.
 */
export async function updatePlugin(id: string): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_update", { id });
}

/** Shows the plugin's folder (`<app data>/plugins/<id>`) in the system file manager. */
export async function revealPluginFolder(id: string): Promise<void> {
  requireDesktop();
  await revealPath(await join(await appDataDir(), "plugins", id));
}

/**
 * Downloads, verifies (SHA-256 against the repository's index) and installs a listed plugin.
 * Rejects with the reason, for example "The checksum does not match. …"; nothing is installed then.
 * No grants are given: call `setPluginGrants` after.
 */
export async function installFromRepo(repoUrl: string, id: string): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_install_from_repo", { repoUrl, id });
}

/** The payload of `plugin://progress`. `total` is null when the size is unknown. */
export interface InstallProgress {
  id: string;
  received: number;
  total: number | null;
}

/** Calls `callback` for every download progress event. Resolves to the function that stops listening. A no-op in the browser. */
export async function onInstallProgress(callback: (progress: InstallProgress) => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  return listen<InstallProgress>("plugin://progress", (event) => callback(event.payload));
}

/** Calls `callback` when the start-up check finds updates (the `plugins://updates` event). Resolves to the function that stops listening. A no-op in the browser. */
export async function onPluginUpdates(callback: () => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  return listen<number>("plugins://updates", () => callback());
}

/** Asks for a folder with the native dialog. Resolves to null when the user cancels (always, in the browser). */
export async function pickPluginFolder(): Promise<string | null> {
  if (!isDesktop()) return null;
  return invoke<string | null>("plugin_pick_folder");
}

/** What the install dialog shows for a zip, from `plugin_inspect_zip`. */
export interface ZipPreview {
  manifest: PluginManifest;
  /** SHA-256 of the zip file, lowercase hex. */
  sha256: string;
  warnings: string[];
}

/** What the install dialog shows for a folder, from `plugin_inspect_folder`. */
export interface FolderPreview {
  manifest: PluginManifest;
  warnings: string[];
}

/** What the install dialog shows for a repository URL, from `plugin_lookup_url`. `size` is the download's. */
export interface UrlPreview extends Omit<PluginIndexEntry, "size"> {
  size?: number;
  repo: string;
  repoName: string;
  kind: "index" | "releases";
  /** The downloaded package hashes to the checksum the repository lists. */
  checksumMatches: boolean;
  /** The repository is already in the list and turned on. */
  repoAdded: boolean;
}

/** The two switches of `repos.json`. */
export interface RepoSettings {
  checkOnStart: boolean;
  /** Installs from a zip, a folder or a URL outside the repositories are allowed. */
  allowOutside: boolean;
}

/** The largest zip the app unpacks, in bytes (src-tauri/src/plugins/store.rs MAX_BYTES). */
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

/** The settings. `allowOutside` is false in the browser build, which cannot install. */
export async function repoSettings(): Promise<RepoSettings> {
  if (!isDesktop()) return { checkOnStart: false, allowOutside: false };
  // Passing neither switch changes nothing and returns both.
  return invoke<RepoSettings>("repo_set_settings", {});
}

/** Changes the switches that are given and returns both as they are after. */
export async function setRepoSettings(patch: Partial<RepoSettings>): Promise<RepoSettings> {
  requireDesktop();
  return invoke<RepoSettings>("repo_set_settings", { checkOnStart: patch.checkOnStart ?? null, allowOutside: patch.allowOutside ?? null });
}

/** Asks for a zip file with the native dialog. Resolves to null when the user cancels (always, in the browser). */
export async function pickPluginZip(): Promise<string | null> {
  if (!isDesktop()) return null;
  return invoke<string | null>("plugin_pick_zip");
}

/** Gives the app a zip dropped on the dialog (the webview has no path for it). Resolves to the staged path; `clearDroppedZip` removes it. */
export async function stageDroppedZip(file: File): Promise<string> {
  requireDesktop();
  if (file.size > MAX_ZIP_BYTES) throw new Error(t("plugins.api.zipTooLarge", { size: MAX_ZIP_BYTES / (1024 * 1024) }));
  return invoke<string>("plugin_stage_zip", new Uint8Array(await file.arrayBuffer()));
}

export async function clearDroppedZip(): Promise<void> {
  if (!isDesktop()) return;
  await invoke("plugin_clear_drop");
}

/** The manifest and checksum of a zip, without installing it. Rejects with the validation errors, one per line. */
export async function inspectZip(path: string): Promise<ZipPreview> {
  requireDesktop();
  return invoke<ZipPreview>("plugin_inspect_zip", { path });
}

/** Installs the zip. Rejects when installs from outside the repositories are turned off. */
export async function installZip(path: string, expectedSha?: string): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_install_zip", { path, expectedSha });
}

/** The manifest of a folder, without installing it. Rejects with the validation errors, one per line. */
export async function inspectFolder(path: string): Promise<FolderPreview> {
  requireDesktop();
  return invoke<FolderPreview>("plugin_inspect_folder", { path });
}

/** Finds the plugin a repository URL points at, with its size and checksum result. Installs and adds nothing. */
export async function lookupUrl(url: string): Promise<UrlPreview> {
  requireDesktop();
  return invoke<UrlPreview>("plugin_lookup_url", { url });
}

/** Installs the plugin a repository URL points at, adding the repository first when `addRepo` is set. No grants are given. */
export async function installFromUrl(url: string, addRepo: boolean): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_install_from_url", { url, addRepo });
}

/** Installs, or updates, the plugin in `path`. Rejects with the validation errors, one per line. */
export async function installPluginFolder(path: string): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_install_folder", { path });
}

export async function uninstallPlugin(id: string): Promise<void> {
  requireDesktop();
  await invoke("plugin_uninstall", { id });
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_set_enabled", { id, enabled });
}

/** The value stored under `key` in the plugin's SDK storage, or null. */
export async function getPluginStorage(id: string, key: string): Promise<unknown> {
  requireDesktop();
  return (await invoke<unknown>("plugin_storage_get", { id, key })) ?? null;
}

/** Stores `value` (any JSON except null), or removes the key when `value` is null. Rejects when the plugin's 1 MB is used up. */
export async function setPluginStorage(id: string, key: string, value: unknown | null): Promise<void> {
  requireDesktop();
  await invoke("plugin_storage_set", { id, key, value });
}

/** Replaces the plugin's grants. Rejects when one is not declared in the manifest. Returns the updated record. */
export async function setPluginGrants(id: string, grants: string[]): Promise<InstalledPlugin> {
  requireDesktop();
  return invoke<InstalledPlugin>("plugin_set_grants", { id, grants });
}

/** Splits a reply from a command that returns bytes: `[u32 LE length][JSON metadata][body]` (src-tauri/src/plugins/frame.rs). */
export function decodeFrame(buffer: ArrayBuffer): { meta: unknown; body: Uint8Array } {
  if (buffer.byteLength < 4) throw new Error("Bad reply from the app");
  const length = new DataView(buffer).getUint32(0, true);
  if (4 + length > buffer.byteLength) throw new Error("Bad reply from the app");
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
  return { meta, body: new Uint8Array(buffer, 4 + length) };
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** The URL after redirects. */
  url: string;
  body: Uint8Array;
}

/** An HTTP request made by the app for the plugin. Rust checks the grants and the host list again. */
export async function pluginFetch(id: string, url: string, init: FetchInit = {}): Promise<FetchResult> {
  requireDesktop();
  const reply = await invoke<ArrayBuffer>("plugin_fetch", { id, request: { url, method: init.method, headers: init.headers ?? {}, body: init.body } });
  const { meta, body } = decodeFrame(reply);
  const { status, statusText, headers, url: finalUrl } = meta as { status: number; statusText: string; headers: Array<[string, string]>; url: string };
  // A Map, so a header called "constructor" or "__proto__" is just a name.
  const merged = new Map<string, string>();
  for (const [name, value] of headers) merged.set(name, merged.has(name) ? `${merged.get(name)}, ${value}` : value);
  return { status, statusText, headers: Object.fromEntries(merged), url: finalUrl, body };
}

export interface OpenedFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

/** Shows the open dialog for the plugin. Resolves to null when the user cancels. Rejects over 50 MB. */
export async function pluginOpenFile(id: string, accept: string[] = []): Promise<OpenedFile | null> {
  requireDesktop();
  const reply = await invoke<ArrayBuffer>("plugin_open_file", { id, accept });
  if (reply.byteLength === 0) return null;
  const { meta, body } = decodeFrame(reply);
  const { name, size } = meta as { name: string; size: number };
  return { name, size, bytes: body };
}
