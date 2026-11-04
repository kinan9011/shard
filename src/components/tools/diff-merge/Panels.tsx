import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Switch } from "@/components/ui/switch";
import { useT, type TKey } from "@/i18n";
import type { DiffSettings } from "@/utils/diff-merge/settings";

interface AnchoredPanelProps {
  open: boolean;
  onClose(): void;
  anchorRef: RefObject<HTMLElement>;
  width: number;
  /** "end" lines the right edges up (toolbar buttons); "start" opens to the right of the anchor. */
  align?: "end" | "start";
  role?: string;
  children: ReactNode;
}

const MARGIN = 8;

/**
 * Popover under a button: closes on Escape, a pointerdown outside (the anchor excepted, so its own click can toggle)
 * or a scroll elsewhere, and focuses its first control when it opens. It is portalled to <body> and positioned with
 * `fixed`, so neither the content area's overflow clipping nor the sidebar can hide any part of it.
 * The repo has no popover component; the plugin menus, folder mode's action menu and the pinned picker reuse this one.
 */
export function AnchoredPanel({ open, onClose, anchorRef, width, align = "end", role = "dialog", children }: AnchoredPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [pos, setPos] = useState<CSSProperties>({ top: 54, right: MARGIN });
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      // No layout (jsdom): keep the default.
      if (!anchor || (anchor.width === 0 && anchor.height === 0)) return;
      // Stay inside the content area (right of the sidebar), not just the window.
      const area = anchorRef.current?.closest(".workspace-content")?.getBoundingClientRect();
      const minLeft = (area?.left ?? 0) + MARGIN;
      const maxRight = (area?.right ?? window.innerWidth) - MARGIN;
      const wanted = align === "start" ? anchor.right + MARGIN : anchor.right - width;
      const left = Math.max(minLeft, Math.min(wanted, maxRight - width));
      const below = window.innerHeight - anchor.bottom - 6 - MARGIN;
      const above = anchor.top - 6 - MARGIN;
      // Open upward when the content does not fit below and there is more room above.
      if ((panel.current?.scrollHeight ?? 0) > below && above > below) {
        setPos({ bottom: window.innerHeight - anchor.top + 6, left, maxHeight: above });
      } else {
        setPos({ top: anchor.bottom + 6, left, maxHeight: Math.max(120, below) });
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorRef, align, width]);

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
    // A fixed panel does not follow its anchor, so scrolling the page behind it closes it.
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("scroll", onScroll, true);
    panel.current?.querySelector<HTMLElement>("button, [role=switch], [role=menuitem], input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role={role}
      className="fixed z-[90] overflow-y-auto rounded-lg border bg-card text-xs shadow-lg"
      style={{ ...pos, width, borderColor: "hsl(var(--foreground) / .12)" }}
    >
      {children}
    </div>,
    document.body,
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
  const t = useT();
  const setContext = (n: number) => onChange({ contextLines: Math.min(20, Math.max(0, n)) });
  return (
    <>
      <div className="px-[14px] pb-2 pt-3 font-semibold">{t("diffMerge.settings.title")}</div>
      <div className="flex flex-col px-1.5 pb-1.5">
        <div className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-[7px]">
          <div className="flex flex-col">
            <span>{t("diffMerge.settings.contextLines")}</span>
            <span className="text-[11px] text-muted-foreground">{t("diffMerge.settings.contextHint")}</span>
          </div>
          <div className="flex h-[26px] items-center overflow-hidden rounded-[5px] border border-input">
            <button type="button" className={stepper} aria-label={t("diffMerge.settings.fewer")} onClick={() => setContext(settings.contextLines - 1)}>−</button>
            <span data-testid="context-lines" className="w-7 border-x border-border text-center tabular-nums">{settings.contextLines}</span>
            <button type="button" className={stepper} aria-label={t("diffMerge.settings.more")} onClick={() => setContext(settings.contextLines + 1)}>+</button>
          </div>
        </div>
        <SwitchRow label={t("diffMerge.settings.wrap")} checked={settings.wrap} onChange={(wrap) => onChange({ wrap })} />
        <SwitchRow label={t("diffMerge.settings.showWhitespace")} checked={settings.showWhitespace} onChange={(showWhitespace) => onChange({ showWhitespace })} />
        <SwitchRow label={t("diffMerge.settings.ignoreCase")} checked={settings.ignoreCase} onChange={(ignoreCase) => onChange({ ignoreCase })} />
        <SwitchRow label={t("diffMerge.settings.detectLanguage")} checked={settings.detectLanguage} onChange={(detectLanguage) => onChange({ detectLanguage })} />
      </div>
      <div className="flex justify-end border-t px-2.5 py-2" style={{ borderColor: "hsl(var(--border) / .7)" }}>
        <button type="button" className="toolbar-text-button" onClick={onReset}>{t("diffMerge.settings.reset")}</button>
      </div>
    </>
  );
}

const SHORTCUTS: [TKey, string[]][] = [
  ["diffMerge.shortcuts.next", ["F7"]],
  ["diffMerge.shortcuts.previous", ["Shift+F7"]],
  ["diffMerge.shortcuts.pushRight", ["Ctrl+Shift+→"]],
  ["diffMerge.shortcuts.pushLeft", ["Ctrl+Shift+←"]],
  ["diffMerge.shortcuts.swap", ["Ctrl+Shift+S"]],
  ["diffMerge.shortcuts.collapse", ["Ctrl+Shift+C"]],
  ["diffMerge.shortcuts.undoRedo", ["Ctrl+Z", "Ctrl+Shift+Z"]],
];

const TEXT_NOTE: TKey = "diffMerge.shortcuts.note";

export function ShortcutsPanel({ items = SHORTCUTS, note = TEXT_NOTE }: { items?: [TKey, string[]][]; note?: TKey }) {
  const t = useT();
  return (
    <>
      <div className="px-[14px] pb-1.5 pt-3 font-semibold">{t("diffMerge.shortcuts.title")}</div>
      <div className="grid items-center gap-x-4 gap-y-2 px-[14px] pb-3 pt-1.5" style={{ gridTemplateColumns: "1fr auto" }}>
        {items.map(([label, keys]) => (
          <div key={label} className="contents">
            <span>{t(label)}</span>
            <span className="flex gap-1">
              {keys.map((key) => (
                <kbd key={key} className="rounded-[5px] border border-input bg-muted px-[7px] py-0.5 font-sans">{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t px-[14px] py-[9px] text-muted-foreground" style={{ borderColor: "hsl(var(--border) / .7)" }}>
        {t(note)}
      </div>
    </>
  );
}
