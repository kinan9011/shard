import { useMemo, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Ban, Check } from "lucide-react";
import { useT } from "@/i18n";
import { allowedActions, type FileRow, type MergeAction } from "@/utils/diff-merge/folder";
import { AnchoredPanel } from "../Panels";

export type MenuChoice = MergeAction | "hand";

interface Props {
  row: FileRow | null;
  anchor: HTMLElement | null;
  onPick(choice: MenuChoice): void;
  onClose(): void;
}

function Item({ icon, label, keys, checked, onClick }: { icon: ReactNode; label: string; keys?: string; checked?: boolean; onClick(): void }) {
  const t = useT();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-[10px] rounded-[5px] px-2 py-1.5 text-start hover:bg-accent focus:bg-accent focus:outline-none"
    >
      <span className="flex w-[14px] justify-center text-primary">{icon}</span>
      <span className="flex-1">{label}</span>
      {checked && <Check size={13} className="text-primary" aria-label={t("diffMerge.folder.menu.current")} />}
      {keys && <span className="text-muted-foreground">{keys}</span>}
    </button>
  );
}

const HEADING = { left: "diffMerge.folder.menu.onlyLeft", right: "diffMerge.folder.menu.onlyRight", diff: "diffMerge.folder.menu.differs", same: "diffMerge.folder.menu.differs" } as const;

/** Action menu under a row's action chip. Items the row does not allow are not rendered. */
export function ActionMenu({ row, anchor, onPick, onClose }: Props) {
  const t = useT();
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const allowed = row ? allowedActions(row.kind) : [];
  return (
    <AnchoredPanel open={!!row && !!anchor} onClose={onClose} anchorRef={anchorRef} width={264} align="start" role="menu">
      {row && (
        <div className="p-1">
          <div className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">{t(HEADING[row.kind], { name: row.name })}</div>
          {allowed.includes("toRight") && <Item icon={<ArrowRight size={14} aria-hidden="true" />} label={t("diffMerge.folder.copyLeftToRight")} keys="Ctrl+Shift+→" onClick={() => onPick("toRight")} />}
          {allowed.includes("toLeft") && <Item icon={<ArrowLeft size={14} aria-hidden="true" />} label={t("diffMerge.folder.copyRightToLeft")} keys="Ctrl+Shift+←" onClick={() => onPick("toLeft")} />}
          {allowed.includes("ignore") && (
            <Item icon={<span className="text-muted-foreground"><Ban size={14} aria-hidden="true" /></span>} label={t("diffMerge.folder.menu.ignore")} keys="Delete" onClick={() => onPick("ignore")} />
          )}
          <div className="-mx-1 my-1 h-px" style={{ background: "hsl(var(--border) / .8)" }} />
          <Item
            icon={<span aria-hidden="true" className="font-bold text-warning">≠</span>}
            label={t("diffMerge.folder.menu.decideLater")}
            checked={row.action === "none"}
            onClick={() => onPick("none")}
          />
          {row.left && row.right && <Item icon={null} label={t("diffMerge.folder.mergeByHand")} keys="Enter" onClick={() => onPick("hand")} />}
        </div>
      )}
    </AnchoredPanel>
  );
}
