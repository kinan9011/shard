import { useEffect } from "react";

/**
 * Ctrl+Left Shift sets the focused text field to left to right, Ctrl+Right Shift to right to left (the Windows
 * and Office convention). So a user of an Arabic or Hebrew app can write English in any field, and back.
 * It acts when the keys are released with nothing pressed in between, so Ctrl+Shift+Z or Ctrl+Shift+Arrow
 * still do their own job. Code editors opt out with `data-dir-lock`.
 */
export function useFieldDirShortcut(): void {
  useEffect(() => {
    let armed: "ltr" | "rtl" | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = event.code === "ShiftLeft" ? "ltr" : event.code === "ShiftRight" ? "rtl" : null;
      if (dir && event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!event.repeat) armed = dir;
      } else if (event.code !== "ControlLeft" && event.code !== "ControlRight") {
        armed = null;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = armed;
      if (!dir || !(event.key === "Shift" || event.key === "Control")) return;
      armed = null;
      const field = document.activeElement;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field.hasAttribute("data-dir-lock") || field.readOnly) return;
      field.dir = dir;
      document.dispatchEvent(new Event("shard-field-dir"));
    };
    const disarm = () => {
      armed = null;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", disarm);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", disarm);
    };
  }, []);
}
