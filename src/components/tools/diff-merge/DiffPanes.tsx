import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { toast } from "sonner";
import { useT, type TKey } from "@/i18n";
import { getDesktopBridge, readClipboardText, readTextFile, saveFile } from "@/lib/desktop";
import { blockReplacement, type Direction } from "@/utils/diff-merge/apply";
import { joinEol, splitEol, type Eol } from "@/utils/diff-merge/blocks";
import { GUTTER_WIDTH, collapsedRuns, mapPixel } from "@/utils/diff-merge/geometry";
import { detectLanguageName, isProbablyBinary, languageForFile } from "@/utils/diff-merge/language";
import type { DiffSettings } from "@/utils/diff-merge/settings";
import { ChangeMap } from "./ChangeMap";
import { Gutter } from "./Gutter";
import { PaneHeader } from "./PaneHeader";
import { EXPAND_EVENT, languageConf } from "./editor";
import { useDiffEditors, type DiffEditors } from "./useDiffEditors";
import "./diff-merge.css";

/** `language` is a `LanguageDescription` name from `@codemirror/language-data`. */
export interface PaneDoc { name: string; text: string; eol: Eol; language: string | null }

export interface DiffPanesHandle {
  editors: DiffEditors;
  apply(index: number, dir: Direction, mode: "replace" | "append"): void;
  goTo(index: number): void;
  setDocs(a: PaneDoc, b: PaneDoc): void;
  getDocs(): [PaneDoc, PaneDoc];
  /** Opens the file picker of one side (Ctrl+O). */
  openFile(side: "a" | "b"): void;
}

interface Props {
  settings: DiffSettings;
  current: number;
  onCurrentChange(i: number): void;
  onApplied(index: number): void;
  onStateChange(e: DiffEditors): void;
  /** Name, EOL and language of both sides, whenever one changes. */
  onMetaChange?(m: Record<"a" | "b", PaneMeta>): void;
  headerHeight?: 38 | 36;
  showHeaders?: boolean;
  initial?: [PaneDoc, PaneDoc];
}

export interface PaneMeta { name: string; eol: Eol; language: string | null }
type Meta = PaneMeta;
type Side = "a" | "b";
const SIDES: readonly Side[] = ["a", "b"];
const LABEL: Record<Side, TKey> = { a: "diffMerge.original", b: "diffMerge.modified" };
/** File names offered by Save when a side has no name. They are file names, not interface text. */
const DEFAULT_FILE = { a: "original.txt", b: "modified.txt" } as const;
/** How much of a document is looked at to guess its language (a whole 1 MB JSON still parses; a bigger paste is cut). */
const SNIFF_CHARS = 1_000_000;
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;
/** Width of the change map column on the right edge. */
const MAP_WIDTH = 14;

const fileLanguage = (name: string) => languageForFile(name)?.name ?? null;

