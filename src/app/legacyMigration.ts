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
  { oldId: "base64", pluginId: "base64", name: "Base64" },
  { oldId: "case-converter", pluginId: "case-converter", name: "Case Converter" },
  { oldId: "number-base", pluginId: "number-base", name: "Number Base" },
  { oldId: "url-encoder", pluginId: "url-encoder", name: "URL Encoder" },
  { oldId: "csv-json", pluginId: "csv-json", name: "CSV to JSON" },
  { oldId: "yaml-json", pluginId: "yaml-json", name: "Config Converter" },
  { oldId: "escape-tools", pluginId: "escape-tools", name: "Escape Tools" },
  { oldId: "html-to-jsx", pluginId: "html-to-jsx", name: "HTML to JSX" },
  { oldId: "svg-to-css", pluginId: "svg-to-css", name: "SVG to CSS" },
  { oldId: "php-tools", pluginId: "php-tools", name: "PHP Tools" },
  { oldId: "compression", pluginId: "compression", name: "Compression" },
  { oldId: "curl-to-code", pluginId: "curl-to-code", name: "cURL to Code" },
  { oldId: "certificate-decoder", pluginId: "certificate-decoder", name: "X.509 Certificate Decoder" },
  { oldId: "html-preview", pluginId: "html-preview", name: "HTML Preview" },
  { oldId: "code-formatter", pluginId: "code-formatter", name: "Code Formatter" },
  { oldId: "semver", pluginId: "semver", name: "Semver Calculator" },
  { oldId: "xml-inspector", pluginId: "xml-inspector", name: "XML Inspector" },
  { oldId: "asn1-inspector", pluginId: "asn1-inspector", name: "ASN.1 Inspector" },
  { oldId: "mermaid-renderer", pluginId: "mermaid-renderer", name: "Mermaid Renderer" },
  { oldId: "image-converter", pluginId: "image-converter", name: "Image Converter" },
  { oldId: "qr-reader", pluginId: "qr-reader", name: "QR Reader" },
  { oldId: "image-metadata", pluginId: "image-metadata", name: "Image Metadata Cleaner" },
  { oldId: "video-metadata", pluginId: "video-metadata", name: "Video Metadata Cleaner" },
  { oldId: "secret-redactor", pluginId: "secret-redactor", name: "Secret & PII Redactor" },
  { oldId: "token-counter", pluginId: "token-counter", name: "Token Counter" },
  { oldId: "ai-text-cleaner", pluginId: "ai-text-cleaner", name: "AI Text Cleaner" },
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
