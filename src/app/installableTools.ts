/**
 * Plugins of the official repository that were built-in tools in the DevTools fork. A paste that fits one of them
 * suggests "Install <name>" while the plugin is not installed (see `detectPastedContent`).
 */
export interface InstallableTool {
  pluginId: string;
  name: string;
}

export const INSTALLABLE_TOOLS: readonly InstallableTool[] = [
  { pluginId: "hash-generator", name: "Hash Generator" },
  { pluginId: "uuid-generator", name: "UUID Generator" },
  { pluginId: "cron-calculator", name: "Cron Calculator" },
  { pluginId: "markdown", name: "Markdown" },
  { pluginId: "color-palette", name: "Color Palette" },
  { pluginId: "unit-converter", name: "Unit Converter" },
  { pluginId: "chmod-calculator", name: "chmod Calculator" },
  { pluginId: "checksum", name: "Checksum" },
  { pluginId: "ip-cidr", name: "IP / CIDR Calculator" },
  { pluginId: "har-viewer", name: "HAR Viewer" },
  { pluginId: "timestamp", name: "Timestamp" },
  { pluginId: "date-difference", name: "Date Difference" },
  { pluginId: "date-format", name: "Date Format Translator" },
  { pluginId: "stopwatch", name: "Stopwatch" },
  { pluginId: "time-zone-converter", name: "Time Zone Converter" },
  { pluginId: "api-formatter", name: "API Formatter" },
  { pluginId: "string-inspector", name: "String Inspector" },
  { pluginId: "line-tools", name: "Line Tools" },
  { pluginId: "password-generator", name: "Password Generator" },
  { pluginId: "lorem-generator", name: "Lorem Ipsum" },
  { pluginId: "qr-generator", name: "QR Generator" },
  { pluginId: "bcrypt-generator", name: "Bcrypt Generator" },
  { pluginId: "random-string", name: "Random String" },
  { pluginId: "key-generator", name: "Key Pair Generator" },
  { pluginId: "base64", name: "Base64" },
  { pluginId: "case-converter", name: "Case Converter" },
  { pluginId: "number-base", name: "Number Base" },
  { pluginId: "url-encoder", name: "URL Encoder" },
  { pluginId: "csv-json", name: "CSV to JSON" },
  { pluginId: "yaml-json", name: "Config Converter" },
  { pluginId: "escape-tools", name: "Escape Tools" },
  { pluginId: "html-to-jsx", name: "HTML to JSX" },
  { pluginId: "svg-to-css", name: "SVG to CSS" },
  { pluginId: "php-tools", name: "PHP Tools" },
  { pluginId: "compression", name: "Compression" },
  { pluginId: "curl-to-code", name: "cURL to Code" },
  { pluginId: "certificate-decoder", name: "X.509 Certificate Decoder" },
  { pluginId: "html-preview", name: "HTML Preview" },
  { pluginId: "code-formatter", name: "Code Formatter" },
  { pluginId: "semver", name: "Semver Calculator" },
  { pluginId: "xml-inspector", name: "XML Inspector" },
  { pluginId: "asn1-inspector", name: "ASN.1 Inspector" },
  { pluginId: "mermaid-renderer", name: "Mermaid Renderer" },
  { pluginId: "image-converter", name: "Image Converter" },
  { pluginId: "qr-reader", name: "QR Reader" },
  { pluginId: "image-metadata", name: "Image Metadata Cleaner" },
  { pluginId: "video-metadata", name: "Video Metadata Cleaner" },
  { pluginId: "secret-redactor", name: "Secret & PII Redactor" },
  { pluginId: "token-counter", name: "Token Counter" },
  { pluginId: "ai-text-cleaner", name: "AI Text Cleaner" },
];

/** The plugin ids of `INSTALLABLE_TOOLS`. */
export const INSTALLABLE_PLUGIN_IDS: ReadonlySet<string> = new Set(INSTALLABLE_TOOLS.map((tool) => tool.pluginId));

/** The official repository those plugins come from (the same address as `OFFICIAL_URL` in src-tauri/src/plugins/repos.rs). */
export const OFFICIAL_REPO_URL = "https://github.com/kinan9011/shard-plugins";
