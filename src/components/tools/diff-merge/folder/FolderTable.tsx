import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, Ban, Database, File, FileCode, FileText, Folder, Image } from "lucide-react";
import type { FolderEntry } from "@/lib/desktop";
import { allowedActions, formatDate, formatSize, type FileRow, type FolderGroup, type MergeAction } from "@/utils/diff-merge/folder";

export type TableCommand =
  | { type: "cycle" }
  | { type: "set"; action: MergeAction }
  | { type: "move"; delta: 1 | -1 }
  | { type: "hand" }
  | { type: "merge" };

export const COLUMNS = "minmax(0,1fr) 96px 136px 52px 136px 96px minmax(0,1fr)";
export const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 30;
/** Rows past this count are windowed. */
const WINDOW_AFTER = 2000;
const OVERSCAN = 10;

type Item = { type: "folder"; group: FolderGroup } | { type: "row"; row: FileRow };

const EXT_ICON: Record<string, typeof File> = {};
for (const e of "go ts tsx js jsx mjs rs py java c cpp h cs rb php sh css scss html json yaml yml toml mod xml sql".split(" ")) EXT_ICON[e] = FileCode;
for (const e of "db sqlite sqlite3 db-shm db-wal".split(" ")) EXT_ICON[e] = Database;
for (const e of "jpg jpeg png gif webp svg ico bmp avif".split(" ")) EXT_ICON[e] = Image;
for (const e of "txt md sum attrs log csv lock ini env".split(" ")) EXT_ICON[e] = FileText;
const iconFor = (name: string) => EXT_ICON[name.slice(name.indexOf(".") + 1).toLowerCase()] ?? EXT_ICON[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? File;

const CHIP = {
  toRight: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / .14)", title: "Copy left to right" },
  toLeft: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / .14)", title: "Copy right to left" },
  ignore: { color: "hsl(var(--muted-foreground))", bg: "transparent", title: "Ignored" },
  none: { color: "hsl(var(--warning))", bg: "hsl(var(--warning) / .14)", title: "Different, no action yet" },
} as const;

function ChipIcon({ action }: { action: MergeAction }) {
  if (action === "toRight") return <ArrowRight size={13} aria-hidden="true" />;
  if (action === "toLeft") return <ArrowLeft size={13} aria-hidden="true" />;
  if (action === "ignore") return <Ban size={13} aria-hidden="true" />;
  return <span aria-hidden="true" style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>≠</span>;
}

function nameColor(row: FileRow, side: "left" | "right") {
  if (row.kind === "diff") return "hsl(var(--warning))";
  if (row.kind === side) return side === "left" ? "hsl(var(--destructive))" : "hsl(var(--success))";
  return "inherit";
}

function Side({ row, side, entry }: { row: FileRow; side: "left" | "right"; entry: FolderEntry | null }) {
  const Icon = iconFor(row.name);
  const dim = row.action === "ignore" ? 0.5 : 1;
  const name = (
    <span className="flex min-w-0 items-center gap-2" role="gridcell" style={{ paddingLeft: 16 + row.depth * 20, opacity: dim, color: nameColor(row, side) }}>
      {entry && <Icon size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="truncate">{entry ? row.name : ""}</span>
    </span>
  );
  const size = <span role="gridcell" className="text-right" style={{ paddingRight: 12, opacity: dim }}>{entry ? formatSize(entry.size) : ""}</span>;
  const date = <span role="gridcell" className="text-muted-foreground" style={{ paddingLeft: 12, opacity: dim }}>{entry ? formatDate(entry.modifiedMs) : ""}</span>;
  return side === "left" ? <>{name}{size}{date}</> : <>{date}{size}{name}</>;
}

interface RowProps {
  row: FileRow;
  selected: boolean;
  onRowClick(row: FileRow, e: MouseEvent): void;
  onChip(row: FileRow): void;
  onMenu(row: FileRow, el: HTMLElement): void;
}

/** One file row. Memoised: a click on one row's action re-renders that row, not the whole table. */
const FolderRow = memo(function FolderRow({ row, selected, onRowClick, onChip, onMenu }: RowProps) {
  const chip = CHIP[row.action];
  // `none` on a row that has a single side reads as "no action", not "different".
  const title = row.action === "none" && row.kind !== "diff" ? "No action yet" : chip.title;
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={(e) => onRowClick(row, e)}
      onContextMenu={(e) => {
        if (allowedActions(row.kind).length < 2) return;
        e.preventDefault();
        onMenu(row, e.currentTarget.querySelector("button") ?? e.currentTarget);
      }}
      className="grid items-center whitespace-nowrap tabular-nums"
      style={{
        gridTemplateColumns: COLUMNS,
        height: ROW_HEIGHT,
        background: selected ? "hsl(var(--accent))" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 hsl(var(--primary))" : "none",
      }}
    >
      <Side row={row} side="left" entry={row.left} />
      <span role="gridcell" className="grid place-items-center">
        <button
          type="button"
          tabIndex={-1}
          title={title}
          aria-label={title}
          disabled={allowedActions(row.kind).length < 2}
          className="grid place-items-center rounded-[5px]"
          style={{ width: 28, height: 20, color: chip.color, background: chip.bg }}
          onClick={(e) => {
            e.stopPropagation();
            onChip(row);
          }}
        >
          <ChipIcon action={row.action} />
        </button>
      </span>
      <Side row={row} side="right" entry={row.right} />
    </div>
  );
});

