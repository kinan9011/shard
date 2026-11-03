import { useDialogFocus } from "@/components/app/useDialogFocus";
import { cn } from "@/lib/utils";

const BUTTON = "inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border px-3 text-sm font-medium disabled:opacity-60";

/** The confirm step before a plugin is uninstalled. Used by the Installed tab and the plugin detail. */
export function ConfirmUninstall({ plugin, onCancel, onConfirm }: { plugin: { manifest: { name: string } }; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogFocus(true, onCancel);
  const title = `Uninstall ${plugin.manifest.name}?`;
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={ref} role="alertdialog" aria-modal="true" aria-label={title} className="modal-surface flex w-[400px] max-w-full flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">Its files and the data it stored are removed.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onCancel} className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={cn(BUTTON, "border-destructive bg-destructive text-destructive-foreground")}>
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}
