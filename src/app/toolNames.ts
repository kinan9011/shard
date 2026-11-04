import { t, type TKey } from "@/i18n";

/**
 * Display names of the built-in tools and their categories. `ALL_TOOLS[].name` and `.category` stay English: they are
 * the stable search labels and go to the launcher manifest. The UI shows these translated names instead.
 */
const TOOL_NAME_KEYS: Record<string, TKey> = {
  "json-viewer": "tool.json-viewer.name",
  "code-playground": "tool.code-playground.name",
  "regex-generator": "tool.regex-generator.name",
  "json-typescript": "tool.json-typescript.name",
  "json-schema": "tool.json-schema.name",
  "json-diff": "tool.json-diff.name",
  "diff-merge": "tool.diff-merge.name",
  "text-compare": "tool.text-compare.name",
  "jwt-decoder": "tool.jwt-decoder.name",
};

const CATEGORY_KEYS: Record<string, TKey> = {
  "Development Tools": "category.developmentTools",
  "Text Tools": "category.textTools",
  Plugins: "category.plugins",
};

interface NamedTool {
  id: string;
  name: string;
  source?: string;
  kind?: string;
}

/** The name to show for a tool. Plugin tools keep the name from their manifest. */
export function toolName(tool: NamedTool): string {
  if (tool.source === "plugin") return tool.name;
  const key = TOOL_NAME_KEYS[tool.id];
  return key ? t(key) : tool.name;
}

/** The category to show. Categories of plugins are free text and stay as they are. */
export function categoryName(category: string): string {
  const key = CATEGORY_KEYS[category];
  return key ? t(key) : category;
}

/** Every name a search should match: the one shown and the English one. */
export function toolSearchNames(tool: NamedTool): string[] {
  const shown = toolName(tool);
  return shown === tool.name ? [tool.name] : [shown, tool.name];
}

export function categorySearchNames(category: string): string[] {
  const shown = categoryName(category);
  return shown === category ? [category] : [shown, category];
}
