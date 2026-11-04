import { useEffect } from "react";

/**
 * Ctrl+Left Shift sets the focused text field to left to right, Ctrl+Right Shift to right to left (the Windows
 * and Office convention). So a user of an Arabic or Hebrew app can write English in any field, and back.
 * Code editors opt out with `data-dir-lock`.
 */
export function useFieldDirShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
      const dir = event.code === "ShiftLeft" ? "ltr" : event.code === "ShiftRight" ? "rtl" : null;
      const field = document.activeElement;
      if (!dir || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field.hasAttribute("data-dir-lock") || field.readOnly) return;
      field.dir = dir;
      document.dispatchEvent(new Event("shard-field-dir"));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
