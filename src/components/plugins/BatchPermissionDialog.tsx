import { useState } from "react";
import { Check, Puzzle } from "lucide-react";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { permissionRows, type PermissionGroupKey } from "@/plugins/permissions";
import { grantsFor } from "@/plugins/useInstallFlow";
import type { CatalogEntry } from "@/plugins/api";
import { PermissionList } from "./PermissionList";

type BatchEntry = Pick<CatalogEntry, "id" | "name" | "version" | "runtime" | "permissions">;

interface BatchPermissionDialogProps {
  entries: readonly BatchEntry[];
  /** The repository the plugins come from, as the dialog names it. */
  repoName: string;
  onCancel: () => void;
  /** The permission names to grant to each plugin, by id: the required ones and the optional ones left on. */
  onConfirm: (grants: Record<string, string[]>) => void;
}

/** The first-run wizard's single approval for several plugins: each one's permissions, one section per plugin. */
export function BatchPermissionDialog({ entries, repoName, onCancel, onConfirm }: BatchPermissionDialogProps) {
  const [enabled, setEnabled] = useState<Readonly<Record<string, ReadonlySet<PermissionGroupKey>>>>(() =>
    Object.fromEntries(entries.map((entry) => [entry.id, new Set(permissionRows(entry).filter((row) => !row.required).map((row) => row.key))])),
  );
  const ref = useDialogFocus(true, onCancel);
  const toggle = (id: string, key: PermissionGroupKey) =>
    setEnabled((current) => {
      const next = new Set(current[id]);
      if (!next.delete(key)) next.add(key);
      return { ...current, [id]: next };
    });
  const title = entries.length === 1 ? `Allow ${entries[0].name} to:` : `Allow ${entries.length} plugins to:`;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="modal-surface flex w-[540px] max-w-full flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3.5 px-5 pb-1.5 pt-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <span className="truncate text-xs text-muted-foreground">From {repoName}</span>
          </div>
        </div>
        <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto px-5 pb-1 pt-2">
          {entries.map((entry) => {
            const rows = permissionRows(entry);
            const set = enabled[entry.id] ?? new Set<PermissionGroupKey>();
            return (
              <section key={entry.id} aria-label={entry.name}>
                <h3 className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                  {entry.name}
                  <span className="text-xs font-normal text-muted-foreground">Version {entry.version}</span>
                </h3>
                {rows.length === 0 ? (
                  <p className="border-t border-border py-2.5 text-xs text-muted-foreground">Asks for no permissions.</p>
                ) : (
                  <PermissionList rows={rows} toggles={{ enabled: set, onToggle: (key) => toggle(entry.id, key) }} roomy />
                )}
              </section>
            );
          })}
        </div>
        <div className="mx-5 mb-4 mt-2 flex flex-col gap-2 rounded-lg bg-secondary p-3 text-xs text-foreground">
          <span className="flex items-center gap-2">
            <Check size={14} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-success" />
            SHA-256 checksums are checked against the {repoName} listing.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="min-w-[12rem] flex-1 text-xs text-muted-foreground">Optional permissions can be changed later in Installed.</span>
          <button type="button" onClick={onCancel} className="ml-auto inline-flex h-[30px] items-center rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(Object.fromEntries(entries.map((entry) => [entry.id, grantsFor(permissionRows(entry), enabled[entry.id] ?? new Set())])))}
            className="inline-flex h-[30px] items-center whitespace-nowrap rounded-md border border-primary-solid bg-primary-solid px-3 text-sm font-medium text-primary-foreground"
          >
            Allow and install
          </button>
        </div>
      </div>
    </div>
  );
}
