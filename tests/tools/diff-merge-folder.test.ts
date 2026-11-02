import { describe, expect, it } from "vitest";
import {
  allowedActions,
  classify,
  cycleAction,
  defaultAction,
  doneNotice,
  filterRows,
  formatDate,
  formatSize,
  groupRows,
  makeRow,
  mergeOps,
  mergeSubtitle,
  needsContentCheck,
  pairEntries,
  planCounts,
  plannedText,
  type FileRow,
  type RowKind,
} from "@/utils/diff-merge/folder";

const f = (path: string, size = 1, modifiedMs = 0) => ({ path, isDir: false, size, modifiedMs });
const row = (path: string, kind: RowKind = "diff"): FileRow =>
  makeRow({ path, left: kind === "right" ? null : f(path), right: kind === "left" ? null : f(path) }, kind, defaultAction(kind));

describe("folder model", () => {
  it("pairs and classifies", () => {
    const p = pairEntries([f("a"), f("b", 2)], [f("b", 3), f("c")]);
    expect(p.map((x) => x.path)).toEqual(["a", "b", "c"]);
    expect(classify(p[0], "content")).toBe("left");
    expect(classify(p[1], "content")).toBe("diff");
    expect(classify(p[2], "content")).toBe("right");
    expect(needsContentCheck({ left: f("x", 5), right: f("x", 5) }, "content")).toBe(true);
    expect(needsContentCheck({ left: f("x", 5), right: f("x", 6) }, "content")).toBe(false);
    expect(needsContentCheck({ left: f("x", 5), right: f("x", 5) }, "size")).toBe(false);
    expect(classify({ left: f("x", 5), right: f("x", 5) }, "content", true)).toBe("same");
    expect(classify({ left: f("x", 5), right: f("x", 5) }, "content", false)).toBe("diff");
    expect(classify({ left: f("x", 5), right: f("x", 5) }, "content")).toBe("diff");
    expect(classify({ left: f("x", 5, 1), right: f("x", 5, 2) }, "size-date")).toBe("diff");
    expect(classify({ left: f("x", 5, 1), right: f("x", 5, 1) }, "size-date")).toBe("same");
    expect(classify({ left: f("x", 5, 1), right: f("x", 5, 2) }, "size")).toBe("same");
  });

  it("pairs files only", () => {
    const dir = { path: "d", isDir: true, size: 0, modifiedMs: 0 };
    expect(pairEntries([dir, f("d/a")], [dir]).map((x) => x.path)).toEqual(["d/a"]);
  });

  it("default and allowed actions", () => {
    expect(defaultAction("left")).toBe("toRight");
    expect(defaultAction("right")).toBe("toLeft");
    expect(defaultAction("diff")).toBe("none");
    expect(defaultAction("same")).toBe("none");
    expect(allowedActions("left")).toEqual(["toRight", "ignore", "none"]);
    expect(allowedActions("right")).toEqual(["toLeft", "ignore", "none"]);
    expect(allowedActions("diff")).toEqual(["toRight", "toLeft", "ignore", "none"]);
  });

  it("cycles through the allowed actions and wraps", () => {
    const left = row("a", "left");
    expect(cycleAction(left)).toBe("ignore");
    expect(cycleAction({ ...left, action: "ignore" })).toBe("none");
    expect(cycleAction({ ...left, action: "none" })).toBe("toRight");
  });

  it("groups by parent dir with summaries", () => {
    const g = groupRows([row("go.mod"), row(".data/a.db"), row(".data/b.db")]);
    expect(g.map((x) => [x.dir, x.summary, x.rows[0].depth])).toEqual([["", "1 difference", 0], [".data/", "2 differences", 1]]);
    expect(g[1].rows[0].name).toBe("a.db");
  });

  it("sorts folders after the root", () => {
    const g = groupRows([row("z/a"), row("b/a"), row("top")]);
    expect(g.map((x) => x.dir)).toEqual(["", "b/", "z/"]);
  });

  it("filters by kind and case-insensitive path", () => {
    const rows = [row("API/x.go"), row("go.mod", "left"), row("b", "same")];
    expect(filterRows(rows, new Set<RowKind>(["diff", "left"]), "").map((r) => r.path)).toEqual(["API/x.go", "go.mod"]);
    expect(filterRows(rows, new Set<RowKind>(["diff", "left", "same"]), "api").map((r) => r.path)).toEqual(["API/x.go"]);
  });

  it("counts the plan and lists replacements", () => {
    const rows = [
      { ...row("a", "left"), action: "toRight" as const },
      { ...row("b", "diff"), action: "toRight" as const },
      { ...row("c", "diff"), action: "toLeft" as const },
      { ...row("d", "left"), action: "ignore" as const },
      row("e", "diff"),
    ];
    const c = planCounts(rows);
    expect([c.toRight, c.toLeft, c.ignored, c.noAction]).toEqual([2, 1, 1, 1]);
    expect(c.replaces.map((r) => r.path)).toEqual(["b", "c"]);
  });

  it("orders merge ops with toRight first", () => {
    const rows = [
      { ...row("api", "right"), action: "toLeft" as const },
      { ...row("only-left.db", "left"), action: "toRight" as const },
      row("go.mod"),
    ];
    expect(mergeOps(rows)).toEqual([
      { path: "only-left.db", action: "toRight" },
      { path: "api", action: "toLeft" },
    ]);
  });

  it("plan and status copy", () => {
    expect(plannedText({ toRight: 3, toLeft: 4, ignored: 2, noAction: 2, replaces: [] }))
      .toBe("Planned: 3 to the right · 4 to the left · 2 ignored · 2 without an action");
    expect(plannedText({ toRight: 0, toLeft: 0, ignored: 2, noAction: 2, replaces: [] })).toBe("2 ignored · 2 without an action");
    expect(plannedText({ toRight: 1, toLeft: 0, ignored: 0, noAction: 0, replaces: [] })).toBe("Planned: 1 to the right");
    expect(plannedText({ toRight: 0, toLeft: 0, ignored: 0, noAction: 0, replaces: [] })).toBe("");
    expect(mergeSubtitle(7, 1)).toBe("7 files will be written. 1 existing file will be replaced.");
    expect(mergeSubtitle(1, 0)).toBe("1 file will be written.");
    expect(mergeSubtitle(3, 2)).toBe("3 files will be written. 2 existing files will be replaced.");
    expect(formatSize(241644888)).toBe("241,644,888");
  });

  it("done notice", () => {
    const base = { copiedRight: ["a", "b", "go.sum"], copiedLeft: ["c", "d", "e", "f"], backedUp: ["go.sum"], journal: "", backupDir: "/x" };
    expect(doneNotice(base)).toBe("Merged 7 items: 3 copied to the right, 4 copied to the left. The replaced copy of go.sum was backed up first.");
    expect(doneNotice({ ...base, backedUp: ["a", "b"] })).toContain("2 replaced copies were backed up first.");
    expect(doneNotice({ ...base, backedUp: [], backupDir: null })).toBe("Merged 7 items: 3 copied to the right, 4 copied to the left.");
    expect(doneNotice({ ...base, copiedLeft: [], backedUp: [] })).toBe("Merged 3 items: 3 copied to the right.");
    expect(doneNotice({ ...base, copiedRight: ["a"], copiedLeft: [], backedUp: [] })).toBe("Merged 1 item: 1 copied to the right.");
  });

  it("done notice with nothing copied stays readable", () => {
    expect(doneNotice({ copiedRight: [], copiedLeft: [], backedUp: [], journal: "", backupDir: null })).toBe("Merged 0 items.");
  });

  it("groups a very large folder quickly", () => {
    const rows = Array.from({ length: 60000 }, (_, i) => row(`dir/f${i}`));
    const t = performance.now();
    expect(groupRows(rows)[0].rows).toHaveLength(60000);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("formats dates as dd.MM.yy HH:mm local time", () => {
    const d = new Date(2026, 9, 3, 9, 5).getTime();
    expect(formatDate(d)).toBe("03.10.26 09:05");
  });
});
