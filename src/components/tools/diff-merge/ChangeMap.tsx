import type { MouseEvent } from "react";
import { useT } from "@/i18n";
import { mapTicks } from "@/utils/diff-merge/geometry";
import { KIND_VAR } from "./editor";
import type { DiffEditors } from "./useDiffEditors";
import { useGeometryTick } from "./useGeometryTick";

interface Props {
  /** Only the modified pane and the blocks are read, so the unified viewer can pass its own scroller. */
  editors: Pick<DiffEditors, "b" | "blocks">;
  current: number;
  onGoTo(index: number): void;
  /** Defaults to ticks derived from the modified pane's line count. */
  ticks?: ReturnType<typeof mapTicks>;
}

/** The 14px strip beside the panes: one tick per change and a thumb for B's viewport. */
export function ChangeMap({ editors, current, onGoTo, ticks: ownTicks }: Props) {
  const t = useT();
  const b = editors.b;
  useGeometryTick(b);
  const ticks = ownTicks ?? mapTicks(editors.blocks, b?.state.doc.lines ?? 1);
  const scroller = b?.scrollDOM;
  const thumb =
    scroller && scroller.scrollHeight > 0
      ? { top: (scroller.scrollTop / scroller.scrollHeight) * 100, height: Math.min(100, (scroller.clientHeight / scroller.scrollHeight) * 100) }
      : { top: 0, height: 0 };

  const scrollTo = (e: MouseEvent<HTMLDivElement>) => {
    if (!scroller) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.height) return;
    const frac = (e.clientY - rect.top) / rect.height;
    scroller.scrollTop = frac * scroller.scrollHeight - scroller.clientHeight / 2;
  };

  return (
    <div title={t("diffMerge.changeMap")} className="absolute inset-0" onClick={scrollTo}>
      <div
        className="absolute rounded-[3px]"
        style={{ left: 1, right: 1, top: `${thumb.top}%`, height: `${thumb.height}%`, background: "hsl(var(--foreground) / .07)" }}
      />
      {ticks.map((tick) => (
        <button
          key={tick.index}
          type="button"
          aria-label={t("diffMerge.goToChange", { n: tick.index + 1 })}
          className="absolute rounded-[1px] p-0"
          style={{
            left: 3,
            right: 3,
            top: `${tick.top}%`,
            height: `${tick.height}%`,
            minHeight: 3,
            background: `hsl(var(${KIND_VAR[tick.kind]}))`,
            boxShadow: tick.index === current ? "0 0 0 2px hsl(var(--ring))" : "none",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onGoTo(tick.index);
          }}
        />
      ))}
    </div>
  );
}
