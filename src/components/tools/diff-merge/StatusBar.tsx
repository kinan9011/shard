import { useSyncExternalStore } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n";
import type { Eol } from "@/utils/diff-merge/blocks";
import type { CursorStore } from "./useDiffEditors";

interface Props {
  empty: boolean;
  /** Null before the editors exist. */
  cursor: CursorStore | null;
  language: string;
  stats: { added: number; removed: number; modified: number };
  message: string | null;
  /** EOL of the focused pane. */
  eol: Eol;
}

/** The 32px footer. */
const NO_CURSOR = { line: 1, col: 1 };
const noop = () => () => undefined;

export function StatusBar({ empty, cursor, language, stats, message, eol }: Props) {
  const t = useT();
  const { line, col } = useSyncExternalStore(cursor ? cursor.subscribe : noop, cursor ? cursor.get : () => NO_CURSOR);
  return (
    <footer className="flex h-8 flex-shrink-0 items-center gap-4 border-t border-border px-4 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
      {empty ? (
        <span>{t("diffMerge.statusBar.ready")}</span>
      ) : (
        <>
          <span>{t("diffMerge.statusBar.position", { line, col })}</span>
          <span>{language}</span>
          <span className="flex gap-1">
            <span style={{ color: "hsl(var(--success))" }}>{t("diffMerge.statusBar.added", { count: stats.added })}</span>·
            <span style={{ color: "hsl(var(--destructive))" }}>{t("diffMerge.statusBar.removed", { count: stats.removed })}</span>·
            <span style={{ color: "hsl(var(--warning))" }}>{t("diffMerge.statusBar.modified", { count: stats.modified })}</span>
          </span>
        </>
      )}
      {message && (
        <span className="flex items-center gap-1.5 text-foreground">
          <Check size={13} strokeWidth={2.4} className="text-primary" aria-hidden="true" />
          {message}
        </span>
      )}
      <span className="ms-auto">{`UTF-8 · ${eol}`}</span>
      <span className="flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden="true" />
        {t("toolWorkspace.localProcessing")}
      </span>
    </footer>
  );
}
