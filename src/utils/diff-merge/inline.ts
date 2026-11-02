import type { DiffBlock } from "./blocks";

export type HighlightMode = "words" | "lines" | "chars" | "none";
type Range = [number, number];

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

function wordRanges(text: string, ranges: Range[]): Range[] {
  const grown = ranges
    .map(([from, to]): Range => {
      // Only grow a side that touches a word character, never across punctuation.
      while (from > 0 && isWord(text[from - 1]) && isWord(text[from])) from--;
      while (to < text.length && isWord(text[to]) && isWord(text[to - 1])) to++;
      return [from, to];
    })
    .sort((x, y) => x[0] - y[0]);
  const merged: Range[] = [];
  for (const r of grown) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else if (last && /^[ \t]+$/.test(text.slice(last[1], r[0]))) last[1] = r[1]; // fill blanks between two changes
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Absolute char offsets to mark inside a block, per side. */
export function inlineRanges(block: DiffBlock, mode: HighlightMode): { a: Range[]; b: Range[] } {
  if (mode === "lines" || mode === "none") return { a: [], b: [] };
  const a: Range[] = [];
  const b: Range[] = [];
  for (const c of block.changes) {
    if (c.toA > c.fromA) a.push([c.fromA, c.toA]);
    if (c.toB > c.fromB) b.push([c.fromB, c.toB]);
  }
  const rel = mode === "words"
    ? { a: wordRanges(block.textA, a), b: wordRanges(block.textB, b) }
    : { a, b };
  return {
    a: rel.a.map(([f, t]): Range => [block.fromA + f, block.fromA + t]),
    b: rel.b.map(([f, t]): Range => [block.fromB + f, block.fromB + t]),
  };
}
