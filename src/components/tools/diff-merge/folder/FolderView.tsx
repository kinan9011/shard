import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Check, FileX, Folder, FolderSearch, ShieldCheck } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  applyFolderMerge,
  compareContents,
  isDesktop,
  pickFolder,
  readTextFile,
  revealPath,
  scanFolder,
  undoFolderMerge,
  writeTextFile,
  type FolderMergeReport,
} from "@/lib/desktop";
import { joinEol, splitEol } from "@/utils/diff-merge/blocks";
import {
  allowedActions,
  classify,
  cycleAction,
  defaultAction,
  doneNotice,
  filterRows,
  groupRows,
  makeRow,
  mergeOps,
  needsContentCheck,
  pairEntries,
  planCounts,
  plannedText,
  type CompareBy,
  type FileRow,
  type RowKind,
} from "@/utils/diff-merge/folder";
import { PaneEmpty } from "../../ToolWorkspace";
import type { PaneDoc } from "../DiffPanes";
import { ModeSwitch, type Mode } from "../ModeSwitch";
import { TextDiffView, type TextDiffHandle } from "../TextDiffView";
import { ActionMenu, type MenuChoice } from "./ActionMenu";
import { MergeDialog } from "./MergeDialog";
import { FolderTable, type TableCommand } from "./FolderTable";
import { FolderToolbar } from "./FolderToolbar";

const BATCH = 500;
const DEFAULT_SHOW: ReadonlySet<RowKind> = new Set<RowKind>(["left", "right", "diff"]);
const HINT = "Click an action or press Space to switch it, right-click for more. Select several rows to change them together. Ctrl+Enter starts the merge.";

type Lower =
  | { path: string; status: "loading" }
  | { path: string; status: "binary" }
  | { path: string; status: "ready"; docs: [PaneDoc, PaneDoc]; focus: boolean };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toDoc = (name: string, raw: string): PaneDoc => ({ name, ...splitEol(raw), language: null });

function PathBar({ label, path, onBrowse }: { label: string; path: string | null; onBrowse(): void }) {
  return (
    <div className="flex h-[30px] min-w-0 items-center gap-2 rounded-md border border-input bg-card pl-2.5 pr-1">
      <Folder size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path ?? undefined}>{path}</span>
      <button type="button" aria-label={`Browse for the ${label} folder`} className="toolbar-text-button" onClick={onBrowse}>Browse</button>
    </div>
  );
}

interface Props {
  onOpenInText(docs: [PaneDoc, PaneDoc]): void;
  onModeChange?(mode: Mode): void;
}

