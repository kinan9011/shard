import { useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, ChevronUp, CircleHelp, Settings } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { IgnoreMode } from "@/utils/diff-merge/blocks";
import type { HighlightMode } from "@/utils/diff-merge/inline";
import type { DiffSettings } from "@/utils/diff-merge/settings";
import { ModeSwitch, type Mode } from "./ModeSwitch";
import { AnchoredPanel, SettingsPanel, ShortcutsPanel } from "./Panels";

/** `cur` is the 0-based index of the current difference. Order: empty, identical, one, many. */
// eslint-disable-next-line react-refresh/only-export-components
export function counterText(n: number, cur: number, empty: boolean): string {
  if (empty) return "Nothing to compare";
  if (n === 0) return "No differences";
  if (n === 1) return "1 of 1 difference";
  return `${cur + 1} of ${n} differences`;
}

const VIEWERS: [DiffSettings["viewer"], string][] = [["side", "Side-by-side"], ["unified", "Unified"]];
const IGNORES: [IgnoreMode, string][] = [
  ["none", "Do not ignore"],
  ["trim", "Trim whitespace"],
  ["whitespace", "Ignore whitespace"],
  ["whitespace-lines", "Ignore whitespace and empty lines"],
];
const HIGHLIGHTS: [HighlightMode, string][] = [["words", "Words"], ["lines", "Lines"], ["chars", "Characters"], ["none", "None"]];

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

const group = "flex items-center gap-2 border-l border-border pl-3 text-xs";
const trigger = "h-8 w-auto gap-[10px] rounded-md bg-card py-0 pl-3 pr-2 text-[13px] whitespace-nowrap";
const iconButton = "flex items-center rounded-[5px] p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none";

export function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
}) {
  return (
    <div className={`${group} text-muted-foreground`}>
      {label}
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger aria-label={label} className={`${trigger} text-foreground`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>{text}</SelectItem>
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
          <button type="button" className={iconButton} title="Previous difference (Shift+F7)" aria-label="Previous difference" disabled={count === 0} onClick={props.onPrev}>
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} title="Next difference (F7)" aria-label="Next difference" disabled={count === 0} onClick={props.onNext}>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button type="button" className="toolbar-text-button" title="Swap sides (Ctrl+Shift+S)" onClick={props.onSwap}>
            <ArrowRightLeft size={14} aria-hidden="true" />
            Swap
          </button>
        </div>
        {!narrow && <Choice label="Viewer" value={settings.viewer} options={VIEWERS} onChange={(viewer) => onChange({ viewer })} />}
        <Choice label="Ignore" value={settings.ignore} options={IGNORES} onChange={(ignore) => onChange({ ignore })} />
        <Choice label="Highlight" value={settings.highlight} options={HIGHLIGHTS} onChange={(highlight) => onChange({ highlight })} />
        <Toggle label="Collapse unchanged" checked={settings.collapse} onChange={(collapse) => onChange({ collapse })} />
        <Toggle label="Sync scroll" checked={settings.syncScroll && !unified} disabled={unified} onChange={(syncScroll) => onChange({ syncScroll })} />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <button ref={gearRef} type="button" className={iconButton} title="Settings" aria-label="Settings" aria-expanded={panel === "settings"} onClick={() => toggle("settings")}>
            <Settings size={15} aria-hidden="true" />
          </button>
          <button ref={helpRef} type="button" className={iconButton} title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-expanded={panel === "help"} onClick={() => toggle("help")}>
            <CircleHelp size={15} aria-hidden="true" />
          </button>
        </div>
        <span
          className="border-l border-border pl-3 text-xs tabular-nums"
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
