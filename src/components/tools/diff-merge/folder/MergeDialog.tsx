import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Ban, X } from "lucide-react";
import { mergeSubtitle, planCounts, type FileRow } from "@/utils/diff-merge/folder";

const FOCUSABLE = "button:not([disabled]), input:not([disabled])";
/** Longest list of names in the "Not changed" sentences. */
const MAX_NAMES = 8;

function Group({ icon, title, count, muted, children }: { icon: ReactNode; title: string; count: number; muted?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex items-center gap-2 font-medium ${muted ? "text-muted-foreground" : ""}`}>
        <span className={`flex ${muted ? "" : "text-primary"}`}>{icon}</span>
        {title}
        <span className="font-normal text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Paths({ rows, note }: { rows: FileRow[]; note?: (row: FileRow) => string | null }) {
  return (
    <div className="flex flex-col gap-0.5 pl-[22px] font-mono text-muted-foreground">
      {rows.map((row) => {
        const text = note?.(row);
        return (
          <span key={row.path} className="truncate" title={row.path}>
            {row.path}{" "}
            {text && <span className="font-sans text-warning">{text}</span>}
          </span>
        );
      })}
    </div>
  );
}

function Names({ rows }: { rows: FileRow[] }) {
  const shown = rows.slice(0, MAX_NAMES);
  return (
    <>
      {shown.map((row, i) => (
        <span key={row.path}>
          {i > 0 && ", "}
          <span className="font-mono">{row.path}</span>
        </span>
      ))}
      {rows.length > shown.length && ` and ${rows.length - shown.length} more`}
    </>
  );
}

interface Props {
  /** The rows the merge would act on: visible, identical ones left out. */
  rows: FileRow[];
  open: boolean;
  onCancel(): void;
  onConfirm(backup: boolean): void;
}

function Body({ rows, onCancel, onConfirm }: Omit<Props, "open">) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [backup, setBackup] = useState(true);
  const c = planCounts(rows);
  const right = rows.filter((r) => r.action === "toRight");
  const left = rows.filter((r) => r.action === "toLeft");
  const ignored = rows.filter((r) => r.action === "ignore");
  const none = rows.filter((r) => r.action === "none");

  // Focus goes to Cancel, so a stray Enter cannot start a merge, and returns to where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Tab") {
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="absolute inset-0 z-20 grid place-items-center" style={{ background: "rgb(10 14 22 / .38)" }} onKeyDown={onKeyDown}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90%] w-[540px] max-w-[96%] flex-col overflow-hidden rounded-xl border bg-card"
        style={{ borderColor: "hsl(var(--foreground) / .14)", boxShadow: "0 24px 80px rgb(0 0 0 / .3), 0 2px 8px rgb(0 0 0 / .12)" }}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-[18px]">
          <div className="flex flex-col gap-1">
            <span id={titleId} className="text-[15px] font-semibold">Start merge</span>
            <span className="text-xs text-muted-foreground">{mergeSubtitle(c.toRight + c.toLeft, c.replaces.length)}</span>
          </div>
          <button type="button" aria-label="Close" className="flex rounded-[5px] p-1 text-muted-foreground hover:bg-muted" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-[14px] overflow-y-auto px-5 pb-4 pt-1 text-xs">
          {right.length > 0 && (
            <Group icon={<ArrowRight size={14} aria-hidden="true" />} title="Copy to the right" count={right.length}>
              <Paths rows={right} note={(r) => (r.kind === "diff" ? "replaces the right copy" : null)} />
            </Group>
          )}
          {left.length > 0 && (
            <Group icon={<ArrowLeft size={14} aria-hidden="true" />} title="Copy to the left" count={left.length}>
              <Paths rows={left} note={(r) => (r.kind === "diff" ? "replaces the left copy" : null)} />
            </Group>
          )}
          {ignored.length + none.length > 0 && (
            <Group icon={<Ban size={14} aria-hidden="true" />} title="Not changed" count={ignored.length + none.length} muted>
              <div className="pl-[22px] text-muted-foreground">
                {ignored.length > 0 && (
                  <>
                    <Names rows={ignored} />
                    {ignored.length === 1 ? " is" : " are"} ignored.{" "}
                  </>
                )}
                {none.length > 0 && (
                  <>
                    <Names rows={none} />
                    {none.length === 1 ? " has" : " have"} no action yet.
                  </>
                )}
              </div>
            </Group>
          )}
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} className="h-4 w-4 accent-primary" />
            Back up files before replacing them
          </label>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "hsl(var(--border) / .7)", background: "hsl(var(--muted) / .35)" }}>
          <button type="button" data-cancel onClick={onCancel} className="flex h-8 items-center whitespace-nowrap rounded-md border border-input bg-card px-3 text-[13px] font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(backup)} className="flex h-8 items-center whitespace-nowrap rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground">
            Start merge
          </button>
        </div>
      </div>
    </div>
  );
}

/** Summary shown over the folder card before anything is written. */
export function MergeDialog({ open, ...rest }: Props) {
  return open ? <Body {...rest} /> : null;
}
