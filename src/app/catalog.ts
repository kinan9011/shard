import type { LucideIcon } from "lucide-react";

// ponytail: plugin icons ("lucide:<Name>" or a file in the package) widen this type in a later wave.
export type IconRef = LucideIcon;
export type ToolSource = "core" | "legacy" | "plugin";

export interface CatalogTool {
  id: string;
  name: string;
  category: string;
  keywords: readonly string[];
  icon: IconRef;
  source: ToolSource;
  pluginId?: string;
}

/** A tool compiled into the app (an entry of `ALL_TOOLS`). */
export interface BuiltinTool {
  id: string;
  name: string;
  category: string;
  keywords: readonly string[];
  icon: IconRef;
  kind: "core" | "legacy";
}

/** Builtins first, then plugin tools. A plugin cannot take a builtin's id. Hidden ids are dropped. */
export function buildCatalog(
  builtins: readonly BuiltinTool[],
  plugins: readonly CatalogTool[],
  hidden: ReadonlySet<string>,
): CatalogTool[] {
  const taken = new Set(builtins.map((tool) => tool.id));
  const all: CatalogTool[] = builtins.map(({ kind, ...tool }) => ({ ...tool, source: kind }));
  for (const tool of plugins) {
    if (taken.has(tool.id)) continue;
    taken.add(tool.id);
    all.push(tool);
  }
  return all.filter((tool) => !hidden.has(tool.id));
}

/** Groups by category, in the order each category first appears. */
export function groupByCategory(tools: readonly CatalogTool[]): { name: string; tools: CatalogTool[] }[] {
  const groups = new Map<string, CatalogTool[]>();
  for (const tool of tools) {
    const group = groups.get(tool.category);
    if (group) group.push(tool);
    else groups.set(tool.category, [tool]);
  }
  return Array.from(groups, ([name, members]) => ({ name, tools: members }));
}

/**
 * Keeps the stored ids that are still in the catalog (order kept, duplicates dropped). Anything else is dropped,
 * except the ids in `keep`: tools that are not installed yet but should keep their slot (see legacyMigration.ts).
 */
export function pruneToolIds(stored: unknown, known: ReadonlyMap<string, CatalogTool>, keep: ReadonlySet<string> = new Set()): string[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  for (const id of stored) {
    if (typeof id === "string" && (known.has(id) || keep.has(id))) seen.add(id);
  }
  return [...seen];
}
