import type { FolderEntry, FolderMergeReport } from "@/lib/desktop";
import { t } from "@/i18n";

export type RowKind = "left" | "right" | "diff" | "same";
export type MergeAction = "toRight" | "toLeft" | "ignore" | "none";
export type CompareBy = "content" | "size-date" | "size";

export interface FileRow {
  path: string;
  /** Last path segment. */
  name: string;
  /** Parent folder with a trailing slash, or "" at the root. */
  dir: string;
  depth: 0 | 1;
  kind: RowKind;
  left: FolderEntry | null;
  right: FolderEntry | null;
  action: MergeAction;
}

export interface FolderGroup {
  dir: string;
  summary: string;
  rows: FileRow[];
}

type Pair = { path: string; left: FolderEntry | null; right: FolderEntry | null };

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Files present on either side, one entry per path, sorted by path. Folders are not listed. */
export function pairEntries(left: FolderEntry[], right: FolderEntry[]): Pair[] {
  const map = new Map<string, Pair>();
  for (const e of left) if (!e.isDir) map.set(e.path, { path: e.path, left: e, right: null });
  for (const e of right) {
    if (e.isDir) continue;
    const p = map.get(e.path);
    if (p) p.right = e;
    else map.set(e.path, { path: e.path, left: null, right: e });
  }
  return [...map.values()].sort((a, b) => byPath(a.path, b.path));
}

export function needsContentCheck(p: Pick<Pair, "left" | "right">, by: CompareBy): boolean {
  return !!p.left && !!p.right && by === "content" && p.left.size === p.right.size;
}

/** An unknown content result counts as different, never as identical. */
export function classify(p: Pick<Pair, "left" | "right">, by: CompareBy, equalContent?: boolean): RowKind {
  const { left, right } = p;
  if (!left) return "right";
  if (!right) return "left";
  if (left.size !== right.size) return "diff";
  if (by === "size") return "same";
  if (by === "size-date") return left.modifiedMs === right.modifiedMs ? "same" : "diff";
  return equalContent === true ? "same" : "diff";
}

export function defaultAction(kind: RowKind): MergeAction {
  return kind === "left" ? "toRight" : kind === "right" ? "toLeft" : "none";
}

export function allowedActions(kind: RowKind): MergeAction[] {
  if (kind === "left") return ["toRight", "ignore", "none"];
  if (kind === "right") return ["toLeft", "ignore", "none"];
  if (kind === "diff") return ["toRight", "toLeft", "ignore", "none"];
  return ["none"];
}

export function cycleAction(row: FileRow): MergeAction {
  const list = allowedActions(row.kind);
  return list[(list.indexOf(row.action) + 1) % list.length];
}

export function makeRow(p: Pair, kind: RowKind, action: MergeAction): FileRow {
  const cut = p.path.lastIndexOf("/") + 1;
  return { path: p.path, name: p.path.slice(cut), dir: p.path.slice(0, cut), depth: cut ? 1 : 0, kind, left: p.left, right: p.right, action };
}

/** Root rows first, then one group per parent folder, sorted by folder path. */
export function groupRows(rows: FileRow[]): FolderGroup[] {
  const map = new Map<string, FileRow[]>();
  for (const r of rows) {
    const list = map.get(r.dir);
    if (list) list.push(r);
    else map.set(r.dir, [r]);
  }
  return [...map.keys()].sort(byPath).map((dir) => {
    const list = map.get(dir)!;
    return { dir, summary: t("diffMerge.folder.differences", { count: list.length }), rows: list };
  });
}

export function filterRows(rows: FileRow[], show: ReadonlySet<RowKind>, query: string): FileRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => show.has(r.kind) && (!q || r.path.toLowerCase().includes(q)));
}

/** What a merge over these rows would do. `replaces` are the rows whose destination already exists. */
export function planCounts(rows: FileRow[]) {
  const c = { toRight: 0, toLeft: 0, ignored: 0, noAction: 0, replaces: [] as FileRow[] };
  for (const r of rows) {
    if (r.action === "toRight") c.toRight++;
    else if (r.action === "toLeft") c.toLeft++;
    else if (r.action === "ignore") c.ignored++;
    else c.noAction++;
    if ((r.action === "toRight" || r.action === "toLeft") && r.kind === "diff") c.replaces.push(r);
  }
  return c;
}

export function plannedText(c: ReturnType<typeof planCounts>): string {
  const moves = [c.toRight && t("diffMerge.folder.plan.right", { count: c.toRight }), c.toLeft && t("diffMerge.folder.plan.left", { count: c.toLeft })].filter(Boolean);
  const rest = [c.ignored && t("diffMerge.folder.plan.ignored", { count: c.ignored }), c.noAction && t("diffMerge.folder.plan.noAction", { count: c.noAction })].filter(Boolean);
  const text = [...moves, ...rest].join(" · ");
  return moves.length ? t("diffMerge.folder.plan.planned", { parts: text }) : text;
}

/** Operations for the backend: copies to the right first, then copies to the left. */
export function mergeOps(rows: FileRow[]): { path: string; action: "toRight" | "toLeft" }[] {
  const of = (action: "toRight" | "toLeft") => rows.filter((r) => r.action === action).map((r) => ({ path: r.path, action }));
  return [...of("toRight"), ...of("toLeft")];
}

export function mergeSubtitle(writes: number, replaces: number): string {
  const first = t("diffMerge.folder.subtitle.written", { count: writes });
  return replaces ? `${first} ${t("diffMerge.folder.subtitle.replaced", { count: replaces })}` : first;
}

export function doneNotice(r: FolderMergeReport): string {
  const right = r.copiedRight.length;
  const left = r.copiedLeft.length;
  const parts = [right && t("diffMerge.folder.done.right", { count: right }), left && t("diffMerge.folder.done.left", { count: left })].filter(Boolean);
  let text = parts.length ? t("diffMerge.folder.done.merged", { count: right + left, parts: parts.join(", ") }) : t("diffMerge.folder.done.none");
  if (r.backedUp.length === 1) text += ` ${t("diffMerge.folder.done.backedUpOne", { name: r.backedUp[0] })}`;
  else if (r.backedUp.length > 1) text += ` ${t("diffMerge.folder.done.backedUpMany", { count: r.backedUp.length })}`;
  return text;
}

export function formatSize(n: number): string {
  return n.toLocaleString("en-US");
}

/** dd.MM.yy HH:mm in local time. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${two(d.getFullYear() % 100)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
