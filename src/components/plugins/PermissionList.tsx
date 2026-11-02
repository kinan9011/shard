import { Switch } from "@/components/ui/switch";
import type { PermissionGroupKey, PermissionRow } from "@/plugins/permissions";

interface PermissionListProps {
  rows: readonly PermissionRow[];
  /** The install dialog: optional rows get a switch. `enabled` holds the keys of the rows that are on. */
  toggles?: { enabled: ReadonlySet<PermissionGroupKey>; onToggle: (key: PermissionGroupKey) => void };
  /** The roomier rows of the dialog. */
  roomy?: boolean;
  /** Rows an update adds: they get a "New" tag. */
  isNew?: (row: PermissionRow) => boolean;
}

/** The permissions of a plugin, one row each: icon, name, reason, and whether it is required. */
export function PermissionList({ rows, toggles, roomy, isNew }: PermissionListProps) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.key} className={`flex items-center gap-3 border-t border-border ${roomy ? "py-2.5" : "py-2"}`}>
          <span className="grid size-[30px] shrink-0 place-items-center rounded-[7px] bg-secondary text-foreground">
            <row.icon size={15} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2 font-medium text-foreground">
              {row.label}
              {isNew?.(row) && (
                <span className="inline-flex h-5 items-center rounded-[5px] bg-warning/15 px-[7px] text-2xs font-medium text-warning">New</span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{row.reason}</span>
          </div>
          {toggles && !row.required ? (
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              Optional
              <Switch
                aria-label={row.label}
                checked={toggles.enabled.has(row.key)}
                onCheckedChange={() => toggles.onToggle(row.key)}
                className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5"
              />
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">{row.required ? "Required" : "Optional"}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
