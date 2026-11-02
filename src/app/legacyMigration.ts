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
  { oldId: "unit-converter", pluginId: "unit-converter", name: "Unit Converter" },
  { oldId: "chmod-calculator", pluginId: "chmod-calculator", name: "chmod Calculator" },
  { oldId: "checksum", pluginId: "checksum", name: "Checksum" },
  { oldId: "ip-cidr", pluginId: "ip-cidr", name: "IP / CIDR Calculator" },
  { oldId: "har-viewer", pluginId: "har-viewer", name: "HAR Viewer" },
  { oldId: "timestamp", pluginId: "timestamp", name: "Timestamp" },
  { oldId: "date-difference", pluginId: "date-difference", name: "Date Difference" },
  { oldId: "date-format", pluginId: "date-format", name: "Date Format Translator" },
  { oldId: "stopwatch", pluginId: "stopwatch", name: "Stopwatch" },
  { oldId: "time-zone-converter", pluginId: "time-zone-converter", name: "Time Zone Converter" },
  { oldId: "api-formatter", pluginId: "api-formatter", name: "API Formatter" },
  { oldId: "string-inspector", pluginId: "string-inspector", name: "String Inspector" },
  { oldId: "line-tools", pluginId: "line-tools", name: "Line Tools" },
  { oldId: "password-generator", pluginId: "password-generator", name: "Password Generator" },
  { oldId: "lorem-generator", pluginId: "lorem-generator", name: "Lorem Ipsum" },
  { oldId: "qr-generator", pluginId: "qr-generator", name: "QR Generator" },
  { oldId: "bcrypt-generator", pluginId: "bcrypt-generator", name: "Bcrypt Generator" },
  { oldId: "random-string", pluginId: "random-string", name: "Random String" },
  { oldId: "key-generator", pluginId: "key-generator", name: "Key Pair Generator" },
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
