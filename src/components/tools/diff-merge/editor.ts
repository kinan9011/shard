import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { BlockKind, DiffBlock } from "@/utils/diff-merge/blocks";
import type { CollapsedRun } from "@/utils/diff-merge/geometry";
import { inlineRanges, type HighlightMode } from "@/utils/diff-merge/inline";

export interface DiffDecoState {
  side: "a" | "b";
  blocks: readonly DiffBlock[];
  current: number;
  highlight: HighlightMode;
  runs: readonly CollapsedRun[];
}

/** Fired (bubbling) by a fold bar; `detail` is the run's `a.from`, the key `collapsedRuns` expects in `expanded`. */
export const EXPAND_EVENT = "dm-expand";

/** Theme token behind each change kind: lines, ribbons and map ticks all colour from it. */
export const KIND_VAR: Record<BlockKind, string> = {
  added: "--success",
  removed: "--destructive",
  modified: "--warning",
};

const EMPTY: DiffDecoState = { side: "a", blocks: [], current: 0, highlight: "words", runs: [] };

export const setDiff = StateEffect.define<DiffDecoState>();

export const diffState = StateField.define<DiffDecoState>({
  create: () => EMPTY,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setDiff)) return effect.value;
    return value;
  },
});

export const languageConf = new Compartment();
export const wrapConf = new Compartment();
export const whitespaceConf = new Compartment();

export const dmHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-kw)" },
  { tag: t.string, color: "var(--syntax-str)" },
  { tag: t.number, color: "var(--syntax-num)" },
  { tag: [t.bool, t.null, t.atom, t.standard(t.variableName)], color: "var(--syntax-lit)" },
  { tag: t.function(t.definition(t.variableName)), color: "var(--syntax-fn)" },
  { tag: t.comment, color: "hsl(var(--muted-foreground))" },
]);

const FOLD_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';

export class FoldWidget extends WidgetType {
  constructor(readonly run: CollapsedRun) {
    super();
  }
  eq(other: FoldWidget) {
    return other.run.hidden === this.run.hidden && other.run.a.from === this.run.a.from && other.run.b.from === this.run.b.from;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "dm-fold";
    el.setAttribute("role", "button");
    el.innerHTML = `${FOLD_ICON}<span class="dm-fold-label">${this.run.hidden} unchanged lines</span><span>Click to expand</span>`;
    el.addEventListener("click", () =>
      el.dispatchEvent(new CustomEvent(EXPAND_EVENT, { bubbles: true, detail: this.run.a.from })),
    );
    return el;
  }
  get estimatedHeight() {
    return 22;
  }
  ignoreEvent() {
    return true;
  }
}

class GapWidget extends WidgetType {
  constructor(readonly kind: BlockKind) {
    super();
  }
  eq(other: GapWidget) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `dm-gap dm-gap-${this.kind}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  get estimatedHeight() {
    return 2;
  }
}

const KIND_CLASS: Record<BlockKind, string> = { added: "dm-add", removed: "dm-del", modified: "dm-mod" };

/** Gap and fold widgets. Block decorations must come from a state field, so these cover the whole document. */
function buildStructural(doc: Text, s: DiffDecoState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const block of s.blocks) {
    const lines = s.side === "a" ? block.linesA : block.linesB;
    if (lines.to > lines.from) continue;
    const atEnd = lines.from >= doc.lines;
    const widget = Decoration.widget({ widget: new GapWidget(block.kind), block: true, side: atEnd ? 1 : -1 });
    ranges.push(widget.range(atEnd ? doc.length : doc.line(lines.from + 1).from));
  }
  for (const run of s.runs) {
    const lines = s.side === "a" ? run.a : run.b;
    if (lines.to <= lines.from || lines.to > doc.lines) continue;
    ranges.push(
      Decoration.replace({ widget: new FoldWidget(run), block: true }).range(
        doc.line(lines.from + 1).from,
        doc.line(lines.to).to,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

const structural = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setDiff)) return buildStructural(tr.state.doc, effect.value);
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Line and word decorations, built only for the viewport so a huge paste does not decorate every block. Positions are clamped, since the doc may have moved on. */
function buildViewport(view: EditorView, s: DiffDecoState): DecorationSet {
  const doc = view.state.doc;
  const firstLine = doc.lineAt(view.viewport.from).number;
  const lastLine = doc.lineAt(view.viewport.to).number;
  const ranges: Range<Decoration>[] = [];
  for (const block of s.blocks) {
    const lines = s.side === "a" ? block.linesA : block.linesB;
    // A modified block with no lines on this side still has nothing to mark here.
    if (lines.to < firstLine - 1 || lines.from + 1 > lastLine) continue;
    const cls = KIND_CLASS[block.kind];
    const cur = block.index === s.current;
    for (let n = Math.max(lines.from + 1, firstLine); n <= Math.min(lines.to, doc.lines, lastLine); n++) {
      const edge = (cur && n === lines.from + 1 ? " dm-cur-first" : "") + (cur && n === lines.to ? " dm-cur-last" : "");
      ranges.push(Decoration.line({ class: `dm-line ${cls}${cur ? " dm-cur" : ""}${edge}` }).range(doc.line(n).from));
    }
    if (block.kind === "modified") {
      for (const [from, to] of inlineRanges(block, s.highlight)[s.side]) {
        const f = Math.min(from, doc.length);
        const e = Math.min(to, doc.length);
        if (e > f) ranges.push(Decoration.mark({ class: "dm-word" }).range(f, e));
      }
    }
  }
  return Decoration.set(ranges, true);
}

const viewportMarks = ViewPlugin.fromClass(
  class {
    decos: DecorationSet;
    constructor(view: EditorView) {
      this.decos = buildViewport(view, view.state.field(diffState));
    }
    update(u: ViewUpdate) {
      const next = u.state.field(diffState);
      if (next !== u.startState.field(diffState) || u.viewportChanged) this.decos = buildViewport(u.view, next);
      else if (u.docChanged) this.decos = this.decos.map(u.changes);
    }
  },
  { decorations: (v) => v.decos },
);

export function getDiffState(state: EditorState): DiffDecoState {
  return state.field(diffState);
}

export function paneExtensions(side: "a" | "b", placeholderText: string): Extension {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    placeholder(placeholderText),
    syntaxHighlighting(dmHighlightStyle),
    languageConf.of([]),
    wrapConf.of([]),
    whitespaceConf.of([]),
    diffState.init(() => ({ ...EMPTY, side })),
    structural,
    viewportMarks,
  ];
}
