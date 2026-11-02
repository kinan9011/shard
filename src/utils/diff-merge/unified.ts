import type { BlockKind, DiffBlock } from "./blocks";
import type { CollapsedRun } from "./geometry";
import { inlineRanges, type HighlightMode } from "./inline";

export interface UnifiedRow {
  old: number | null;
  new: number | null;
  mark: "+" | "−" | "";
  kind: BlockKind | null;
  block: number | null;
  first: boolean;
  fold: CollapsedRun | null;
}

/** One doc for the unified viewer: unchanged lines, then each block's removed lines followed by its added lines. */
export function buildUnifiedDoc(
  a: string,
  b: string,
  blocks: readonly DiffBlock[],
  highlight: HighlightMode,
  runs: readonly CollapsedRun[],
): { text: string; rows: UnifiedRow[]; marks: [number, number, "add" | "del"][] } {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const lines: string[] = [];
  const rows: UnifiedRow[] = [];
  const marks: [number, number, "add" | "del"][] = [];
  let pos = 0;
  const push = (text: string, row: UnifiedRow) => {
    lines.push(text);
    rows.push(row);
    pos += text.length + 1;
  };
  const foldAt = new Map(runs.map((run) => [run.a.from, run]));

  let i = 0;
  let j = 0;
  const unchangedUntil = (endA: number) => {
    while (i < endA) {
      const fold = foldAt.get(i);
      if (fold && fold.a.to <= endA) {
        push("", { old: null, new: null, mark: "", kind: null, block: null, first: false, fold });
        j += fold.b.to - fold.b.from;
        i = fold.a.to;
        continue;
      }
      push(linesA[i], { old: i + 1, new: j + 1, mark: "", kind: null, block: null, first: false, fold: null });
      i++;
      j++;
    }
  };

  for (const block of blocks) {
    unchangedUntil(block.linesA.from);
    const startA = pos;
    let first = true;
    for (let k = block.linesA.from; k < block.linesA.to; k++) {
      push(linesA[k], { old: k + 1, new: null, mark: "−", kind: block.kind, block: block.index, first, fold: null });
      first = false;
    }
    const startB = pos;
    for (let k = block.linesB.from; k < block.linesB.to; k++) {
      push(linesB[k], { old: null, new: k + 1, mark: "+", kind: block.kind, block: block.index, first, fold: null });
      first = false;
    }
    if (block.kind === "modified") {
      const r = inlineRanges(block, highlight);
      for (const [f, t] of r.a) marks.push([startA + f - block.fromA, startA + t - block.fromA, "del"]);
      for (const [f, t] of r.b) marks.push([startB + f - block.fromB, startB + t - block.fromB, "add"]);
    }
    i = block.linesA.to;
    j = block.linesB.to;
  }
  unchangedUntil(linesA.length);
  return { text: lines.join("\n"), rows, marks };
}

/** Change-map ticks for the unified viewer: each block's share of the unified rows, as percentages. */
export function unifiedTicks(rows: readonly UnifiedRow[]): { top: number; height: number; kind: BlockKind; index: number }[] {
  const total = Math.max(rows.length, 1);
  const spans = new Map<number, { first: number; last: number; kind: BlockKind }>();
  rows.forEach((row, i) => {
    if (row.block === null || row.kind === null) return;
    const span = spans.get(row.block);
    if (span) span.last = i;
    else spans.set(row.block, { first: i, last: i, kind: row.kind });
  });
  return [...spans].map(([index, s]) => ({
    top: (s.first / total) * 100,
    height: ((s.last - s.first + 1) / total) * 100,
    kind: s.kind,
    index,
  }));
}
