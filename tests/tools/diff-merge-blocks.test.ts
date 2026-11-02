import { describe, expect, it } from "vitest";
import { blockStats, computeBlocks, joinEol, splitEol } from "@/utils/diff-merge/blocks";

const none = { ignore: "none", ignoreCase: false } as const;

describe("diff-merge blocks", () => {
  it("classifies blocks", () => {
    const bl = computeBlocks("a\nb\nc\n", "a\nB\nc\nd\n", none);
    expect(bl.map((x) => x.kind)).toEqual(["modified", "added"]);
    expect(bl[0].linesA).toEqual({ from: 1, to: 2 });
    expect(bl[1].linesA).toEqual({ from: 3, to: 3 });
    expect(bl[1].linesB).toEqual({ from: 3, to: 4 });
    expect(blockStats(bl)).toEqual({ added: 1, removed: 0, modified: 1 });
  });

  it("identical texts give no blocks", () => expect(computeBlocks("x\n", "x\n", none)).toEqual([]));

  it("ignores whitespace-only changes", () => {
    expect(computeBlocks("  if x:\n", "if  x:\n", { ignore: "whitespace", ignoreCase: false })).toEqual([]);
    expect(computeBlocks("x  \n", "x\n", { ignore: "trim", ignoreCase: false })).toEqual([]);
    expect(computeBlocks("x\n  if y:\n", "x\n if y :\n", { ignore: "trim", ignoreCase: false })).toHaveLength(1);
  });

  it("ignores blank lines", () =>
    expect(computeBlocks("a\n\n\nb\n", "a\nb\n", { ignore: "whitespace-lines", ignoreCase: false })).toEqual([]));

  it("ignores case", () => expect(computeBlocks("Foo\n", "foo\n", { ignore: "none", ignoreCase: true })).toEqual([]));

  it("CRLF and LF compare equal after splitEol", () => {
    const a = splitEol("x\r\ny\r\n"), b = splitEol("x\ny\n");
    expect(a).toEqual({ text: "x\ny\n", eol: "CRLF" });
    expect(computeBlocks(a.text, b.text, none)).toEqual([]);
    expect(joinEol(a.text, "CRLF")).toBe("x\r\ny\r\n");
  });

  it("stays fast on huge input", () => {
    const big = Array.from({ length: 50_000 }, (_, i) => `line ${i * 7919 % 10007}`).join("\n");
    const t = performance.now();
    computeBlocks(big, big.replace(/7/g, "8"), none);
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it("stays fast on one 2 MB line", () => {
    const line = "a,b;".repeat(500_000);
    const t = performance.now();
    const bl = computeBlocks(line, line.replace(/b/g, "c"), none);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(bl).toHaveLength(1);
  });
});
