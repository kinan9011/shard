import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, RefreshCw, Search } from "lucide-react";
import { useT, type TKey } from "@/i18n";
import type { CompareBy, RowKind } from "@/utils/diff-merge/folder";
import { ModeSwitch, type Mode } from "../ModeSwitch";
import { AnchoredPanel, ShortcutsPanel } from "../Panels";
import { Choice } from "../TextToolbar";

const COMPARE: [CompareBy, TKey][] = [["content", "diffMerge.folder.compare.content"], ["size-date", "diffMerge.folder.compare.sizeDate"], ["size", "diffMerge.folder.col.size"]];

const FOLDER_SHORTCUTS: [TKey, string[]][] = [
  ["diffMerge.folder.shortcuts.change", ["Space"]],
  ["diffMerge.folder.copyLeftToRight", ["Ctrl+Shift+→"]],
  ["diffMerge.folder.copyRightToLeft", ["Ctrl+Shift+←"]],
  ["diffMerge.folder.menu.ignore", ["Delete"]],
  ["diffMerge.folder.mergeByHand", ["Enter"]],
  ["diffMerge.folder.startMerge", ["Ctrl+Enter"]],
  ["diffMerge.folder.shortcuts.move", ["↑", "↓"]],
];

const CHIPS: { kind: RowKind; label: TKey; title: TKey }[] = [
  { kind: "left", label: "diffMerge.folder.chip.leftOnly", title: "diffMerge.folder.chip.leftOnlyTitle" },
  { kind: "right", label: "diffMerge.folder.chip.rightOnly", title: "diffMerge.folder.chip.rightOnlyTitle" },
  { kind: "diff", label: "diffMerge.folder.chip.different", title: "diffMerge.folder.chip.different" },
  { kind: "same", label: "diffMerge.folder.chip.identical", title: "diffMerge.folder.chip.identical" },
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
  const t = useT();
  const helpRef = useRef<HTMLButtonElement>(null);
  const [help, setHelp] = useState(false);
  const { startCount, busy } = props;
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-5 py-3 whitespace-nowrap">
      <div className="flex flex-wrap items-center gap-3">
        <ModeSwitch mode="folders" onChange={props.onModeChange} />
        <button type="button" className="toolbar-text-button" title={t("diffMerge.folder.compareAgain")} disabled={!props.canRefresh || busy} onClick={props.onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("diffMerge.folder.refresh")}
        </button>
        <div className="flex items-center gap-2 border-s border-border ps-3 text-xs text-muted-foreground">
          {t("diffMerge.folder.show")}
          <div className="flex gap-0.5 rounded-[7px] border bg-muted p-0.5" style={{ borderColor: "hsl(var(--border) / .7)" }}>
            {CHIPS.map(({ kind, label, title }) => {
              const on = props.show.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  title={t(title)}
                  aria-label={`${t(label)} ${props.counts[kind]}`}
                  aria-pressed={on}
                  onClick={() => props.onToggle(kind)}
                  className={`flex items-center gap-1.5 rounded-[5px] px-[9px] py-1 text-xs ${on ? "text-foreground" : "text-muted-foreground"}`}
                  style={on ? { background: "var(--surface-raised)", boxShadow: "0 0 0 1px hsl(var(--muted-foreground))" } : undefined}
                >
                  <ChipIcon kind={kind} />
                  {t(label)}
                  <span className="tabular-nums text-muted-foreground">{props.counts[kind]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Choice label={t("diffMerge.folder.compareBy")} value={props.compareBy} options={COMPARE} onChange={props.onCompareBy} />
        <label className="flex h-8 w-[200px] items-center gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] text-muted-foreground">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder={t("diffMerge.folder.filter")}
            aria-label={t("diffMerge.folder.filter")}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          ref={helpRef}
          type="button"
          title={t("diffMerge.shortcuts.title")}
          aria-label={t("diffMerge.shortcuts.title")}
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
          {startCount ? t("diffMerge.folder.startMergeCount", { count: startCount }) : t("diffMerge.folder.startMerge")}
        </button>
      </div>
      <AnchoredPanel open={help} onClose={() => setHelp(false)} anchorRef={helpRef} width={340}>
        <ShortcutsPanel items={FOLDER_SHORTCUTS} note="diffMerge.folder.shortcuts.note" />
      </AnchoredPanel>
    </div>
  );
}