export function FolderView({ onOpenInText, onModeChange }: Props) {
  const desktop = isDesktop();
  const roots = useRef<{ left: string | null; right: string | null }>({ left: null, right: null });
  const [shown, setShown] = useState<{ left: string | null; right: string | null }>(roots.current);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [show, setShow] = useState<ReadonlySet<RowKind>>(DEFAULT_SHOW);
  const [compareBy, setCompareBy] = useState<CompareBy>("content");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [menu, setMenu] = useState<{ row: FileRow; el: HTMLElement } | null>(null);
  const [lower, setLower] = useState<Lower | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<FolderMergeReport | null>(null);
  const run = useRef(0);
  const lowerRun = useRef(0);
  const text = useRef<TextDiffHandle>(null);

  const compare = useCallback(async (left: string, right: string, by: CompareBy) => {
    const id = ++run.current;
    setProgress({ done: 0, total: 0 });
    try {
      const [l, r] = await Promise.all([scanFolder(left), scanFolder(right)]);
      if (id !== run.current) return;
      const pairs = pairEntries(l, r);
      const check = pairs.filter((p) => needsContentCheck(p, by)).map((p) => p.path);
      const equal = new Map<string, boolean>();
      setProgress({ done: 0, total: check.length });
      for (let i = 0; i < check.length; i += BATCH) {
        const batch = check.slice(i, i + BATCH);
        const same = await compareContents(left, right, batch);
        if (id !== run.current) return;
        batch.forEach((path, j) => equal.set(path, same[j]));
        setProgress({ done: i + batch.length, total: check.length });
      }
      setRows((prev) => {
        const old = new Map(prev.map((row) => [row.path, row]));
        return pairs.map((p) => {
          const kind = classify(p, by, equal.get(p.path));
          const before = old.get(p.path);
          return makeRow(p, kind, before && before.kind === kind ? before.action : defaultAction(kind));
        });
      });
    } catch (e) {
      if (id === run.current) toast.error(messageOf(e));
    } finally {
      if (id === run.current) setProgress(null);
    }
  }, []);

  const browse = async (side: "left" | "right") => {
    let path: string | null;
    try {
      path = await pickFolder();
    } catch (e) {
      toast.error(messageOf(e));
      return;
    }
    if (!path) return;
    roots.current = { ...roots.current, [side]: path };
    setShown(roots.current);
    setNotice(null);
    setRows([]);
    setSelected(new Set());
    setLower(null);
    const { left, right } = roots.current;
    if (left && right) void compare(left, right, compareBy);
  };

  const swapRoots = () => {
    const { left, right } = roots.current;
    roots.current = { left: right, right: left };
    setShown(roots.current);
    setNotice(null);
    setRows([]);
    setSelected(new Set());
    setLower(null);
    if (left && right) void compare(right, left, compareBy);
  };

  const rescan = useCallback(() => {
    const { left, right } = roots.current;
    if (left && right) void compare(left, right, compareBy);
  }, [compare, compareBy]);

  const changeCompareBy = (by: CompareBy) => {
    setCompareBy(by);
    const { left, right } = roots.current;
    if (left && right) void compare(left, right, by);
  };

  const loadLower = useCallback(async (row: FileRow, focus = false) => {
    const { left, right } = roots.current;
    if (!left || !right) return;
    const id = ++lowerRun.current;
    setLower({ path: row.path, status: "loading" });
    try {
      const [a, b] = await Promise.all([readTextFile(left, row.path), readTextFile(right, row.path)]);
      if (id === lowerRun.current) setLower({ path: row.path, status: "ready", docs: [toDoc(row.name, a), toDoc(row.name, b)], focus });
    } catch {
      if (id === lowerRun.current) setLower({ path: row.path, status: "binary" });
    }
  }, []);

  const visible = useMemo(() => filterRows(rows, show, query), [rows, show, query]);
  const groups = useMemo(() => groupRows(visible), [visible]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const shownPaths = useMemo(() => new Set(order.map((r) => r.path)), [order]);
  const counts = useMemo(() => {
    const c: Record<RowKind, number> = { left: 0, right: 0, diff: 0, same: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);
  // Identical rows have nothing to merge, so they never count towards the plan.
  const planRows = useMemo(() => visible.filter((r) => r.kind !== "same"), [visible]);
  const plan = useMemo(() => planCounts(planRows), [planRows]);

  const select = useCallback(
    (path: string, mods: { ctrl: boolean; shift: boolean }) => {
      let next: Set<string>;
      if (mods.shift && anchor.current) {
        const a = order.findIndex((r) => r.path === anchor.current);
        const b = order.findIndex((r) => r.path === path);
        next = a < 0 || b < 0 ? new Set([path]) : new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.path));
      } else if (mods.ctrl) {
        next = new Set(selected);
        if (!next.delete(path)) next.add(path);
        anchor.current = path;
      } else {
        next = new Set([path]);
        anchor.current = path;
      }
      setSelected(next);
      setMenu(null);
      const row = order.find((r) => r.path === path);
      if (!mods.ctrl && !mods.shift && row?.left && row.right) void loadLower(row);
      else if (!mods.ctrl && !mods.shift) {
        lowerRun.current++;
        setLower(null);
      }
    },
    [order, selected, loadLower],
  );

  // Only rows on screen change: a selection can outlive a filter or a rescan.
  const apply = (paths: ReadonlySet<string>, pick: (row: FileRow) => FileRow["action"]) =>
    setRows((prev) =>
      prev.map((row) => {
        if (!paths.has(row.path) || !shownPaths.has(row.path)) return row;
        const action = pick(row);
        return allowedActions(row.kind).includes(action) ? { ...row, action } : row;
      }),
    );

  const command = (cmd: TableCommand) => {
    if (cmd.type === "cycle") apply(selected, cycleAction);
    else if (cmd.type === "set") apply(selected, () => cmd.action);
    else if (cmd.type === "move") {
      if (order.length === 0) return;
      const at = order.findIndex((r) => r.path === anchor.current);
      const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + cmd.delta))];
      select(next.path, { ctrl: false, shift: false });
    } else if (cmd.type === "hand") {
      const row = order.find((r) => r.path === anchor.current);
      if (row) mergeByHand(row);
    } else startMerge();
  };

  /** Shows the row in the lower split if it is not there yet, then puts the cursor in its left editor. */
  const mergeByHand = (row: FileRow) => {
    if (!row.left || !row.right) return;
    if (lower?.status === "ready" && lower.path === row.path) text.current?.focusOriginal();
    else void loadLower(row, true);
  };

  const openMenu = (row: FileRow, el: HTMLElement) => {
    if (menu?.row.path === row.path) {
      setMenu(null);
      return;
    }
    if (!selected.has(row.path)) {
      setSelected(new Set([row.path]));
      anchor.current = row.path;
    }
    setMenu({ row, el });
  };

  /** A click on an action chip: select the row (without opening it below) and move it to its next action. */
  const chipClick = (row: FileRow) => {
    setMenu(null);
    let target = selected;
    if (!selected.has(row.path)) {
      target = new Set([row.path]);
      setSelected(target);
      anchor.current = row.path;
    }
    apply(target, cycleAction);
  };

  const pick = (choice: MenuChoice) => {
    const target = menu && selected.has(menu.row.path) ? selected : new Set(menu ? [menu.row.path] : []);
    setMenu(null);
    if (choice === "hand") {
      if (menu) mergeByHand(menu.row);
    } else apply(target, () => choice);
  };

  const busy = progress !== null || merging;
  const startMerge = () => {
    if (!busy && plan.toRight + plan.toLeft > 0) setDialogOpen(true);
  };

  const confirmMerge = async (backup: boolean) => {
    const { left, right } = roots.current;
    setDialogOpen(false);
    if (!left || !right) return;
    setMerging(true);
    try {
      const report = await applyFolderMerge(left, right, mergeOps(planRows), backup);
      setNotice(report);
      lowerRun.current++;
      setLower(null);
      rescan();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setMerging(false);
    }
  };

  const undoMerge = async () => {
    if (!notice || busy) return;
    setMerging(true);
    try {
      const report = await undoFolderMerge(notice.journal);
      lowerRun.current++;
      setLower(null);
      rescan();
      // Files that could not be restored keep the journal, so the notice stays for another try.
      if (report.unrestorable.length) {
        toast.error(`${report.unrestorable.length} ${report.unrestorable.length === 1 ? "file" : "files"} could not be restored because ${report.unrestorable.length === 1 ? "it was" : "they were"} not backed up.`);
      } else {
        setNotice(null);
        toast.info("Merge undone.");
      }
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setMerging(false);
    }
  };

  const showBackup = async () => {
    if (!notice?.backupDir) return;
    try {
      await revealPath(notice.backupDir);
    } catch (e) {
      toast.error(messageOf(e));
    }
  };


  const saveBoth = async () => {
    const { left, right } = roots.current;
    if (!left || !right || lower?.status !== "ready" || !text.current) return;
    const [a, b] = text.current.getDocs();
    try {
      await writeTextFile(left, lower.path, joinEol(a.text, a.eol));
      await writeTextFile(right, lower.path, joinEol(b.text, b.eol));
    } catch (e) {
      // The first side may already be written.
      toast.error(messageOf(e));
    }
    rescan();
  };

  const toggleKind = (kind: RowKind) =>
    setShow((prev) => {
      const next = new Set(prev);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  if (!desktop) {
    return (
      <div data-testid="diff-merge-folders" className="json-workspace dm-root relative">
        <FolderToolbarShell onModeChange={onModeChange} />
        <PaneEmpty
          icon={<FolderSearch size={22} aria-hidden="true" />}
          title="Folder compare needs the desktop app"
          hint="Download Shard for macOS, Windows or Linux to compare folders."
        />
      </div>
    );
  }

  const ready = !!(shown.left && shown.right);
  const startCount = plan.toRight + plan.toLeft;
  const total = counts.left + counts.right + counts.diff;
  const withLower = lower !== null;

  return (
    <div data-testid="diff-merge-folders" className="json-workspace dm-root relative outline-none">
      <FolderToolbar
        onModeChange={(m) => onModeChange?.(m)}
        counts={counts}
        show={show}
        onToggle={toggleKind}
        compareBy={compareBy}
        onCompareBy={changeCompareBy}
        query={query}
        onQuery={setQuery}
        canRefresh={ready}
        onRefresh={rescan}
        startCount={startCount}
        busy={busy}
        onStart={startMerge}
      />
      {notice && (
        <div
          role="status"
          className="flex flex-shrink-0 items-center gap-[10px] border-b px-5 py-[9px] text-xs"
          style={{ background: "hsl(var(--success) / .1)", borderColor: "hsl(var(--success) / .25)" }}
        >
          <Check size={14} strokeWidth={2.4} className="text-success" aria-hidden="true" />
          <span className="flex-1">{doneNotice(notice)}</span>
          <button type="button" disabled={busy} className="rounded-[5px] px-1.5 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-60" onClick={() => void undoMerge()}>Undo merge</button>
          {notice.backupDir && (
            <button type="button" className="rounded-[5px] px-1.5 py-1 text-muted-foreground hover:bg-muted" onClick={() => void showBackup()}>Show backup</button>
          )}
        </div>
      )}
      <div
        className="grid flex-shrink-0 border-b px-3 py-2"
        style={{ gridTemplateColumns: "minmax(0,1fr) 44px minmax(0,1fr)", background: "hsl(var(--muted) / .35)", borderColor: "hsl(var(--border) / .5)" }}
      >
        <PathBar label="left" path={shown.left} onBrowse={() => void browse("left")} />
        <button type="button" aria-label="Swap folders" title="Swap folders" disabled={!ready} className="grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-60" onClick={swapRoots}>
          <ArrowRightLeft size={14} aria-hidden="true" />
        </button>
        <PathBar label="right" path={shown.right} onBrowse={() => void browse("right")} />
      </div>
      {!ready ? (
        <PaneEmpty icon={<FolderSearch size={22} aria-hidden="true" />} title="Choose two folders to compare" hint="Pick the left and right folder with Browse." />
      ) : (
        <div className="min-h-0 flex-1">
          <PanelGroup direction="vertical" autoSaveId="diff-merge-folder-split">
            <Panel minSize={15} defaultSize={withLower ? 45 : 100} order={1} id="folder-files">
              <div className="flex h-full min-h-0 flex-col">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <FolderTable groups={groups} selected={selected} onSelect={select} onChip={chipClick} onMenu={openMenu} onCommand={command} />
                  <ActionMenu row={menu?.row ?? null} anchor={menu?.el ?? null} onPick={pick} onClose={() => setMenu(null)} />
                </div>
                <div
                  className="flex h-[26px] flex-shrink-0 items-center justify-center gap-1.5 border-t border-border text-[11px] text-muted-foreground"
                  style={{ borderBottom: "1px solid hsl(var(--border) / .6)", background: "hsl(var(--muted) / .3)" }}
                >
                  {HINT}
                </div>
              </div>
            </Panel>
            {withLower && (
              <>
                <PanelResizeHandle className="editor-resize" aria-label="Resize file list and file compare" />
                <Panel minSize={20} defaultSize={55} order={2} id="folder-compare">
                  {lower?.status === "ready" ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div
                        className="flex h-9 flex-shrink-0 items-center gap-3 whitespace-nowrap pl-[14px] pr-3 text-xs"
                        style={{ background: "hsl(var(--muted) / .35)", borderBottom: "1px solid hsl(var(--border) / .5)" }}
                      >
                        <span className="font-medium">{lower.docs[0].name}</span>
                        <button type="button" className="toolbar-text-button ml-auto" onClick={() => text.current && onOpenInText(text.current.getDocs())}>Open in Text view</button>
                        <button type="button" className="toolbar-text-button" onClick={() => void saveBoth()}>Save both</button>
                      </div>
                      <TextDiffView key={lower.path} ref={text} embedded focusOnLoad={lower.focus} initial={lower.docs} />
                    </div>
                  ) : lower?.status === "binary" ? (
                    <PaneEmpty icon={<FileX size={22} aria-hidden="true" />} title="Binary or non-text file" hint="Only text files can be merged line by line." />
                  ) : null}
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      )}
      <MergeDialog rows={planRows} open={dialogOpen} onCancel={() => setDialogOpen(false)} onConfirm={(backup) => void confirmMerge(backup)} />
      <footer className="flex h-8 flex-shrink-0 items-center gap-4 whitespace-nowrap border-t border-border px-4 text-[11px] tabular-nums text-muted-foreground">
        {progress ? (
          <span>{`Comparing… ${progress.done}/${progress.total}`}</span>
        ) : (
          <>
            <span>{`${total} ${total === 1 ? "difference" : "differences"}`}</span>
            <span className="flex gap-1">
              <span className="text-destructive">{`${counts.left} left only`}</span>·<span className="text-success">{`${counts.right} right only`}</span>·<span className="text-warning">{`${counts.diff} different`}</span>
              {!show.has("same") && <>·<span>{`${counts.same} identical hidden`}</span></>}
            </span>
            <span className="text-foreground">{plannedText(plan)}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <ShieldCheck size={13} aria-hidden="true" />
          Local processing
        </span>
      </footer>
    </div>
  );
}


/** Browser fallback: only the mode switch, so the user can go back to Text. */
function FolderToolbarShell({ onModeChange }: { onModeChange?(mode: Mode): void }) {
  return (
    <div className="flex flex-shrink-0 items-center border-b border-border px-5 py-3">
      <ModeSwitch mode="folders" onChange={(m) => onModeChange?.(m)} />
    </div>
  );
}
