import type { KeyboardEvent } from "react";
import { isMobileApp } from "@/lib/platform";
import { useT, type TKey } from "@/i18n";

export type Mode = "text" | "folders";
const MODES: [Mode, TKey][] = [["text", "diffMerge.mode.text"], ["folders", "diffMerge.mode.folders"]];

/** The Text | Folders switch: a radio group, sized and styled as in the spec. */
export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange(m: Mode): void }) {
  const t = useT();
  // Folder compare reads folders on disk, which a phone does not offer.
  if (isMobileApp()) return null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = mode === "text" ? "folders" : "text";
    onChange(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("diffMerge.mode")}
      onKeyDown={onKeyDown}
      className="flex h-8 items-center gap-0.5 rounded-[7px] border bg-muted p-0.5"
      style={{ borderColor: "hsl(var(--foreground) / .08)" }}
    >
      {MODES.map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-mode={value}
            className={`rounded-[5px] px-3 py-[3px] text-xs font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}
            style={active ? { background: "var(--surface-raised)", boxShadow: "0 0 0 1px hsl(var(--muted-foreground)), 0 1px 3px rgb(15 28 48 / .12)" } : undefined}
            onClick={() => !active && onChange(value)}
          >
            {t(label)}
          </button>
        );
      })}
    </div>
  );
}
