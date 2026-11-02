import { describe, expect, it } from "vitest";
import { computeBlocks } from "@/utils/diff-merge/blocks";
import { blockReplacement, type Direction } from "@/utils/diff-merge/apply";
import { inlineRanges } from "@/utils/diff-merge/inline";
import { collapsedRuns, mapPixel, mapTicks, ribbonPath } from "@/utils/diff-merge/geometry";
import { buildUnifiedDoc, unifiedTicks } from "@/utils/diff-merge/unified";
import { buildPatch } from "@/utils/diff-merge/patch";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from "@/utils/diff-merge/settings";

const none = { ignore: "none", ignoreCase: false } as const;
const blk = (a: string, b: string) => computeBlocks(a, b, none);

function apply(a: string, b: string, dir: Direction, mode: "replace" | "append", i = 0, opts: Parameters<typeof computeBlocks>[2] = none) {
  const bl = computeBlocks(a, b, opts)[i];
  const { from, to, insert } = blockReplacement(bl, a, b, dir, mode);
  const dest = dir === "toRight" ? b : a;
  return dest.slice(0, from) + insert + dest.slice(to);
}

describe("blockReplacement", () => {
  it("replace left→right makes the block equal", () =>
    expect(apply("a\nX\nc\n", "a\nY\nc\n", "toRight", "replace")).toBe("a\nX\nc\n"));
  it("replace right→left", () => expect(apply("a\nX\nc\n", "a\nY\nc\n", "toLeft", "replace")).toBe("a\nY\nc\n"));
  it("append keeps the target and adds the source after it", () =>
    expect(apply("a\nX\nc\n", "a\nY\nc\n", "toRight", "append")).toBe("a\nY\nX\nc\n"));
  it("pushes a deletion", () => expect(apply("a\nb\n", "a\n", "toRight", "replace")).toBe("a\nb\n"));
  it("handles a last line without trailing newline", () => {
    expect(apply("a\nb", "a\nc", "toRight", "replace")).toBe("a\nb");
    expect(apply("a\nb\nc", "a\nc", "toLeft", "replace")).toBe("a\nc");
  });
  it("appends after an unterminated last line without dropping or doubling the newline", () => {
    expect(apply("a\nX", "a\nY", "toRight", "append")).toBe("a\nY\nX");
    expect(apply("a\nX\n", "a\nY\n", "toLeft", "append")).toBe("a\nX\nY\n");
  });
  it("applies the last block correctly in ignore modes without a trailing newline", () => {
    const trim = { ignore: "trim", ignoreCase: false } as const;
    expect(apply("a\nX", "a\nY", "toRight", "replace", 0, trim)).toBe("a\nX");
    expect(apply("a\nX", "a\nY", "toLeft", "replace", 0, trim)).toBe("a\nY");
    expect(apply("a\nb\nc", "a\nc", "toLeft", "replace", 0, { ignore: "whitespace-lines", ignoreCase: false })).toBe("a\nc");
  });
  it("pushes into an empty doc", () => expect(apply("x\n", "", "toRight", "replace")).toBe("x\n"));
});

describe("inlineRanges", () => {
  it("word mode expands to whole words", () => {
    const [bl] = blk("read_csv(p)\n", "read_ods(p)\n");
    expect(inlineRanges(bl, "words")).toEqual({ a: [[0, 8]], b: [[0, 8]] });
    expect(inlineRanges(bl, "lines")).toEqual({ a: [], b: [] });
  });
});

