import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { redo, undo } from "@codemirror/commands";
import type { Direction } from "@/utils/diff-merge/apply";
import { blockStats, joinEol } from "@/utils/diff-merge/blocks";
import { languageLabel } from "@/utils/diff-merge/language";
import { buildPatch } from "@/utils/diff-merge/patch";
import { DEFAULT_SETTINGS, SETTINGS_EVENT, loadSettings, saveSettings, type DiffSettings } from "@/utils/diff-merge/settings";
import { toast } from "sonner";
import { saveFile } from "@/lib/desktop";
import { CopyButton } from "../CopyButton";
import type { Mode } from "./ModeSwitch";
import { DiffPanes, type DiffPanesHandle, type PaneDoc, type PaneMeta } from "./DiffPanes";
import { StatusBar } from "./StatusBar";
import { TextToolbar } from "./TextToolbar";
import { UnifiedPane } from "./UnifiedPane";
import type { DiffEditors } from "./useDiffEditors";

/** Below this container width the viewer is forced to unified. */
const NARROW_PX = 900;

const blankMeta = (d?: PaneDoc): PaneMeta => ({ name: d?.name ?? "", eol: d?.eol ?? "LF", language: d?.language ?? null });

function UnifiedHeader({ nameA, nameB, language, patch, result, patchName }: {
  nameA: string;
  nameB: string;
  language: string;
  patch: string;
  result: string;
  patchName: string;
}) {
  const savePatch = async () => {
    try {
      await saveFile(new Blob([patch]), patchName);
    } catch {
      toast.error("Could not save the file.");
    }
  };
  return (
    <div
      className="col-span-2 flex min-w-0 items-center justify-between gap-3 py-0 pl-[10px] pr-3 text-xs font-medium"
      style={{ background: "hsl(var(--muted) / .35)", borderBottom: "1px solid hsl(var(--border) / .5)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate whitespace-nowrap px-1.5 py-0.5">{`${nameA} → ${nameB}`}</span>
        <span className="inline-flex h-5 items-center rounded-full border border-border pl-[9px] pr-1.5 text-[11px] font-semibold">{language}</span>
      </div>
      <div className="flex items-center gap-0.5 font-normal">
        <CopyButton value={patch} label="Copy patch" />
        <button type="button" className="toolbar-text-button" disabled={!patch} onClick={() => void savePatch()}>Save patch</button>
        <CopyButton value={result} label="Copy result" />
      </div>
    </div>
  );
}

export interface TextDiffHandle {
  getDocs(): [PaneDoc, PaneDoc];
  /** Puts the cursor in the left editor. */
  focusOriginal(): void;
}

interface Props {
  /** Folder mode passes the pair for "Open in Text view". A new pair replaces both texts (Ctrl+Z restores them). */
  initial?: [PaneDoc, PaneDoc];
  onModeChange?: (mode: Mode) => void;
  /** The file view inside Folder mode: same toolbar and settings, sized by its parent instead of the workspace. */
  embedded?: boolean;
  /** Put the cursor in the left editor once the editors exist (Merge by hand). */
  focusOnLoad?: boolean;
}

export const TextDiffView = memo(forwardRef<TextDiffHandle, Props>(function TextDiffView({ initial, onModeChange, embedded = false, focusOnLoad = false }, handle) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panes = useRef<DiffPanesHandle>(null);
  const [settings, setSettings] = useState<DiffSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  const [current, setCurrent] = useState(0);
  const [editors, setEditors] = useState<DiffEditors | null>(null);
  const [meta, setMeta] = useState<Record<"a" | "b", PaneMeta>>(() => ({ a: blankMeta(initial?.[0]), b: blankMeta(initial?.[1]) }));
  const [message, setMessage] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  /** The apply that set the message causes one recompute; that one must not clear it. */
  const applying = useRef(false);
  const [unifiedExpanded, setUnifiedExpanded] = useState<ReadonlySet<number>>(() => new Set());
  /** Side the last unified apply changed: the hidden editors cannot take Ctrl+Z, so it is routed there. Null when there is nothing to undo from here. */
  const lastDest = useRef<"a" | "b" | null>(null);
  const clearExpanded = (prev: ReadonlySet<number>) => (prev.size ? new Set<number>() : prev);

  const update = useCallback((patch: Partial<DiffSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);
  const reset = useCallback(() => update(DEFAULT_SETTINGS), [update]);
  // The other mounted view (Text or the Folder file view) may have changed them.
  useEffect(() => {
    const reload = () => {
      const next = loadSettings();
      if (JSON.stringify(next) === JSON.stringify(settingsRef.current)) return;
      settingsRef.current = next;
      setSettings(next);
    };
    window.addEventListener(SETTINGS_EVENT, reload);
    return () => window.removeEventListener(SETTINGS_EVENT, reload);
  }, []);
  const effective: DiffSettings = narrow ? { ...settings, viewer: "unified" } : settings;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // No layout (width 0) means unknown, not narrow.
      setNarrow(width > 0 && width < NARROW_PX);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const unified = effective.viewer === "unified";
  useEffect(() => {
    if (!settings.collapse) setUnifiedExpanded(clearExpanded);
  }, [settings.collapse]);
  // Leaving or entering the unified view, the undo route no longer points at anything this view did.
  useEffect(() => {
    lastDest.current = null;
  }, [unified]);

  // The editors take `initial` only when they are created. A pair that arrives later (Open in Text view) is loaded here.
  const loadedInitial = useRef(initial);
  useEffect(() => {
    if (!initial || initial === loadedInitial.current) return;
    loadedInitial.current = initial;
    setUnifiedExpanded(clearExpanded);
    lastDest.current = null;
    setCurrent(0);
    setMessage(null);
    panes.current?.setDocs(initial[0], initial[1]);
  }, [initial]);

  useImperativeHandle(
    handle,
    () => ({
      getDocs: () => panes.current!.getDocs(),
      focusOriginal: () => panes.current?.editors.a?.focus(),
    }),
    [],
  );
  const focusedOnLoad = useRef(false);
  useEffect(() => {
    if (focusOnLoad && editors?.a && !focusedOnLoad.current) {
      focusedOnLoad.current = true;
      editors.a.focus();
    }
  }, [focusOnLoad, editors?.a]);

  const blocks = editors?.blocks;
  useEffect(() => {
    if (!blocks) return;
    if (applying.current) {
      applying.current = false;
      return;
    }
    setMessage(null);
  }, [blocks]);

  const count = blocks?.length ?? 0;
  const empty = !editors?.a || !editors.b || (editors.a.state.doc.length === 0 && editors.b.state.doc.length === 0);

  const go = (index: number) => panes.current?.goTo(index);
  const step = (delta: number) => {
    if (count > 0) go((current + delta + count) % count);
  };
  const applyCurrent = (dir: Direction) => panes.current?.apply(current, dir, "replace");
  const swap = () => {
    if (!panes.current) return;
    setUnifiedExpanded(clearExpanded);
    lastDest.current = null;
    const [a, b] = panes.current.getDocs();
    panes.current.setDocs(b, a);
  };
  const onApplied = useCallback((index: number) => {
    applying.current = true;
    setMessage(`Applied change ${index + 1} — Ctrl+Z to undo`);
  }, []);

  const applyFromUnified = useCallback((index: number, dir: Direction) => {
    lastDest.current = dir === "toRight" ? "b" : "a";
    // Fold keys are line numbers, which an apply shifts.
    setUnifiedExpanded(clearExpanded);
    panes.current?.apply(index, dir, "replace");
  }, []);
  const expandUnified = useCallback((at: number) => setUnifiedExpanded((prev) => new Set(prev).add(at)), []);

  // Texts the blocks were computed from, for the unified viewer and its header buttons.
  const texts = useMemo(
    () => (unified && editors?.a && editors.b ? { a: editors.a.state.doc.toString(), b: editors.b.state.doc.toString() } : { a: "", b: "" }),
    // `blocks` changes identity after every edit, which is when the text may have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unified, editors?.a, editors?.b, blocks],
  );
  const nameA = meta.a.name || "Original";
  const nameB = meta.b.name || "Modified";
  const result = useMemo(() => joinEol(texts.b, meta.b.eol), [texts.b, meta.b.eol]);
  const patch = useMemo(() => (unified ? buildPatch(texts.a, texts.b, nameA, nameB) : ""), [unified, texts, nameA, nameB]);

  // Capture phase: CodeMirror binds Mod-Shift-Arrow itself, so only our action may see these keys.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === "F7") step(e.shiftKey ? -1 : 1);
    else if (mod && e.shiftKey && e.key === "ArrowRight") applyCurrent("toRight");
    else if (mod && e.shiftKey && e.key === "ArrowLeft") applyCurrent("toLeft");
    else if (mod && e.shiftKey && key === "s") swap();
    else if (mod && e.shiftKey && key === "c") update({ collapse: !settings.collapse });
    else if (mod && !e.shiftKey && key === "o") panes.current?.openFile(editors?.focused ?? "b");
    else if (unified && mod && !e.altKey && (key === "z" || key === "y") && lastDest.current && editors?.[lastDest.current]) {
      const target = editors[lastDest.current]!;
      if (key === "y" || e.shiftKey) redo(target);
      else undo(target);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const focused = editors?.focused ?? "b";
  return (
    <div ref={rootRef} data-testid={embedded ? "diff-merge-file" : "diff-merge"} tabIndex={-1} className={`${embedded ? "flex min-h-0 flex-1 flex-col bg-[var(--surface-editor)]" : "json-workspace"} dm-root relative outline-none`} onKeyDownCapture={onKeyDown}>
      <TextToolbar
        settings={effective}
        onChange={update}
        onReset={reset}
        count={count}
        current={current}
        empty={empty}
        narrow={narrow}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onSwap={swap}
        onModeChange={onModeChange}
      />
      {editors && !editors.precise && (
        <div role="status" className="flex-shrink-0 border-b border-border bg-muted px-5 py-1.5 text-xs text-muted-foreground">
          Diff is approximate for very large input
        </div>
      )}
      {/* The side-by-side editors stay mounted while hidden, so their undo history survives a view switch. */}
      <div className={unified ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <DiffPanes
          ref={panes}
          settings={effective}
          current={current}
          onCurrentChange={setCurrent}
          onApplied={onApplied}
          onStateChange={setEditors}
          onMetaChange={setMeta}
          initial={initial}
        />
      </div>
      {unified && (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "minmax(0,1fr) 14px", gridTemplateRows: "38px minmax(0,1fr)" }}>
          <UnifiedHeader
            nameA={nameA}
            nameB={nameB}
            language={languageLabel(meta.b.language ?? meta.a.language)}
            patch={patch}
            result={result}
            patchName={`${meta.a.name || "original"}.patch`}
          />
          <UnifiedPane
            a={texts.a}
            b={texts.b}
            blocks={blocks ?? []}
            settings={effective}
            current={current}
            expanded={unifiedExpanded}
            onApply={applyFromUnified}
            onExpand={expandUnified}
            onCurrentChange={go}
          />
        </div>
      )}
      <StatusBar
        empty={empty}
        cursor={editors?.cursor ?? null}
        language={languageLabel(meta[focused].language)}
        stats={blockStats(blocks ?? [])}
        message={message}
        eol={meta[focused].eol}
      />
    </div>
  );
}));
