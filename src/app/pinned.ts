import type { CatalogTool } from "@/app/catalog";
import { t } from "@/i18n";
import type { CatalogRow } from "@/plugins/usePluginCatalog";

export const PINNED_STORAGE_KEY = "shard-pinned";
export const MAX_PINNED = 12;
/** @deprecated English only. Use `pinLimitText()`, which follows the language. */
export const pinLimitMessage = `You can pin up to ${MAX_PINNED} tools. Unpin one first.`;
export const pinLimitText = () => t("shell.pinned.limit", { max: MAX_PINNED });
const LEGACY_KEY = "shard-favorites";

function readIds(storage: Storage, key: string): string[] | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))].slice(0, MAX_PINNED) : [];
}

/** The pinned tool ids. The first run after W21 moves `shard-favorites` over and drops the old key. Unreadable storage gives none. */
export function loadPinned(storage: Storage | undefined): string[] {
  if (!storage) return [];
  for (const key of [PINNED_STORAGE_KEY, LEGACY_KEY]) {
    try {
      const ids = readIds(storage, key);
      if (!ids) continue;
      if (key === LEGACY_KEY) {
        storage.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids));
        storage.removeItem(LEGACY_KEY);
      }
      return ids;
    } catch (error) {
      // A damaged list does not hide the other one.
      console.error(`Failed to load pinned tools from ${key}:`, error);
    }
  }
  return [];
}

/** Moves `id` to the slot of `targetId`, the ones between shifting over. Same list when either is missing. */
export function moveId(list: readonly string[], id: string, targetId: string): readonly string[] {
  const from = list.indexOf(id);
  const to = list.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.filter((entry) => entry !== id);
  next.splice(to, 0, id);
  return next;
}

export type PickerItem =
  | { kind: "tool"; id: string; name: string; tool: CatalogTool }
  | { kind: "install"; id: string; name: string; row: CatalogRow };

/** The picker's rows: every tool, then the plugins the repositories list that are not installed. */
export function pickerItems(tools: readonly CatalogTool[], rows: readonly CatalogRow[]): PickerItem[] {
  const known = new Set(tools.map((tool) => tool.id));
  const listed = rows.filter((row) => row.action.kind === "install" && !known.has(row.entry.id));
  return [
    ...tools.map((tool): PickerItem => ({ kind: "tool", id: tool.id, name: tool.name, tool })),
    ...listed.map((row): PickerItem => ({ kind: "install", id: row.entry.id, name: row.entry.name, row })),
  ];
}
