import type { BlockKind, DiffBlock, LineRange } from "./blocks";

export const GUTTER_WIDTH = 64;

/** Curved ribbon joining line span a1..a2 (left) to b1..b2 (right), as in the design. */
export function ribbonPath(a1: number, a2: number, b1: number, b2: number, width = GUTTER_WIDTH): string {
  const c = width / 2;
  return `M0 ${a1} C${c} ${a1} ${c} ${b1} ${width} ${b1} L${width} ${b2} C${c} ${b2} ${c} ${a2} 0 ${a2} Z`;
}

/**
 * Pixel position on the other side. `top(side, line)` is the pixel top of a 0-based line (past the last line: the bottom of
 * the doc). Inside a block the position maps linearly between the block's pixel spans, so a taller side is not stepped
 * through line by line; between blocks the offset stays constant.
 */
export function mapPixel(
  blocks: readonly DiffBlock[],
  from: "a" | "b",
  y: number,
  top: (side: "a" | "b", line: number) => number,
): number {
  const to = from === "a" ? "b" : "a";
  let srcEnd = 0;
  let dstEnd = 0;
  for (const block of blocks) {
    const here = from === "a" ? block.linesA : block.linesB;
    const there = from === "a" ? block.linesB : block.linesA;
    const hereTop = top(from, here.from);
    if (y < hereTop) break;
    const hereBottom = top(from, here.to);
    const thereTop = top(to, there.from);
    const thereBottom = top(to, there.to);
    if (y < hereBottom) return thereTop + ((y - hereTop) / (hereBottom - hereTop)) * (thereBottom - thereTop);
    srcEnd = hereBottom;
    dstEnd = thereBottom;
  }
  return dstEnd + (y - srcEnd);
}

export interface CollapsedRun { a: LineRange; b: LineRange; hidden: number }

/** Long unchanged stretches, minus `context` lines at each end. `expanded` holds `a.from` of runs the user opened. */
export function collapsedRuns(
  blocks: readonly DiffBlock[],
  linesA: number,
  linesB: number,
  context: number,
  expanded: ReadonlySet<number>,
): CollapsedRun[] {
  const runs: CollapsedRun[] = [];
  const stretch = (startA: number, endA: number, startB: number) => {
    const n = endA - startA;
    if (n <= 2 * context + 1 || expanded.has(startA + context)) return;
    runs.push({
      a: { from: startA + context, to: endA - context },
      b: { from: startB + context, to: startB + n - context },
      hidden: n - 2 * context,
    });
  };
  let a = 0;
  let b = 0;
  for (const block of blocks) {
    stretch(a, block.linesA.from, b);
    a = block.linesA.to;
    b = block.linesB.to;
  }
  stretch(a, linesA, b);
  void linesB;
  return runs;
}

/** Change-map ticks as percentages of the modified document. */
export function mapTicks(
  blocks: readonly DiffBlock[],
  linesB: number,
): { top: number; height: number; kind: BlockKind; index: number }[] {
  const total = Math.max(linesB, 1);
  return blocks.map((block) => ({
    top: (block.linesB.from / total) * 100,
    height: (Math.max(block.linesB.to - block.linesB.from, 0.4) / total) * 100,
    kind: block.kind,
    index: block.index,
  }));
}
