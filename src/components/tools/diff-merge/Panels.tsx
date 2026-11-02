import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Switch } from "@/components/ui/switch";
import type { DiffSettings } from "@/utils/diff-merge/settings";

interface AnchoredPanelProps {
  open: boolean;
  onClose(): void;
  anchorRef: RefObject<HTMLElement>;
  width: number;
  /** Distance from the top of the nearest positioned ancestor. The design uses 54px. */
  top?: number;
  /** "end" lines the right edges up (toolbar buttons); "start" opens to the right of the anchor. */
  align?: "end" | "start";
  role?: string;
  children: ReactNode;
}

/**
 * Popover under a toolbar button: right edges aligned, closes on Escape or a pointerdown outside
 * (the anchor excepted, so its own click can toggle), focuses its first control when it opens.
 * The repo has no popover component; folder mode's action menu reuses this one.
 */
export function AnchoredPanel({ open, onClose, anchorRef, width, top = 54, align = "end", role = "dialog", children }: AnchoredPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [offset, setOffset] = useState(8);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const parent = panel.current?.offsetParent?.getBoundingClientRect();
    // No layout (jsdom): keep the default.
    if (!open || !anchor || !parent || (anchor.width === 0 && parent.width === 0)) return;
    setOffset(Math.max(8, align === "start" ? anchor.right - parent.left + 8 : parent.right - anchor.right));
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close.current();
      anchorRef.current?.focus();
    };
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    panel.current?.querySelector<HTMLElement>("button, [role=switch], [role=menuitem], input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      role={role}
      className="absolute z-10 overflow-hidden rounded-lg border bg-card text-xs shadow-lg"
      style={{ top, [align === "start" ? "left" : "right"]: offset, width, borderColor: "hsl(var(--foreground) / .12)" }}
    >
      {children}
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <div className="flex items-center justify-between rounded-[5px] px-2 py-[7px]">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} className="dm-switch-sm h-[19px] w-[34px]" />
    </div>
  );
}

const stepper = "w-6 text-center text-muted-foreground hover:bg-muted hover:text-foreground";

export function SettingsPanel({ settings, onChange, onReset }: { settings: DiffSettings; onChange(patch: Partial<DiffSettings>): void; onReset(): void }) {
  const setContext = (n: number) => onChange({ contextLines: Math.min(20, Math.max(0, n)) });
  return (
    <>
      <div className="px-[14px] pb-2 pt-3 font-semibold">Compare settings</div>
      <div className="flex flex-col px-1.5 pb-1.5">
        <div className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-[7px]">
          <div className="flex flex-col">
            <span>Context lines</span>
            <span className="text-[11px] text-muted-foreground">Kept around changes when collapsed</span>
          </div>
          <div className="flex h-[26px] items-center overflow-hidden rounded-[5px] border border-input">
            <button type="button" className={stepper} aria-label="Fewer context lines" onClick={() => setContext(settings.contextLines - 1)}>−</button>
            <span data-testid="context-lines" className="w-7 border-x border-border text-center tabular-nums">{settings.contextLines}</span>
            <button type="button" className={stepper} aria-label="More context lines" onClick={() => setContext(settings.contextLines + 1)}>+</button>
          </div>
        </div>
        <SwitchRow label="Wrap long lines" checked={settings.wrap} onChange={(wrap) => onChange({ wrap })} />
        <SwitchRow label="Show whitespace" checked={settings.showWhitespace} onChange={(showWhitespace) => onChange({ showWhitespace })} />
        <SwitchRow label="Ignore case" checked={settings.ignoreCase} onChange={(ignoreCase) => onChange({ ignoreCase })} />
        <SwitchRow label="Detect language from content" checked={settings.detectLanguage} onChange={(detectLanguage) => onChange({ detectLanguage })} />
      </div>
      <div className="flex justify-end border-t px-2.5 py-2" style={{ borderColor: "hsl(var(--border) / .7)" }}>
        <button type="button" className="toolbar-text-button" onClick={onReset}>Reset to defaults</button>
      </div>
    </>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ["Next difference", ["F7"]],
  ["Previous difference", ["Shift+F7"]],
  ["Push change to the right", ["Ctrl+Shift+→"]],
  ["Push change to the left", ["Ctrl+Shift+←"]],
  ["Swap sides", ["Ctrl+Shift+S"]],
  ["Collapse unchanged lines", ["Ctrl+Shift+C"]],
  ["Undo / redo", ["Ctrl+Z", "Ctrl+Shift+Z"]],
];

const TEXT_NOTE = "Click the change map on the right edge to jump to a change.";

export function ShortcutsPanel({ items = SHORTCUTS, note = TEXT_NOTE }: { items?: [string, string[]][]; note?: string }) {
  return (
    <>
      <div className="px-[14px] pb-1.5 pt-3 font-semibold">Keyboard shortcuts</div>
      <div className="grid items-center gap-x-4 gap-y-2 px-[14px] pb-3 pt-1.5" style={{ gridTemplateColumns: "1fr auto" }}>
        {items.map(([label, keys]) => (
          <div key={label} className="contents">
            <span>{label}</span>
            <span className="flex gap-1">
              {keys.map((key) => (
                <kbd key={key} className="rounded-[5px] border border-input bg-muted px-[7px] py-0.5 font-sans">{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t px-[14px] py-[9px] text-muted-foreground" style={{ borderColor: "hsl(var(--border) / .7)" }}>
        {note}
      </div>
    </>
  );
}
