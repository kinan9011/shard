import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";
import { t } from "@/i18n";
import type { Direction } from "@/utils/diff-merge/apply";
import type { DiffBlock } from "@/utils/diff-merge/blocks";
import { collapsedRuns } from "@/utils/diff-merge/geometry";
import type { DiffSettings } from "@/utils/diff-merge/settings";
import { buildUnifiedDoc, unifiedTicks, type UnifiedRow } from "@/utils/diff-merge/unified";
import { ChangeMap } from "./ChangeMap";
import { EXPAND_EVENT, FoldWidget } from "./editor";

interface Props {
  a: string;
  b: string;
  blocks: readonly DiffBlock[];
  settings: DiffSettings;
  current: number;
  expanded: ReadonlySet<number>;
  onApply(index: number, dir: Direction): void;
  onExpand(runFrom: number): void;
  onCurrentChange(index: number): void;
}

interface UniState {
  rows: readonly UnifiedRow[];
  marks: readonly [number, number, "add" | "del"][];
  current: number;
  /** First and last row of each block, so the current block gets one outline. */
  edges: ReadonlyMap<number, { first: number; last: number }>;
}

const EMPTY: UniState = { rows: [], marks: [], current: -1, edges: new Map() };
const setUni = StateEffect.define<UniState>();
const uniField = StateField.define<UniState>({
  create: () => EMPTY,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setUni)) return effect.value;
    return value;
  },
});

function makeState(rows: readonly UnifiedRow[], marks: UniState["marks"], current: number): UniState {
  const edges = new Map<number, { first: number; last: number }>();
  rows.forEach((row, i) => {
    if (row.block === null) return;
    const edge = edges.get(row.block);
    if (edge) edge.last = i;
    else edges.set(row.block, { first: i, last: i });
  });
  return { rows, marks, current, edges };
}

/** Classes shared by a row's line, its gutter cells and its outline. */
function rowClass(s: UniState, row: UnifiedRow, i: number): string {
  const parts: string[] = [];
  if (row.mark === "+") parts.push("dm-add");
  if (row.mark === "−") parts.push("dm-del");
  if (row.block !== null && row.block === s.current) {
    const edge = s.edges.get(row.block);
    parts.push("dm-cur");
    if (edge?.first === i) parts.push("dm-cur-first");
    if (edge?.last === i) parts.push("dm-cur-last");
  }
  return parts.join(" ");
}

const CHEVRONS_RIGHT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>';
const CHEVRONS_LEFT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';

class CellMarker extends GutterMarker {
  constructor(readonly key: string, cls: string, readonly make: () => Node) {
    super();
    this.elementClass = cls;
  }
  eq(other: CellMarker) {
    return other.key === this.key && other.elementClass === this.elementClass;
  }
  toDOM() {
    return this.make();
  }
}

const FOLD_CELL = new CellMarker("fold", "dm-ug-fold", () => document.createTextNode(""));

interface Handlers { onApply(index: number, dir: Direction): void }

function unifiedExtensions(handlers: { current: Handlers }): Extension {
  const column = (cls: string, cell: (row: UnifiedRow, tint: string) => CellMarker) =>
    gutter({
      class: `dm-ug ${cls}`,
      lineMarker(view, line) {
        const s = view.state.field(uniField);
        const i = view.state.doc.lineAt(line.from).number - 1;
        const row = s.rows[i];
        return row && !row.fold ? cell(row, rowClass(s, row, i)) : null;
      },
      lineMarkerChange: (update) => update.startState.field(uniField) !== update.state.field(uniField),
      widgetMarker: () => FOLD_CELL,
    });

  const chip = (icon: string, label: string, onClick: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dm-chip";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    button.addEventListener("click", onClick);
    return button;
  };
  const text = (value: string) => () => document.createTextNode(value);

  const actions = column("dm-ug-act", (row, tint) => {
    const block = row.block;
    return new CellMarker(`act|${block}|${row.first}`, tint, () => {
      const box = document.createElement("span");
      box.className = "dm-acts";
      if (row.first && block !== null) {
        box.append(
          chip(CHEVRONS_RIGHT, t("diffMerge.unified.keepLeft", { n: block + 1 }), () => handlers.current.onApply(block, "toRight")),
          chip(CHEVRONS_LEFT, t("diffMerge.unified.keepRight", { n: block + 1 }), () => handlers.current.onApply(block, "toLeft")),
        );
      }
      return box;
    });
  });
  const old = column("dm-ug-old", (row, tint) => new CellMarker(`old|${row.old}`, tint, text(row.old === null ? "" : String(row.old))));
  const next = column("dm-ug-new", (row, tint) => new CellMarker(`new|${row.new}`, tint, text(row.new === null ? "" : String(row.new))));
  const mark = column("dm-ug-mark", (row, tint) => new CellMarker(`mark|${row.mark}`, tint, text(row.mark)));

  const decorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (!effect.is(setUni)) continue;
        const s = effect.value;
        const doc = tr.state.doc;
        const ranges: Range<Decoration>[] = [];
        s.rows.forEach((row, i) => {
          if (i >= doc.lines) return;
          const line = doc.line(i + 1);
          if (row.fold) {
            ranges.push(Decoration.replace({ widget: new FoldWidget(row.fold), block: true }).range(line.from, line.to));
          } else {
            const cls = rowClass(s, row, i);
            if (cls) ranges.push(Decoration.line({ class: `dm-line ${cls}` }).range(line.from));
          }
        });
        for (const [from, to] of s.marks) {
          const f = Math.min(from, doc.length);
          const e = Math.min(to, doc.length);
          if (e > f) ranges.push(Decoration.mark({ class: "dm-word" }).range(f, e));
        }
        return Decoration.set(ranges, true);
      }
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [EditorState.readOnly.of(true), uniField, decorations, actions, old, next, mark];
}

