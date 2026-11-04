import { useEffect, useState } from "react";
import { Pilcrow, PilcrowLeft, PilcrowRight } from "lucide-react";
import { useT } from "@/i18n";

type Mode = "auto" | "ltr" | "rtl";
const NEXT: Record<Mode, Mode> = { auto: "ltr", ltr: "rtl", rtl: "auto" };
const ICON = { auto: Pilcrow, ltr: PilcrowRight, rtl: PilcrowLeft };

/** Sets the direction of a field. The field itself keeps `dir="auto"` until this runs, so the app language never forces it. */
function setFieldDir(field: HTMLElement | null, mode: Mode): void {
  if (field) field.dir = mode;
}

/** Cycles a text field between auto, left to right and right to left. `target` is the id of the field. */
export function DirToggle({ target }: { target: string }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("auto");

  // The Ctrl+Shift shortcut (useFieldDirShortcut) changes the field without this button, so read it back.
  useEffect(() => {
    const read = () => {
      const dir = document.getElementById(target)?.dir;
      if (dir === "ltr" || dir === "rtl" || dir === "auto") setMode(dir);
    };
    document.addEventListener("shard-field-dir", read);
    return () => document.removeEventListener("shard-field-dir", read);
  }, [target]);

  const Icon = ICON[mode];
  const label = t("dir.toggle", { mode: t(`dir.${mode}`) });
  return (
    <button
      type="button"
      className="toolbar-text-button"
      aria-label={label}
      title={label}
      data-dir-mode={mode}
      onClick={() => {
        const next = NEXT[mode];
        setFieldDir(document.getElementById(target), next);
        setMode(next);
      }}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
