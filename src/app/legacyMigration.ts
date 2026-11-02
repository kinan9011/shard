/**
 * Tools that used to be built into Shard and are plugins now (the pilot ports W27 and W28, see plugins/).
 * Their ids are kept: a pin, a recent entry or a link written by an older version still points at the
 * right tool once the plugin is installed. `oldId` is what older versions stored; `pluginId` is the plugin's id.
 */
export interface PortedTool {
  oldId: string;
  pluginId: string;
  name: string;
}

export const PORTED_TOOLS: readonly PortedTool[] = [
  { oldId: "hash-generator", pluginId: "hash-generator", name: "Hash Generator" },
  { oldId: "uuid-generator", pluginId: "uuid-generator", name: "UUID Generator" },
  { oldId: "cron-calculator", pluginId: "cron-calculator", name: "Cron Calculator" },
  { oldId: "markdown", pluginId: "markdown", name: "Markdown" },
  { oldId: "color-palette", pluginId: "color-palette", name: "Color Palette" },
];

/** The plugin ids of the ported tools. A stored pin or recent entry with one of these is kept while the plugin is not installed. */
export const PORTED_PLUGIN_IDS: ReadonlySet<string> = new Set(PORTED_TOOLS.map((tool) => tool.pluginId));

/** The official repository the ported plugins come from (the same address as `OFFICIAL_URL` in src-tauri/src/plugins/repos.rs). */
export const OFFICIAL_REPO_URL = "https://github.com/kinan9011/shard-plugins";

/** Old tool ids to their plugin ids, each id once, in order. Other ids are left as they are. */
export function migrateToolIds(ids: readonly string[]): string[] {
  const toPlugin = new Map(PORTED_TOOLS.map((tool) => [tool.oldId, tool.pluginId]));
  return [...new Set(ids.map((id) => toPlugin.get(id) ?? id))];
}

/** The ported tools the user had pinned or used and has not installed as plugins: the Home banner offers each one. */
export function portedToOffer(used: ReadonlySet<string>, installed: ReadonlySet<string>): PortedTool[] {
  return PORTED_TOOLS.filter((tool) => used.has(tool.pluginId) && !installed.has(tool.pluginId));
}
