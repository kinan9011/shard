import { EditorState } from "@codemirror/state";
import { EditorView, highlightWhitespace, type ViewUpdate } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { computeBlocks, type DiffBlock } from "@/utils/diff-merge/blocks";
import { collapsedRuns } from "@/utils/diff-merge/geometry";
import type { DiffSettings } from "@/utils/diff-merge/settings";
import { paneExtensions, setDiff, whitespaceConf, wrapConf } from "./editor";

export interface DiffEditors {
  a: EditorView | null;
  b: EditorView | null;
  blocks: readonly DiffBlock[];
  /** False when the diff hit its scan limit or timeout and is approximate. */
  precise: boolean;
  focused: "a" | "b";
  /** Outside React state: a cursor move must not re-render the panes, only the status bar that subscribes. */
  cursor: CursorStore;
}

export interface CursorStore {
  get(): { line: number; col: number };
  subscribe(listener: () => void): () => void;
}

/** Above this many lines on either side the diff waits for a pause in typing instead of running every frame. */
const BIG_DOC_LINES = 5000;
const BIG_DOC_DELAY_MS = 150;

interface Options {
  settings: DiffSettings;
  current: number;
  expanded: ReadonlySet<number>;
  initialA?: string;
  initialB?: string;
}

type Views = { a: EditorView; b: EditorView };

const PLACEHOLDERS = { a: "Paste the original text", b: "Paste the modified text" } as const;

export function useDiffEditors(
  hostA: RefObject<HTMLDivElement>,
  hostB: RefObject<HTMLDivElement>,
  opts: Options,
): DiffEditors {
  const { settings, current, expanded } = opts;
  const [views, setViews] = useState<Views | null>(null);
  const [result, setResult] = useState<{ blocks: readonly DiffBlock[]; precise: boolean }>({ blocks: [], precise: true });
  const [focused, setFocused] = useState<"a" | "b">("b");
  const cursorValue = useRef({ line: 1, col: 1 });
  const cursorListeners = useRef(new Set<() => void>());
  const cursor = useMemo<CursorStore>(
    () => ({
      get: () => cursorValue.current,
      subscribe: (listener) => {
        cursorListeners.current.add(listener);
        return () => void cursorListeners.current.delete(listener);
      },
    }),
    [],
  );

  const optsRef = useRef(opts);
  const viewsRef = useRef<Views | null>(null);
  const blocksRef = useRef<readonly DiffBlock[]>([]);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    optsRef.current = opts;
  });

  /** Re-dispatches the decorations from the blocks already computed (current block, highlight or fold changes). */
  const redecorate = useCallback(() => {
    const v = viewsRef.current;
    if (!v) return;
    const { settings: s, current, expanded } = optsRef.current;
    const blocks = blocksRef.current;
    const runs = s.collapse ? collapsedRuns(blocks, v.a.state.doc.lines, v.b.state.doc.lines, s.contextLines, expanded) : [];
    for (const side of ["a", "b"] as const) {
      v[side].dispatch({ effects: setDiff.of({ side, blocks, current, highlight: s.highlight, runs }) });
    }
  }, []);

  /** Diffs the two documents as they are now. This is the only place the diff engine runs. */
  const recompute = useCallback(() => {
    const v = viewsRef.current;
    if (!v) return;
    // A synchronous recompute (settings) makes any pending frame or delayed run redundant.
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { settings: s } = optsRef.current;
    const blocks = computeBlocks(v.a.state.doc.toString(), v.b.state.doc.toString(), {
      ignore: s.ignore,
      ignoreCase: s.ignoreCase,
    });
    blocksRef.current = blocks;
    redecorate();
    setResult({ blocks, precise: blocks.every((block) => block.precise) });
  }, [redecorate]);

  useEffect(() => {
    const parentA = hostA.current;
    const parentB = hostB.current;
    if (!parentA || !parentB) return;
    const schedule = () => {
      const v = viewsRef.current;
      // ponytail: fixed threshold; a diff-time based adaptive delay if big docs still stutter
      if (v && Math.max(v.a.state.doc.lines, v.b.state.doc.lines) > BIG_DOC_LINES) {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(recompute, BIG_DOC_DELAY_MS);
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        recompute();
      });
    };
    const make = (side: "a" | "b", parent: HTMLElement, doc: string) => {
      const onUpdate = (update: ViewUpdate) => {
        if (update.docChanged) schedule();
        if (update.focusChanged && update.view.hasFocus) setFocused(side);
        if (update.view.hasFocus && (update.selectionSet || update.docChanged || update.focusChanged)) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          const col = head - line.from + 1;
          if (cursorValue.current.line !== line.number || cursorValue.current.col !== col) {
            cursorValue.current = { line: line.number, col };
            cursorListeners.current.forEach((l) => l());
          }
        }
      };
      return new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [paneExtensions(side, PLACEHOLDERS[side]), EditorView.updateListener.of(onUpdate)],
        }),
      });
    };
    const next = {
      a: make("a", parentA, optsRef.current.initialA ?? ""),
      b: make("b", parentB, optsRef.current.initialB ?? ""),
    };
    viewsRef.current = next;
    setViews(next);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (timer.current !== null) clearTimeout(timer.current);
      frame.current = null;
      timer.current = null;
      viewsRef.current = null;
      next.a.destroy();
      next.b.destroy();
      setViews(null);
    };
  }, [hostA, hostB, recompute]);

  useEffect(() => {
    if (views) recompute();
  }, [views, settings.ignore, settings.ignoreCase, recompute]);

  useEffect(() => {
    if (views) redecorate();
  }, [views, current, expanded, settings.highlight, settings.collapse, settings.contextLines, redecorate]);

  useEffect(() => {
    if (!views) return;
    for (const view of [views.a, views.b]) {
      view.dispatch({
        effects: [
          wrapConf.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
          whitespaceConf.reconfigure(settings.showWhitespace ? highlightWhitespace() : []),
        ],
      });
    }
  }, [views, settings.wrap, settings.showWhitespace]);

  return useMemo(
    () => ({ a: views?.a ?? null, b: views?.b ?? null, blocks: result.blocks, precise: result.precise, focused, cursor }),
    [views, result, focused, cursor],
  );
}
