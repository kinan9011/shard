import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { DIFF_CONFIG } from "./config";
import { diffIgnoring } from "./ignore";

export type BlockKind = "added" | "removed" | "modified";
/** 0-based line indexes, `to` exclusive. */
export interface LineRange { from: number; to: number }
/** Relative to the block start (CodeMirror `Change` semantics). */
export interface InnerChange { fromA: number; toA: number; fromB: number; toB: number }
export interface DiffBlock {
  index: number;
  kind: BlockKind;
  /** Char offsets, same meaning as an `@codemirror/merge` Chunk. */
  fromA: number; toA: number; fromB: number; toB: number;
  linesA: LineRange;
  linesB: LineRange;
  changes: readonly InnerChange[];
  precise: boolean;
  /** The block's own slice of each side (`a.slice(fromA, toA)`), so word marks need no extra input. */
  textA: string;
  textB: string;
}
export type IgnoreMode = "none" | "trim" | "whitespace" | "whitespace-lines";
export interface DiffOptions { ignore: IgnoreMode; ignoreCase: boolean }

export { DIFF_CONFIG };

function lineRange(doc: Text, from: number, to: number): LineRange {
  const first = doc.lineAt(from).number - 1;
  if (to <= from) return { from: first, to: first };
  return { from: first, to: doc.lineAt(to - 1).number };
}

export function computeBlocks(a: string, b: string, opts: DiffOptions): DiffBlock[] {
  const docA = Text.of(a.split("\n"));
  const docB = Text.of(b.split("\n"));
  const plain = opts.ignore === "none" && !opts.ignoreCase;
  const conf = plain ? DIFF_CONFIG : { ...DIFF_CONFIG, override: (x: string, y: string) => diffIgnoring(x, y, opts) };
  return Chunk.build(docA, docB, conf).map((chunk, index) => {
    const linesA = lineRange(docA, chunk.fromA, chunk.toA);
    const linesB = lineRange(docB, chunk.fromB, chunk.toB);
    const kind: BlockKind = linesA.from === linesA.to ? "added" : linesB.from === linesB.to ? "removed" : "modified";
    return {
      index,
      kind,
      fromA: chunk.fromA,
      toA: chunk.toA,
      fromB: chunk.fromB,
      toB: chunk.toB,
      linesA,
      linesB,
      changes: chunk.changes.map((c) => ({ fromA: c.fromA, toA: c.toA, fromB: c.fromB, toB: c.toB })),
      precise: chunk.precise,
      textA: a.slice(chunk.fromA, chunk.toA),
      textB: b.slice(chunk.fromB, chunk.toB),
    };
  });
}

export function blockStats(blocks: readonly DiffBlock[]): { added: number; removed: number; modified: number } {
  const stats = { added: 0, removed: 0, modified: 0 };
  for (const block of blocks) stats[block.kind]++;
  return stats;
}

export type Eol = "LF" | "CRLF";

/** CRLF if the first line break is `\r\n`. The text is normalised to `\n`. */
export function splitEol(raw: string): { text: string; eol: Eol } {
  const i = raw.indexOf("\n");
  return { text: raw.replace(/\r\n/g, "\n"), eol: i > 0 && raw[i - 1] === "\r" ? "CRLF" : "LF" };
}

export function joinEol(text: string, eol: Eol): string {
  return eol === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
}
