import { t, type TKey } from "@/i18n";
import { Clipboard, Cpu, File as FileIcon, Globe, type LucideIcon } from "lucide-react";
import type { PermissionName, PluginManifest } from "./types";

// What the install screen and the detail pane show for a plugin's permissions: one row per group,
// as in the design ("Network", "Files", "Clipboard", "WASM backend"). Enforcement is in bridge.ts
// and in the Rust commands; this file is only metadata.

export type PermissionGroupKey = "network" | "files" | "clipboard" | "wasm";

interface PermissionGroup {
  key: PermissionGroupKey;
  labelKey: TKey;
  icon: LucideIcon;
  /** Shown when the manifest gives no reason (a manifest must, so this is a fallback). */
  defaultReasonKey: TKey;
  names: readonly PermissionName[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { key: "network", labelKey: "plugins.permission.network", icon: Globe, defaultReasonKey: "plugins.permission.networkReason", names: ["network"] },
  { key: "files", labelKey: "plugins.permission.files", icon: FileIcon, defaultReasonKey: "plugins.permission.filesReason", names: ["files:open", "files:save"] },
  { key: "clipboard", labelKey: "plugins.permission.clipboard", icon: Clipboard, defaultReasonKey: "plugins.permission.clipboardReason", names: ["clipboard:read", "clipboard:write"] },
  { key: "wasm", labelKey: "plugins.permission.wasm", icon: Cpu, defaultReasonKey: "plugins.permission.wasmReason", names: [] },
];

export interface PermissionRow {
  key: PermissionGroupKey;
  label: string;
  icon: LucideIcon;
  reason: string;
  required: boolean;
  /** The permission names in this row that the manifest declares. Empty for the WASM row. */
  names: PermissionName[];
  /** The hosts the manifest asks for (network row only). */
  hosts: string[];
}

/** The rows for a plugin, in the design's order. `storage` has no row: it is always granted. */
export function permissionRows(manifest: Pick<PluginManifest, "permissions" | "runtime">): PermissionRow[] {
  const declared = manifest.permissions ?? [];
  const rows: PermissionRow[] = [];
  for (const group of PERMISSION_GROUPS) {
    if (group.key === "wasm") {
      // Implied by the runtime. Informational: there is nothing to grant.
      if (manifest.runtime !== "web") rows.push({ key: "wasm", label: t(group.labelKey), icon: group.icon, reason: t(group.defaultReasonKey), required: true, names: [], hosts: [] });
      continue;
    }
    const members = declared.filter((permission) => group.names.includes(permission.name));
    if (members.length === 0) continue;
    const reasons = [...new Set(members.map((permission) => permission.reason.trim()).filter(Boolean))];
    rows.push({
      key: group.key,
      label: t(group.labelKey),
      icon: group.icon,
      reason: reasons.length > 0 ? reasons.join(" ") : t(group.defaultReasonKey),
      required: members.some((permission) => !permission.optional),
      names: members.map((permission) => permission.name),
      hosts: members.flatMap((permission) => permission.hosts ?? []),
    });
  }
  return rows;
}

/** Whether `name` is in the grants. `storage` is always on. */
export function isGranted(granted: readonly string[], name: PermissionName): boolean {
  return name === "storage" || granted.includes(name);
}
