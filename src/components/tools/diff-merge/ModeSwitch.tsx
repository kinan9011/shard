import type { KeyboardEvent } from "react";

export type Mode = "text" | "folders";
const MODES: [Mode, string][] = [["text", "Text"], ["folders", "Folders"]];

/** The Text | Folders switch: a radio group, sized and styled as in the spec. */
export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange(m: Mode): void }) {
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
      aria-label="Mode"
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
            {label}
          </button>
        );
      })}
    </div>
  );
}
