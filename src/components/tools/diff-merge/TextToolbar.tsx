import { useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronUp, CircleHelp, Settings } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { t, useT, type TKey } from "@/i18n";
import type { IgnoreMode } from "@/utils/diff-merge/blocks";
import type { HighlightMode } from "@/utils/diff-merge/inline";
import type { DiffSettings } from "@/utils/diff-merge/settings";
import { ModeSwitch, type Mode } from "./ModeSwitch";
import { AnchoredPanel, SettingsPanel, ShortcutsPanel } from "./Panels";

/** `cur` is the 0-based index of the current difference. Order: empty, identical, one, many. */
// eslint-disable-next-line react-refresh/only-export-components
export function counterText(n: number, cur: number, empty: boolean): string {
  if (empty) return t("diffMerge.counter.empty");
  if (n === 0) return t("diffMerge.counter.none");
  return t("diffMerge.counter.of", { count: n, current: cur + 1 });
}

const VIEWERS: [DiffSettings["viewer"], TKey][] = [["side", "diffMerge.viewer.side"], ["unified", "diffMerge.viewer.unified"]];
const IGNORES: [IgnoreMode, TKey][] = [
  ["none", "diffMerge.ignore.none"],
  ["trim", "diffMerge.ignore.trim"],
  ["whitespace", "diffMerge.ignore.whitespace"],
  ["whitespace-lines", "diffMerge.ignore.whitespaceLines"],
];
const HIGHLIGHTS: [HighlightMode, TKey][] = [["words", "diffMerge.highlight.words"], ["lines", "diffMerge.highlight.lines"], ["chars", "diffMerge.highlight.chars"], ["none", "diffMerge.highlight.none"]];

export interface TextToolbarProps {
  /** Effective settings: `viewer` is forced to "unified" in a narrow window. */
  settings: DiffSettings;
  onChange(patch: Partial<DiffSettings>): void;
  onReset(): void;
  count: number;
  current: number;
  empty: boolean;
  /** Narrow window: the viewer is forced to unified and its select is hidden. */
  narrow: boolean;
  onPrev(): void;
  onNext(): void;
  onSwap(): void;
  /** The Text | Folders switch renders only when this is given. */
  onModeChange?: (mode: Mode) => void;
}

const group = "flex items-center gap-2 border-s border-border ps-3 text-xs";
const trigger = "h-8 w-auto gap-[10px] rounded-md bg-card py-0 ps-3 pe-2 text-[13px] whitespace-nowrap";
const iconButton = "flex items-center rounded-[5px] p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none";

export function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, TKey][];
  onChange(v: T): void;
}) {
  const t = useT();
  return (
    <div className={`${group} text-muted-foreground`}>
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger aria-label={label} className={`${trigger} text-foreground`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>{t(text)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <div className={`${group} whitespace-nowrap text-foreground`}>
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function TextToolbar(props: TextToolbarProps) {
  const t = useT();
  const { settings, onChange, count, current, empty, narrow, onModeChange } = props;
  const gearRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<"settings" | "help" | null>(null);
  const toggle = (which: "settings" | "help") => setPanel((p) => (p === which ? null : which));
  const unified = settings.viewer === "unified";

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-5 py-3 whitespace-nowrap">
      <div className="flex flex-wrap items-center gap-3">
        {onModeChange && <ModeSwitch mode="text" onChange={onModeChange} />}
        <div className="flex items-center gap-0.5" style={{ opacity: empty ? 0.6 : 1 }}>
          <button type="button" className={iconButton} title={t("diffMerge.toolbar.previousTitle")} aria-label={t("diffMerge.shortcuts.previous")} disabled={count === 0} onClick={props.onPrev}>
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} title={t("diffMerge.toolbar.nextTitle")} aria-label={t("diffMerge.shortcuts.next")} disabled={count === 0} onClick={props.onNext}>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button type="button" className="toolbar-text-button" title={t("diffMerge.toolbar.swapTitle")} onClick={props.onSwap}>
            <ArrowRightLeft size={14} aria-hidden="true" />
            {t("diffMerge.toolbar.swap")}
          </button>
        </div>
        {!narrow && <Choice label={t("diffMerge.toolbar.viewer")} value={settings.viewer} options={VIEWERS} onChange={(viewer) => onChange({ viewer })} />}
        <Choice label={t("diffMerge.toolbar.ignore")} value={settings.ignore} options={IGNORES} onChange={(ignore) => onChange({ ignore })} />
        <Choice label={t("diffMerge.toolbar.highlight")} value={settings.highlight} options={HIGHLIGHTS} onChange={(highlight) => onChange({ highlight })} />
        <Toggle label={t("diffMerge.toolbar.collapse")} checked={settings.collapse} onChange={(collapse) => onChange({ collapse })} />
        <Toggle label={t("diffMerge.toolbar.syncScroll")} checked={settings.syncScroll && !unified} disabled={unified} onChange={(syncScroll) => onChange({ syncScroll })} />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <button ref={gearRef} type="button" className={iconButton} title={t("diffMerge.toolbar.settings")} aria-label={t("diffMerge.toolbar.settings")} aria-expanded={panel === "settings"} onClick={() => toggle("settings")}>
            <Settings size={15} aria-hidden="true" />
          </button>
          <button ref={helpRef} type="button" className={iconButton} title={t("diffMerge.shortcuts.title")} aria-label={t("diffMerge.shortcuts.title")} aria-expanded={panel === "help"} onClick={() => toggle("help")}>
            <CircleHelp size={15} aria-hidden="true" />
          </button>
        </div>
        <span
          className="border-s border-border ps-3 text-xs tabular-nums"
          style={{ color: empty ? "hsl(var(--muted-foreground))" : count === 0 ? "hsl(var(--success))" : "hsl(var(--foreground))" }}
          aria-live="polite"
        >
          {counterText(count, current, empty)}
        </span>
      </div>
      <AnchoredPanel open={panel === "settings"} onClose={() => setPanel(null)} anchorRef={gearRef} width={300}>
        <SettingsPanel settings={settings} onChange={onChange} onReset={props.onReset} />
      </AnchoredPanel>
      <AnchoredPanel open={panel === "help"} onClose={() => setPanel(null)} anchorRef={helpRef} width={340}>
        <ShortcutsPanel />
      </AnchoredPanel>
    </div>
  );
}