async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Text of a file, or null when it is binary or not valid UTF-8. */
function decodeText(bytes: Uint8Array): string | null {
  if (isProbablyBinary(bytes)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Lines of a document, not counting the empty line after a trailing newline. */
const lineCount = (doc: Text) => (doc.length === 0 ? 0 : doc.lines - (doc.line(doc.lines).length === 0 ? 1 : 0));

function replaceDoc(view: EditorView, text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
}

export const DiffPanes = forwardRef<DiffPanesHandle, Props>(function DiffPanes(props, ref) {
  const t = useT();
  const { settings, current, onCurrentChange, onApplied, onStateChange, onMetaChange, headerHeight = 38, showHeaders = true, initial } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const hostA = useRef<HTMLDivElement>(null);
  const hostB = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [dragging, setDragging] = useState<Side | null>(null);
  const [split, setSplit] = useState(0.5);
  const resizing = useRef(false);
  const [meta, setMeta] = useState<Record<Side, Meta>>(() => ({
    a: { name: initial?.[0].name ?? "", eol: initial?.[0].eol ?? "LF", language: initial?.[0].language ?? fileLanguage(initial?.[0].name ?? "") },
    b: { name: initial?.[1].name ?? "", eol: initial?.[1].eol ?? "LF", language: initial?.[1].language ?? fileLanguage(initial?.[1].name ?? "") },
  }));
  /** A language chosen by file name or by the user is never overwritten by content sniffing. */
  const locked = useRef<Record<Side, boolean>>({
    a: !!(initial && (initial[0].language ?? fileLanguage(initial[0].name))),
    b: !!(initial && (initial[1].language ?? fileLanguage(initial[1].name))),
  });
  
  const editors = useDiffEditors(hostA, hostB, {
    settings,
    current,
    expanded,
    initialA: initial?.[0].text,
    initialB: initial?.[1].text,
  });
  const latest = useRef({ editors, settings, meta, onStateChange, onMetaChange });
  useEffect(() => {
    latest.current = { editors, settings, meta, onStateChange, onMetaChange };
  });

  // Through the ref, so an inline callback from the parent does not re-fire this on every render.
  useEffect(() => {
    latest.current.onStateChange(editors);
  }, [editors]);

  useEffect(() => {
    latest.current.onMetaChange?.(meta);
  }, [meta]);

  // Fold bars announce themselves with a bubbling event; the opened runs are tracked here.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onExpand = (e: Event) => {
      const at = (e as CustomEvent<number>).detail;
      setExpanded((prev) => new Set(prev).add(at));
    };
    root.addEventListener(EXPAND_EVENT, onExpand);
    return () => root.removeEventListener(EXPAND_EVENT, onExpand);
  }, []);

  // Turning collapse off forgets which folds were opened.
  useEffect(() => {
    if (!settings.collapse) setExpanded((prev) => (prev.size ? new Set() : prev));
  }, [settings.collapse]);

  // The diff can shrink under the cursor (an apply, an edit): keep `current` on a real change.
  useEffect(() => {
    if (editors.a && editors.blocks.length > 0 && current >= editors.blocks.length) onCurrentChange(editors.blocks.length - 1);
    if (editors.a && editors.blocks.length === 0 && current > 0) onCurrentChange(0);
  }, [editors.a, editors.blocks, current, onCurrentChange]);

  // Language support: load the pack and reconfigure the compartment.
  useEffect(() => {
    const cancels = SIDES.map((side) => {
      const view = editors[side];
      const name = meta[side].language;
      if (!view) return () => undefined;
      const desc = name ? languages.find((l) => l.name === name) : undefined;
      if (!desc) {
        view.dispatch({ effects: languageConf.reconfigure([]) });
        return () => undefined;
      }
      let cancelled = false;
      desc.load().then(
        (support) => {
          if (!cancelled) view.dispatch({ effects: languageConf.reconfigure(support) });
        },
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
    });
    return () => cancels.forEach((cancel) => cancel());
    // `editors` also changes on every edit; only the views and the language names matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editors.a, editors.b, meta.a.language, meta.b.language]);

  // Content sniffing, debounced, for sides whose language was not set by name or by hand.
  useEffect(() => {
    if (!settings.detectLanguage || !editors.a || !editors.b) return;
    const timer = setTimeout(() => {
      setMeta((prev) => {
        let next = prev;
        for (const side of SIDES) {
          if (locked.current[side]) continue;
          const doc = (side === "a" ? editors.a : editors.b)!.state.doc;
          const text = doc.sliceString(0, Math.min(doc.length, SNIFF_CHARS));
          const name = text.trim() ? detectLanguageName(text) : null;
          if (name !== next[side].language) next = { ...next, [side]: { ...next[side], language: name } };
        }
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [editors.a, editors.b, editors.blocks, settings.detectLanguage]);

  // Sync scroll. The pane the user is scrolling drives; the other follows and its own scroll events are ignored,
  // so a height correction or the echo of a write can never pull the driver back. Positions map in pixels, anchored
  // at the point of the viewport that matches how far the driver is scrolled (top at the top, bottom at the bottom).
  const { a: viewA, b: viewB } = editors;
  useEffect(() => {
    const a = viewA;
    const b = viewB;
    if (!a || !b) return;
    let driver: Side | null = null;
    let release: ReturnType<typeof setTimeout> | undefined;
    let frame: number | null = null;
    const claim = (side: Side) => {
      driver = side;
      clearTimeout(release);
      release = setTimeout(() => (driver = null), 200);
    };
    const run = (side: Side) => {
      frame = null;
      const { settings: s, editors: e } = latest.current;
      if (!s.syncScroll) return;
      const src = side === "a" ? a : b;
      const dst = side === "a" ? b : a;
      const range = src.scrollDOM.scrollHeight - src.scrollDOM.clientHeight;
      const t = range > 0 ? Math.min(1, Math.max(0, src.scrollDOM.scrollTop / range)) : 0;
      const y = src.scrollDOM.scrollTop + t * src.scrollDOM.clientHeight - src.documentPadding.top;
      const top = (of: Side, line: number) => {
        const view = of === "a" ? a : b;
        const doc = view.state.doc;
        return line >= doc.lines ? view.lineBlockAt(doc.length).bottom : view.lineBlockAt(doc.line(line + 1).from).top;
      };
      const mapped = mapPixel(e.blocks, side, y, top);
      const scrollTop = mapped + dst.documentPadding.top - t * dst.scrollDOM.clientHeight;
      if (Math.abs(dst.scrollDOM.scrollTop - scrollTop) >= 1) dst.scrollDOM.scrollTop = scrollTop;
    };
    const onScroll = (side: Side) => () => {
      if (driver !== null && driver !== side) return;
      claim(side);
      // One write per frame, however many wheel events arrived.
      if (frame === null) frame = requestAnimationFrame(() => run(side));
    };
    const onInput = (side: Side) => () => claim(side);
    const cleanups = ([["a", a], ["b", b]] as const).map(([side, view]) => {
      const dom = view.scrollDOM;
      const scroll = onScroll(side);
      const input = onInput(side);
      dom.addEventListener("scroll", scroll, { passive: true });
      for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) dom.addEventListener(type, input, { passive: true, capture: true });
      return () => {
        dom.removeEventListener("scroll", scroll);
        for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) dom.removeEventListener(type, input, { capture: true });
      };
    });
    return () => {
      cleanups.forEach((c) => c());
      clearTimeout(release);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [viewA, viewB]);

  const setSide = useCallback((side: Side, patch: { text?: string; meta: Partial<Meta>; lock?: boolean }) => {
    const view = latest.current.editors[side];
    if (!view) return;
    if (patch.text !== undefined) replaceDoc(view, patch.text);
    if (patch.lock !== undefined) locked.current[side] = patch.lock;
    setMeta((prev) => ({ ...prev, [side]: { ...prev[side], ...patch.meta } }));
    setExpanded((prev) => (prev.size ? new Set() : prev));
  }, []);

  const loadText = useCallback(
    (side: Side, text: string, name: string) => {
      const { text: normal, eol } = splitEol(text);
      const language = fileLanguage(name);
      setSide(side, { text: normal, meta: { name, eol, language }, lock: language !== null });
    },
    [setSide],
  );

  const loadFile = useCallback(
    async (side: Side, file: File) => {
      let text: string | null = null;
      try {
        text = decodeText(await readBytes(file));
      } catch {
        toast.error(t("diffMerge.error.readFile"));
        return;
      }
      if (text === null) {
        toast.error(t("diffMerge.error.notUtf8"));
        return;
      }
      loadText(side, text, file.name);
    },
    [loadText, t],
  );

  // Linux takes file drops natively and the page gets no File, so a drop arrives as paths and the point it landed on.
  // The app reads the file (text only, up to 5 MiB) and words its own refusal.
  // ponytail: Linux paths only, because the bridge offers onFileDrop on Linux alone. Only the first file is used, as with a browser drop.
  useEffect(
    () =>
      getDesktopBridge()?.onFileDrop?.((paths, x, y) => {
        const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-side]");
        const side = target?.dataset.dropSide;
        const path = paths[0];
        if (!path || (side !== "a" && side !== "b")) return;
        // Another Diff & Merge on the page, or none: not ours.
        if ((side === "a" ? hostA : hostB).current?.parentElement !== target) return;
        const slash = path.lastIndexOf("/");
        const name = path.slice(slash + 1);
        readTextFile(slash > 0 ? path.slice(0, slash) : "/", name).then(
          (text) => loadText(side, text, name),
          (error) => toast.error(String(error)),
        );
      }),
    [loadText],
  );

  const paste = useCallback(
    async (side: Side) => {
      try {
        const { text, eol } = splitEol(await readClipboardText());
        setSide(side, { text, meta: { eol } });
      } catch {
        toast.error(t("diffMerge.error.clipboard"));
      }
    },
    [setSide, t],
  );

  const save = useCallback(async (side: Side) => {
    const { editors: e, meta: m } = latest.current;
    const view = e[side];
    if (!view) return;
    const name = m[side].name || DEFAULT_FILE[side];
    try {
      await saveFile(new Blob([joinEol(view.state.doc.toString(), m[side].eol)]), name);
    } catch {
      toast.error(t("diffMerge.saveFailed"));
    }
  }, [t]);

  const apply = useCallback(
    (index: number, dir: Direction, mode: "replace" | "append") => {
      const { a, b, blocks } = latest.current.editors;
      const block = blocks[index];
      if (!a || !b || !block) return;
      const ta = a.state.doc.toString();
      const tb = b.state.doc.toString();
      // The blocks are one frame behind an edit. Never apply them to text they were not computed from.
      if (ta.slice(block.fromA, block.toA) !== block.textA || tb.slice(block.fromB, block.toB) !== block.textB) return;
      const dest = dir === "toRight" ? b : a;
      dest.dispatch({ changes: blockReplacement(block, ta, tb, dir, mode), userEvent: "input.merge" });
      dest.focus();
      onApplied(index);
    },
    [onApplied],
  );

  const goTo = useCallback(
    (index: number) => {
      const { a, b, blocks } = latest.current.editors;
      const block = blocks[index];
      if (!a || !b || !block) return;
      const posB = Math.min(block.fromB, b.state.doc.length);
      const posA = Math.min(block.fromA, a.state.doc.length);
      b.dispatch({ selection: { anchor: posB }, effects: EditorView.scrollIntoView(posB, { y: "center" }) });
      a.dispatch({ effects: EditorView.scrollIntoView(posA, { y: "center" }) });
      onCurrentChange(index);
    },
    [onCurrentChange],
  );

  const getDocs = useCallback((): [PaneDoc, PaneDoc] => {
    const { editors: e, meta: m } = latest.current;
    const one = (side: Side): PaneDoc => ({ ...m[side], text: e[side]?.state.doc.toString() ?? "" });
    return [one("a"), one("b")];
  }, []);

  const setDocs = useCallback(
    (a: PaneDoc, b: PaneDoc) => {
      [a, b].forEach((d, i) => {
        const language = d.language ?? fileLanguage(d.name);
        setSide(SIDES[i], { text: d.text, meta: { name: d.name, eol: d.eol, language }, lock: language !== null });
      });
    },
    [setSide],
  );

  const openFile = useCallback((side: Side) => {
    rootRef.current?.querySelector<HTMLInputElement>(`input[type="file"][data-open-side="${side}"]`)?.click();
  }, []);

  useImperativeHandle(ref, () => ({ editors, apply, goTo, setDocs, getDocs, openFile }), [editors, apply, goTo, setDocs, getDocs, openFile]);

  const onApplyClick = (index: number, dir: Direction, e: MouseEvent) =>
    apply(index, dir, e.ctrlKey || e.metaKey ? "append" : "replace");

  const runs = useMemo(
    () =>
      settings.collapse && editors.a && editors.b
        ? collapsedRuns(editors.blocks, editors.a.state.doc.lines, editors.b.state.doc.lines, settings.contextLines, expanded)
        : [],
    [settings.collapse, settings.contextLines, editors.blocks, editors.a, editors.b, expanded],
  );

  // Line counts are read from the CodeMirror doc (O(1)); blocks change identity after every edit, which is when they may have changed.
  const counts = useMemo(
    () => ({ a: editors.a ? lineCount(editors.a.state.doc) : 0, b: editors.b ? lineCount(editors.b.state.doc) : 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editors.a, editors.b, editors.blocks],
  );

  const dropProps = (side: Side) => ({
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(side);
    },
    onDragLeave: () => setDragging((d) => (d === side ? null : d)),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(null);
      void loadFile(side, e.dataTransfer.files[0]);
    },
  });

  const header = (side: Side) => (
    <PaneHeader
      side={side}
      label={t(LABEL[side])}
      name={meta[side].name}
      language={meta[side].language}
      lineCount={counts[side] === 0 ? null : counts[side]}
      focused={editors.focused === side}
      copyValue={() => joinEol(editors[side]?.state.doc.toString() ?? "", meta[side].eol)}
      onName={(name) => {
        const language = fileLanguage(name);
        setSide(side, language ? { meta: { name, language }, lock: true } : { meta: { name } });
      }}
      onLanguage={(language) => setSide(side, { meta: { language }, lock: true })}
      onFile={(file) => void loadFile(side, file)}
      onPaste={() => void paste(side)}
      onClear={() => setSide(side, { text: "", meta: { name: "", eol: "LF", language: null }, lock: false })}
      onSave={() => void save(side)}
    />
  );

  const overlay = (side: Side) =>
    counts[side] === 0 && (
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-muted-foreground"
        style={{ font: "13px/1.5 system-ui, sans-serif" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        </svg>
        <p className="m-0 text-[13px] font-medium text-foreground">{t("diffMerge.overlay.title")}</p>
        <span className="text-xs">
          {side === "a" ? t("diffMerge.overlay.left") : t("diffMerge.overlay.right")}
        </span>
      </div>
    );

  // Left/right split: the 64px gutter is the drag handle. Pointer events are captured so a fast drag cannot lose it.
  const dragSplit = (e: PointerEvent<HTMLElement>) => {
    const box = rootRef.current?.getBoundingClientRect();
    if (!box || box.width <= GUTTER_WIDTH + MAP_WIDTH) return;
    const next = (e.clientX - box.left - GUTTER_WIDTH / 2) / (box.width - GUTTER_WIDTH - MAP_WIDTH);
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next)));
  };
  const splitProps = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      resizing.current = true;
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (resizing.current) dragSplit(e);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      resizing.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    onDoubleClick: (e: MouseEvent<HTMLElement>) => {
      if (!(e.target as HTMLElement).closest("button")) setSplit(0.5);
    },
  };
  const onSplitKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
    if (!step) return;
    e.preventDefault();
    setSplit((s) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round((s + step) * 100) / 100)));
  };

  const border60 = "1px solid hsl(var(--border) / .6)";
  const pane = (side: Side, host: typeof hostA) => (
    <div
      data-testid={`pane-${side}`}
      data-drop-zone
      data-drop-side={side}
      className="relative min-w-0 overflow-hidden"
      style={dragging === side ? { outline: "2px dashed hsl(var(--ring))", outlineOffset: -2 } : undefined}
      {...dropProps(side)}
    >
      <div ref={host} className="h-full" />
      {overlay(side)}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="dm-root grid min-h-0 flex-1"
      style={{
        // fr values must add up to at least 1, or the tracks would not fill the row.
        gridTemplateColumns: `minmax(0,${Math.round(split * 1000) / 10}fr) ${GUTTER_WIDTH}px minmax(0,${Math.round((1 - split) * 1000) / 10}fr) ${MAP_WIDTH}px`,
        gridTemplateRows: showHeaders ? `${headerHeight}px minmax(0,1fr)` : "minmax(0,1fr)",
      }}
    >
      {showHeaders && (
        <>
          {header("a")}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("diffMerge.resize")}
            aria-valuemin={SPLIT_MIN * 100}
            aria-valuemax={SPLIT_MAX * 100}
            aria-valuenow={Math.round(split * 100)}
            tabIndex={0}
            title={t("diffMerge.resizeHint")}
            className="cursor-col-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{ background: "hsl(var(--muted) / .35)", borderBottom: "1px solid hsl(var(--border) / .5)", borderLeft: border60, borderRight: border60 }}
            onKeyDown={onSplitKey}
            {...splitProps}
          />
          <div className="col-span-2 min-w-0 [&>div]:h-full">{header("b")}</div>
        </>
      )}
      {pane("a", hostA)}
      <div className="relative cursor-col-resize touch-none overflow-hidden" style={{ borderLeft: border60, borderRight: border60 }} {...splitProps}>
        <Gutter editors={editors} current={current} runs={runs} onApply={onApplyClick} />
      </div>
      {pane("b", hostB)}
      <div className="relative" style={{ borderLeft: "1px solid hsl(var(--border) / .5)", background: "hsl(var(--muted) / .3)" }}>
        <ChangeMap editors={editors} current={current} onGoTo={goTo} />
      </div>
    </div>
  );
});
