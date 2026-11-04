import { useState } from "react";
import { Check, Puzzle, TriangleAlert } from "lucide-react";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { permissionRows, type PermissionGroupKey, type PermissionRow } from "@/plugins/permissions";
import { grantsFor } from "@/plugins/useInstallFlow";
import type { CatalogEntry } from "@/plugins/api";
import { PermissionList } from "./PermissionList";

export type PermissionDialogMode = "install" | "update" | "manage";

interface PermissionDialogProps {
  /** "install" (default), "update" (a new version; the rows it adds are tagged New) or "manage" (an installed plugin's grants). */
  mode?: PermissionDialogMode;
  /** The permission names the plugin has now (update and manage): they decide which switches start on. */
  granted?: readonly string[];
  /** The permission names an update adds. They start on and are tagged New. */
  newPermissions?: readonly string[];
  entry: Pick<CatalogEntry, "name" | "version" | "runtime" | "permissions" | "repo">;
  /** The plugin comes from the official repository. */
  official: boolean;
  /** Its SHA-256 can be checked against a repository's listing. False for a sideload. */
  verified: boolean;
  onCancel: () => void;
  /** The permission names to grant: the required ones and the optional ones left on. */
  onConfirm: (grants: string[]) => void;
}

/** Screen 07 A: what the plugin asks for, where it comes from, and the choice to install. */
export function PermissionDialog({ mode = "install", granted, newPermissions = [], entry, official, verified, onCancel, onConfirm }: PermissionDialogProps) {
  const rows = permissionRows(entry);
  const isNew = (row: PermissionRow) => row.names.some((name) => newPermissions.includes(name));
  // Optional permissions start on, except in update and manage, where they keep the choice made before (new ones start on).
  const [enabled, setEnabled] = useState<ReadonlySet<PermissionGroupKey>>(
    () => new Set(rows.filter((row) => !row.required && (!granted || isNew(row) || row.names.some((name) => granted.includes(name)))).map((row) => row.key)),
  );
  const ref = useDialogFocus(true, onCancel);
  const toggle = (key: PermissionGroupKey) =>
    setEnabled((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const title = `Allow ${entry.name} to:`;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-surface flex w-[540px] max-w-full flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3.5 px-5 pb-1.5 pt-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <span className="truncate text-xs text-muted-foreground">{`${mode === "update" ? "Update to version" : "Version"} ${entry.version} from ${entry.repo.replace(/^https:\/\//, "")}`}</span>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-1 pt-2">
          <PermissionList rows={rows} toggles={{ enabled, onToggle: toggle }} roomy isNew={isNew} />
        </div>
        <div className="mx-5 mb-4 mt-2 flex flex-col gap-2 rounded-lg bg-secondary p-3 text-xs text-foreground">
          {verified ? (
            <span className="flex items-center gap-2">
              <Check size={14} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-success" />
              SHA-256 checksum matches the release.
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-warning" />
              Unverified. It doesn't come from one of your repositories, so its checksum can't be checked.
            </span>
          )}
          {!official && (
            <span className="flex items-center gap-2">
              <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-warning" />
              Third-party plugin. It isn't listed in the Shard Official repository.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="min-w-[12rem] flex-1 text-xs text-muted-foreground">{mode === "manage" ? "" : "Optional permissions can be changed later in Installed."}</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto inline-flex h-[30px] items-center rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(grantsFor(rows, enabled))}
            className="inline-flex h-[30px] items-center whitespace-nowrap rounded-md border border-primary-solid bg-primary-solid px-3 text-sm font-medium text-primary-foreground"
          >
            {mode === "install" ? "Allow and install" : mode === "update" ? "Allow and update" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
