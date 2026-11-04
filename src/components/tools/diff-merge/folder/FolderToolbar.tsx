import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, RefreshCw, Search } from "lucide-react";
import type { CompareBy, RowKind } from "@/utils/diff-merge/folder";
import { ModeSwitch, type Mode } from "../ModeSwitch";
import { AnchoredPanel, ShortcutsPanel } from "../Panels";
import { Choice } from "../TextToolbar";

const COMPARE: [CompareBy, string][] = [["content", "Content"], ["size-date", "Size and date"], ["size", "Size"]];

const FOLDER_SHORTCUTS: [string, string[]][] = [
  ["Change the action", ["Space"]],
  ["Copy left to right", ["Ctrl+Shift+→"]],
  ["Copy right to left", ["Ctrl+Shift+←"]],
  ["Ignore", ["Delete"]],
  ["Merge by hand below", ["Enter"]],
  ["Start merge", ["Ctrl+Enter"]],
  ["Move the selection", ["↑", "↓"]],
];

const CHIPS: { kind: RowKind; label: string; title: string }[] = [
  { kind: "left", label: "Left only", title: "Only on the left" },
  { kind: "right", label: "Right only", title: "Only on the right" },
  { kind: "diff", label: "Different", title: "Different" },
  { kind: "same", label: "Identical", title: "Identical" },
];

function ChipIcon({ kind }: { kind: RowKind }) {
  if (kind === "left") return <span className="flex text-destructive"><ArrowRight size={13} aria-hidden="true" /></span>;
  if (kind === "right") return <span className="flex text-success"><ArrowLeft size={13} aria-hidden="true" /></span>;
  return <span aria-hidden="true" className={`w-[13px] text-center font-bold ${kind === "diff" ? "text-warning" : ""}`}>{kind === "diff" ? "≠" : "="}</span>;
}

interface Props {
  onModeChange(mode: Mode): void;
  counts: Record<RowKind, number>;
  show: ReadonlySet<RowKind>;
  onToggle(kind: RowKind): void;
  compareBy: CompareBy;
  onCompareBy(by: CompareBy): void;
  query: string;
  onQuery(q: string): void;
  canRefresh: boolean;
  onRefresh(): void;
  /** Copies the plan would make: toRight + toLeft. */
  startCount: number;
  busy: boolean;
  onStart(): void;
}

export function FolderToolbar(props: Props) {
  const helpRef = useRef<HTMLButtonElement>(null);
  const [help, setHelp] = useState(false);
  const { startCount, busy } = props;
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-5 py-3 whitespace-nowrap">
      <div className="flex flex-wrap items-center gap-3">
        <ModeSwitch mode="folders" onChange={props.onModeChange} />
        <button type="button" className="toolbar-text-button" title="Compare again" disabled={!props.canRefresh || busy} onClick={props.onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </button>
        <div className="flex items-center gap-2 border-l border-border pl-3 text-xs text-muted-foreground">
          Show
          <div className="flex gap-0.5 rounded-[7px] border bg-muted p-0.5" style={{ borderColor: "hsl(var(--border) / .7)" }}>
            {CHIPS.map(({ kind, label, title }) => {
              const on = props.show.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  title={title}
                  aria-label={`${label} ${props.counts[kind]}`}
                  aria-pressed={on}
                  onClick={() => props.onToggle(kind)}
                  className={`flex items-center gap-1.5 rounded-[5px] px-[9px] py-1 text-xs ${on ? "text-foreground" : "text-muted-foreground"}`}
                  style={on ? { background: "var(--surface-raised)", boxShadow: "0 0 0 1px hsl(var(--muted-foreground))" } : undefined}
                >
                  <ChipIcon kind={kind} />
                  {label}
                  <span className="tabular-nums text-muted-foreground">{props.counts[kind]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Choice label="Compare by" value={props.compareBy} options={COMPARE} onChange={props.onCompareBy} />
        <label className="flex h-8 w-[200px] items-center gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] text-muted-foreground">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Filter by name or path"
            aria-label="Filter by name or path"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          ref={helpRef}
          type="button"
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
          aria-expanded={help}
          className="flex rounded-[5px] p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setHelp((v) => !v)}
        >
          <CircleHelp size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={startCount === 0 || busy}
          onClick={props.onStart}
          className="flex h-8 items-center gap-2 whitespace-nowrap rounded bg-primary-solid px-3 text-[13px] font-medium text-primary-solid-foreground shadow-sm disabled:opacity-60"
        >
          {startCount ? `Start merge (${startCount})` : "Start merge"}
        </button>
      </div>
      <AnchoredPanel open={help} onClose={() => setHelp(false)} anchorRef={helpRef} width={340}>
        <ShortcutsPanel items={FOLDER_SHORTCUTS} note="Select several rows to change them together." />
      </AnchoredPanel>
    </div>
  );
}