describe("geometry", () => {
  it("ribbon path matches the design formula", () =>
    expect(ribbonPath(6, 28, 50, 116)).toBe("M0 6 C32 6 32 50 64 50 L64 116 C32 116 32 28 0 28 Z"));
  it("maps pixels across a block", () => {
    const bl = blk("a\nb\nc\nd\n", "a\nX\nY\nZ\nW\nd\n");
    const top = (_: "a" | "b", line: number) => line * 20; // every line is 20px tall
    expect(mapPixel(bl, "a", 0, top)).toBe(0);
    expect(mapPixel(bl, "a", 60, top)).toBe(100); // after the block: offset of 2 lines
    expect(mapPixel(bl, "a", 40, top)).toBeCloseTo(60); // halfway through the block (b..c to X..W)
    expect(mapPixel(bl, "b", 100, top)).toBe(60);
  });
  it("maps through a block that is empty on the source side without jumping backwards", () => {
    const bl = blk("a\nd\n", "a\nX\nY\nd\n");
    const top = (_: "a" | "b", line: number) => line * 20;
    const ys = [0, 10, 20, 30, 40, 60].map((y) => mapPixel(bl, "a", y, top));
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    expect(mapPixel(bl, "b", 30, top)).toBe(20); // inside the added block the left side waits at the insertion point
  });
  it("collapses runs longer than 2×context+1", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const runs = collapsedRuns(blk(a, a.replace("l19", "x")), 20, 20, 3, new Set());
    expect(runs).toEqual([{ a: { from: 3, to: 16 }, b: { from: 3, to: 16 }, hidden: 13 }]);
    expect(collapsedRuns(blk(a, a.replace("l19", "x")), 20, 20, 3, new Set([3]))).toEqual([]);
  });
});

describe("change map", () => {
  it("places ticks as percentages with a minimum height", () => {
    const bl = blk("a\nb\nc\nd\n", "a\nb\nc\nd\ne\n");
    expect(mapTicks(bl, 5)).toEqual([{ top: 80, height: 20, kind: "added", index: 0 }]);
    const rm = blk("a\nb\n", "a\n");
    expect(mapTicks(rm, 10)[0].height).toBeCloseTo(4);
  });
});

describe("unified doc and patch", () => {
  it("unified doc marks word changes and folds collapsed runs", () => {
    const a = Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n") + "\nread_csv(p)\n";
    const b = a.replace("read_csv", "read_ods");
    const bl = blk(a, b);
    const runs = collapsedRuns(bl, 14, 14, 3, new Set());
    const { text, rows, marks } = buildUnifiedDoc(a, b, bl, "words", runs);
    expect(rows.filter((r) => r.fold)).toHaveLength(1);
    const del = marks.find((m) => m[2] === "del")!;
    const add = marks.find((m) => m[2] === "add")!;
    expect(text.slice(del[0], del[1])).toBe("read_csv");
    expect(text.slice(add[0], add[1])).toBe("read_ods");
  });
  it("patch has no phantom context line at the end", () => {
    expect(buildPatch("a\n", "b\n", "x", "y")).toBe("--- a/x\n+++ b/y\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  });
  it("unified doc lists removed lines before added ones", () => {
    const { text, rows } = buildUnifiedDoc("a\nb\n", "a\nc\n", blk("a\nb\n", "a\nc\n"), "none", []);
    expect(text).toBe("a\nb\nc\n");
    expect(rows.map((r) => r.mark)).toEqual(["", "−", "+", ""]);
    expect(rows[1]).toMatchObject({ old: 2, new: null, first: true, block: 0 });
  });
  it("patch uses file names", () => {
    expect(buildPatch("a\n", "b\n", "x.py", "y.py").split("\n").slice(0, 2)).toEqual(["--- a/x.py", "+++ b/y.py"]);
    expect(buildPatch("a\n", "a\n", "x", "y")).toBe("");
  });
});

describe("settings", () => {
  it("round-trip and reject garbage", () => {
    const s = new Map<string, string>();
    const st = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => s.set(k, v) } as Storage;
    saveSettings({ ...DEFAULT_SETTINGS, wrap: true }, st);
    expect(loadSettings(st).wrap).toBe(true);
    s.set(SETTINGS_KEY, '{"ignore":"bogus","contextLines":99}');
    expect(loadSettings(st)).toMatchObject({ ignore: "none", contextLines: 20 });
    s.set(SETTINGS_KEY, "not json");
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("unifiedTicks", () => {
  it("places each block by its share of the unified rows", () => {
    const blocks = blk("a\nb\nc", "a\nX\nc");
    const { rows } = buildUnifiedDoc("a\nb\nc", "a\nX\nc", blocks, "words", []);
    expect(unifiedTicks(rows)).toEqual([{ top: 25, height: 50, kind: "modified", index: 0 }]);
  });
  it("is empty without changes", () => {
    const { rows } = buildUnifiedDoc("a", "a", [], "words", []);
    expect(unifiedTicks(rows)).toEqual([]);
  });
});
