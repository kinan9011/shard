export const PERMISSION_NAMES = ["clipboard:read", "clipboard:write", "files:open", "files:save", "network", "storage"] as const;
export type PermissionName = (typeof PERMISSION_NAMES)[number];

export const PLUGIN_RUNTIMES = ["web", "wasm", "web+wasm"] as const;
export type PluginRuntime = (typeof PLUGIN_RUNTIMES)[number];

export interface PluginPermission {
  name: PermissionName;
  /** Required for `network`: `host[:port]` or `*.host[:port]`. */
  hosts?: string[];
  reason: string;
  optional?: boolean;
}

/** `plugin.json` */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription?: string;
  category?: string;
  keywords?: string[];
  icon?: string;
  entry: string;
  runtime: PluginRuntime;
  permissions?: PluginPermission[];
  minAppVersion?: string;
  license?: string;
  source?: string;
  screenshots?: string[];
  changelog?: string;
}

/** One plugin listed in a repository's `index.json`. */
export interface PluginIndexEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  category?: string;
  runtime: PluginRuntime;
  permissions?: PluginPermission[];
  minAppVersion?: string;
  url: string;
  sha256: string;
  size: number;
  released?: string;
  changelog?: string;
  icon?: string;
}

/** One color theme listed in a repository's `index.json`. `url` is the theme file (docs/themes.md). */
export interface ThemeIndexEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  url: string;
  sha256: string;
  size: number;
}

/** A named set of plugins of one index, offered together on the Launcher first-run screen. */
export interface PluginBundle {
  id: string;
  name: string;
  /** Plugin ids listed in the same index. */
  plugins: string[];
}

/** `index.json` */
export interface PluginIndex {
  schema: 1;
  name: string;
  plugins: PluginIndexEntry[];
  bundles?: PluginBundle[];
  themes?: ThemeIndexEntry[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