/** Read-only unified editor with Keep chips, old and new line numbers and the change map. Renders two grid cells. */
export function UnifiedPane({ a, b, blocks, settings, current, expanded, onApply, onExpand, onCurrentChange }: Props) {
  const cell = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const handlers = useRef<Handlers>({ onApply });
  const latest = useRef({ onExpand, rows: [] as readonly UnifiedRow[], text: "" });
  useEffect(() => {
    handlers.current.onApply = onApply;
    latest.current.onExpand = onExpand;
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const created = new EditorView({ parent, state: EditorState.create({ doc: "", extensions: unifiedExtensions(handlers) }) });
    latest.current.text = "";
    // CodeMirror hides all gutters from assistive tech. The Keep chips are buttons, so only the number columns stay hidden.
    created.dom.querySelector(".cm-gutters")?.removeAttribute("aria-hidden");
    created.dom.querySelectorAll(".dm-ug-old, .dm-ug-new, .dm-ug-mark").forEach((el) => el.setAttribute("aria-hidden", "true"));
    setView(created);
    return () => {
      created.destroy();
      setView(null);
    };
  }, []);

  // Fold bars announce themselves with a bubbling event.
  useEffect(() => {
    const el = cell.current;
    if (!el) return;
    const onEvent = (e: Event) => latest.current.onExpand((e as CustomEvent<number>).detail);
    el.addEventListener(EXPAND_EVENT, onEvent);
    return () => el.removeEventListener(EXPAND_EVENT, onEvent);
  }, []);

  const built = useMemo(() => {
    const runs = settings.collapse
      ? collapsedRuns(blocks, a.split("\n").length, b.split("\n").length, settings.contextLines, expanded)
      : [];
    return buildUnifiedDoc(a, b, blocks, settings.highlight, runs);
  }, [a, b, blocks, settings.collapse, settings.contextLines, settings.highlight, expanded]);
  const ticks = useMemo(() => unifiedTicks(built.rows), [built.rows]);

  useEffect(() => {
    if (!view) return;
    const changes = latest.current.text === built.text ? undefined : { from: 0, to: view.state.doc.length, insert: built.text };
    latest.current.text = built.text;
    latest.current.rows = built.rows;
    view.dispatch({ changes, effects: setUni.of(makeState(built.rows, built.marks, current)) });
  }, [view, built, current]);

  // Navigating (F7, a map tick) scrolls the current change into view. Mounting, or a new view, does not.
  const scrolledFor = useRef(current);
  useEffect(() => {
    if (!view || scrolledFor.current === current) return;
    scrolledFor.current = current;
    const row = latest.current.rows.findIndex((r) => r.block === current);
    if (row < 0 || row >= view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(row + 1).from, { y: "center" }) });
  }, [current, view]);

  return (
    <>
      <div ref={cell} data-testid="unified-pane" className="dm-uni relative min-w-0 overflow-hidden">
        <div ref={host} className="h-full" />
      </div>
      <div className="relative" style={{ borderLeft: "1px solid hsl(var(--border) / .5)", background: "hsl(var(--muted) / .3)" }}>
        <ChangeMap editors={{ b: view, blocks }} current={current} onGoTo={onCurrentChange} ticks={ticks} />
      </div>
    </>
  );
}
