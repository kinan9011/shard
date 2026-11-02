import type { DiffBlock } from "./blocks";

export type Direction = "toRight" | "toLeft";

/**
 * Change spec for the DESTINATION doc (b for `toRight`, a for `toLeft`).
 * `replace` mirrors `@codemirror/merge`'s revert; `append` keeps the target and adds the source after it.
 * A block's `to` offset can sit one past the doc end when its last line has no newline.
 */
export function blockReplacement(
  block: DiffBlock,
  a: string,
  b: string,
  dir: Direction,
  mode: "replace" | "append",
): { from: number; to: number; insert: string } {
  const toRight = dir === "toRight";
  const src = toRight ? a : b;
  const dest = toRight ? b : a;
  const srcFrom = toRight ? block.fromA : block.fromB;
  const srcTo = toRight ? block.toA : block.toB;
  const destFrom = toRight ? block.fromB : block.fromA;
  const destTo = toRight ? block.toB : block.toA;
  const text = src.slice(srcFrom, Math.max(srcFrom, srcTo - 1));
  const hasSource = srcFrom !== srcTo;

  if (mode === "replace") {
    return {
      from: destFrom,
      to: Math.min(dest.length, destTo),
      insert: hasSource && destTo <= dest.length ? text + "\n" : text,
    };
  }
  const at = Math.min(destTo, dest.length);
  if (!hasSource) return { from: at, to: at, insert: "" };
  const lead = at === dest.length && dest.length > 0 && !dest.endsWith("\n");
  return { from: at, to: at, insert: lead ? "\n" + text : text + "\n" };
}