interface Props {
  groups: FolderGroup[];
  selected: ReadonlySet<string>;
  onSelect(path: string, mods: { ctrl: boolean; shift: boolean }): void;
  /** The action chip of a row was clicked: it moves to the next action. */
  onChip(row: FileRow): void;
  /** A row was right-clicked: `el` is its action chip, the menu's anchor. */
  onMenu(row: FileRow, el: HTMLElement): void;
  onCommand(cmd: TableCommand): void;
}

export function FolderTable({ groups, selected, onSelect, onChip, onMenu, onCommand }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const items: Item[] = groups.flatMap((group): Item[] => [
    ...(group.dir ? [{ type: "folder" as const, group }] : []),
    ...group.rows.map((row) => ({ type: "row" as const, row })),
  ]);
  const windowed = items.length > WINDOW_AFTER;
  const viewport = body.current?.clientHeight || 400;
  // ponytail: fixed-height windowing; swap for a lib if rows get variable height
  const start = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const end = windowed ? Math.min(items.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN) : items.length;

  // Keep a lone selected row in view when the keyboard moves it.
  const only = selected.size === 1 ? [...selected][0] : null;
  useEffect(() => {
    const el = body.current;
    if (!el || !only || el.clientHeight === 0) return;
    const index = items.findIndex((i) => i.type === "row" && i.row.path === only);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    // `items` is rebuilt every render; only the selection should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    let cmd: TableCommand | null = null;
    if (e.key === " ") cmd = { type: "cycle" };
    else if (e.key === "Delete") cmd = { type: "set", action: "ignore" };
    else if (mod && e.shiftKey && e.key === "ArrowRight") cmd = { type: "set", action: "toRight" };
    else if (mod && e.shiftKey && e.key === "ArrowLeft") cmd = { type: "set", action: "toLeft" };
    else if (e.key === "Enter") cmd = mod ? { type: "merge" } : { type: "hand" };
    else if (e.key === "ArrowDown") cmd = { type: "move", delta: 1 };
    else if (e.key === "ArrowUp") cmd = { type: "move", delta: -1 };
    if (!cmd) return;
    e.preventDefault();
    onCommand(cmd);
  };

  // The handlers the rows get never change, so a memoised row only re-renders for its own row or selection.
  const latest = useRef({ onSelect, onChip, onMenu });
  useEffect(() => {
    latest.current = { onSelect, onChip, onMenu };
  });
  const rowClick = useCallback((row: FileRow, e: MouseEvent) => {
    latest.current.onSelect(row.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    box.current?.focus();
  }, []);
  const chipClick = useCallback((row: FileRow) => latest.current.onChip(row), []);
  const menuOpen = useCallback((row: FileRow, el: HTMLElement) => latest.current.onMenu(row, el), []);

  const border = "1px solid hsl(var(--border) / .6)";
  const rendered = items.slice(start, end).map((item) => {
    if (item.type === "folder") {
      return (
        <div
          key={`d:${item.group.dir}`}
          role="row"
          className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
          style={{ height: ROW_HEIGHT, paddingLeft: 16, background: "hsl(var(--muted) / .45)" }}
        >
          <Folder size={14} aria-hidden="true" />
          <span role="gridcell" className="font-mono text-foreground">{item.group.dir}</span>
          <span role="gridcell">{item.group.summary}</span>
        </div>
      );
    }
    return (
      <FolderRow
        key={item.row.path}
        row={item.row}
        selected={selected.has(item.row.path)}
        onRowClick={rowClick}
        onChip={chipClick}
        onMenu={menuOpen}
      />
    );
  });

  return (
    <div
      ref={box}
      role="grid"
      aria-label="Folder comparison"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      <div
        role="row"
        className="grid flex-shrink-0 items-center text-xs font-medium text-muted-foreground"
        style={{ gridTemplateColumns: COLUMNS, height: HEADER_HEIGHT, borderBottom: "1px solid hsl(var(--border) / .7)" }}
      >
        <span role="columnheader" style={{ paddingLeft: 16 }}>Name</span>
        <span role="columnheader" className="text-right" style={{ paddingRight: 12, borderLeft: border }}>Size</span>
        <span role="columnheader" style={{ paddingLeft: 12, borderLeft: border }}>Modified</span>
        <span role="columnheader" className="text-center" style={{ borderLeft: border, borderRight: border }}>Action</span>
        <span role="columnheader" style={{ paddingLeft: 12 }}>Modified</span>
        <span role="columnheader" className="text-right" style={{ paddingRight: 12, borderLeft: border }}>Size</span>
        <span role="columnheader" style={{ paddingLeft: 16, borderLeft: border }}>Name</span>
      </div>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto text-[13px]" onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}>
        {windowed ? (
          <div style={{ height: items.length * ROW_HEIGHT, position: "relative" }}>
            <div style={{ position: "absolute", top: start * ROW_HEIGHT, left: 0, right: 0 }}>{rendered}</div>
          </div>
        ) : (
          rendered
        )}
      </div>
    </div>
  );
}
