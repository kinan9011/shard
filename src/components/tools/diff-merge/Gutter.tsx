import type { MouseEvent } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import type { LineRange } from "@/utils/diff-merge/blocks";
import { GUTTER_WIDTH, ribbonPath, type CollapsedRun } from "@/utils/diff-merge/geometry";
import type { Direction } from "@/utils/diff-merge/apply";
import { KIND_VAR } from "./editor";
import type { DiffEditors } from "./useDiffEditors";
import { useGeometryTick } from "./useGeometryTick";

interface Props {
  editors: DiffEditors;
  current: number;
  runs: readonly CollapsedRun[];
  onApply(index: number, dir: Direction, event: MouseEvent): void;
}

interface Span { top: number; bottom: number; empty: boolean }

/** y of a line range in gutter coordinates; an empty range is a zero-height span at the boundary. */
function span(view: EditorView, lines: LineRange): Span {
  const doc = view.state.doc;
  const pad = view.documentPadding.top - view.scrollDOM.scrollTop;
  if (lines.to > lines.from) {
    const first = Math.min(lines.from + 1, doc.lines);
    const last = Math.min(lines.to, doc.lines);
    return {
      top: view.lineBlockAt(doc.line(first).from).top + pad,
      bottom: view.lineBlockAt(doc.line(last).from).bottom + pad,
      empty: false,
    };
  }
  const y = lines.from < doc.lines
    ? view.lineBlockAt(doc.line(lines.from + 1).from).top
    : view.lineBlockAt(doc.line(doc.lines).from).bottom;
  return { top: y + pad, bottom: y + pad, empty: true };
}

const CHIP_SHADOW = "0 0 0 1px hsl(var(--border)), 0 1px 2px rgb(0 0 0 / .15)";

/** The 64px column between the panes: curved ribbons joining each change, and the >> / << merge arrows. */
export function Gutter({ editors, current, runs, onApply }: Props) {
  useGeometryTick(editors.a, editors.b);
  const { a, b, blocks } = editors;
  if (!a || !b) return null;
  // Without layout (jsdom) the height is 0: draw everything rather than nothing.
  const height = a.scrollDOM.clientHeight || Infinity;
  const visible = (...spans: Span[]) => spans.some((s) => s.bottom >= -20 && s.top <= height + 20);

  const ribbons = runs
    .map((run) => ({ key: `run-${run.a.from}`, left: span(a, run.a), right: span(b, run.b) }))
    .filter((r) => visible(r.left, r.right));

  const items = blocks
    .map((block) => ({ block, left: span(a, block.linesA), right: span(b, block.linesB) }))
    .filter((item) => visible(item.left, item.right));

  return (
    <div className="absolute inset-0 overflow-hidden">
      <svg width={GUTTER_WIDTH} height="100%" className="pointer-events-none absolute left-0 top-0" aria-hidden="true">
        {ribbons.map((r) => (
          <path key={r.key} d={ribbonPath(r.left.top, r.left.bottom, r.right.top, r.right.bottom)} style={{ fill: "hsl(var(--muted))", stroke: "none" }} />
        ))}
        {items.map(({ block, left, right }) => {
          const cur = block.index === current;
          const kind = `var(${KIND_VAR[block.kind]})`;
          return (
            <path
              key={block.index}
              d={ribbonPath(left.top, left.bottom, right.top, right.bottom)}
              style={{
                fill: `hsl(${kind} / var(${cur ? "--dm-a-cur" : "--dm-a-rib"}))`,
                stroke: cur ? "hsl(var(--ring))" : "none",
                strokeWidth: 1,
              }}
            />
          );
        })}
      </svg>
      {items.map(({ block, left, right }) => {
        const cur = block.index === current;
        const style = (top: number, x: number) => ({
          top,
          left: x,
          background: cur ? "var(--surface-raised)" : "transparent",
          boxShadow: cur ? CHIP_SHADOW : "none",
          color: cur ? "hsl(var(--foreground))" : "hsl(var(--foreground) / .7)",
        });
        const n = block.index + 1;
        return (
          <div key={block.index}>
            <button
              type="button"
              title={`Apply left to right (change ${n})`}
              aria-label={`Apply left to right (change ${n})`}
              className="absolute grid h-[18px] w-[18px] place-items-center rounded"
              style={style(left.empty ? left.top - 9 : left.top + 2, 3)}
              onClick={(e) => onApply(block.index, "toRight", e)}
            >
              <ChevronsRight size={13} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button
              type="button"
              title={`Apply right to left (change ${n})`}
              aria-label={`Apply right to left (change ${n})`}
              className="absolute grid h-[18px] w-[18px] place-items-center rounded"
              style={style(right.empty ? right.top - 9 : right.top + 2, GUTTER_WIDTH - 21)}
              onClick={(e) => onApply(block.index, "toLeft", e)}
            >
              <ChevronsLeft size={13} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
