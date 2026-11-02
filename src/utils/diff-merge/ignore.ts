import { Change, diff } from "@codemirror/merge";
import type { DiffOptions } from "./blocks";
import { DIFF_CONFIG } from "./config";

const MAX_KEYS = 60_000;

function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  return starts;
}

/**
 * Line diff that treats lines as equal when they match after normalisation
 * (trim / whitespace / case). Returns char-offset changes in the raw texts,
 * with a word-level diff inside every changed span so inline marks still work.
 */
export function diffIgnoring(a: string, b: string, opts: DiffOptions): Change[] {
  const normalise = (line: string) => {
    const key = opts.ignore === "trim" ? line.trim() : opts.ignore === "none" ? line : line.replace(/\s+/g, "");
    return opts.ignoreCase ? key.toLowerCase() : key;
  };
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const startsA = lineStarts(linesA);
  const startsB = lineStarts(linesB);
  const dropBlank = opts.ignore === "whitespace-lines";

  const ids = new Map<string, number>();
  let overflow = false;
  const encode = (lines: string[]) => {
    const map: number[] = []; // kept index -> original line index
    let enc = "";
    lines.forEach((line, i) => {
      const key = normalise(line);
      if (dropBlank && key === "") return;
      let id = ids.get(key);
      if (id === undefined) {
        if (ids.size >= MAX_KEYS) {
          overflow = true;
          return;
        }
        id = ids.size;
        ids.set(key, id);
      }
      let unit = 0x100 + id;
      if (unit >= 0xd800) unit += 0x800; // skip the surrogate range
      enc += String.fromCharCode(unit);
      map.push(i);
    });
    return { enc, map };
  };
  const ea = encode(linesA);
  const eb = encode(linesB);
  // ponytail: line-key encoding caps at ~60k distinct lines; fallback is plain diff
  if (overflow) return [...diff(a, b, DIFF_CONFIG)];

  // Raw char offset of a kept-line range; an empty range points at the start of the next kept line.
  const span = (text: string, lines: string[], starts: number[], map: number[], from: number, to: number): [number, number] => {
    if (from === to) {
      const pos = from < map.length ? starts[map[from]] : text.length;
      return [pos, pos];
    }
    const last = map[to - 1];
    return [starts[map[from]], Math.min(text.length, starts[last] + lines[last].length + 1)];
  };

  const out: Change[] = [];
  for (const c of diff(ea.enc, eb.enc, DIFF_CONFIG)) {
    const [fa, ta] = span(a, linesA, startsA, ea.map, c.fromA, c.toA);
    const [fb, tb] = span(b, linesB, startsB, eb.map, c.fromB, c.toB);
    if (ta > fa && tb > fb) {
      for (const d of diff(a.slice(fa, ta), b.slice(fb, tb), DIFF_CONFIG)) {
        out.push(new Change(fa + d.fromA, fa + d.toA, fb + d.fromB, fb + d.toB));
      }
    } else {
      out.push(new Change(fa, ta, fb, tb));
    }
  }
  return out;
}
