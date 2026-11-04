import { useCallback, useEffect, useState } from "react";
import { addFontFile, listFonts, loadCustomFonts, removeFont as deleteFont } from "@/lib/customFonts";
import { getDesktopBridge } from "@/lib/desktop";
import { FONT_STORAGE_KEY, fontCss, getStoredFonts, type FontPrefs } from "@/utils/fonts";

const STYLE_ID = "shard-fonts";

function persist(prefs: FontPrefs) {
  try {
    localStorage.setItem(FONT_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error("Failed to save the font settings:", error);
  }
}

export interface FontsApi {
  prefs: FontPrefs;
  /** Families of the fonts the user added as files. */
  custom: string[];
  setPrefs(patch: Partial<FontPrefs>): void;
  /** Adds a font file. Rejects with a message for the user. */
  addFont(file: File): Promise<string>;
  removeFont(family: string): Promise<void>;
}

/** The font, zoom and field-text choices: kept in storage, applied through a <style> in <head> and the webview zoom. */
export function useFonts(): FontsApi {
  const [prefs, setPrefsState] = useState<FontPrefs>(() => getStoredFonts(typeof window !== "undefined" ? window.localStorage : undefined));
  const [custom, setCustom] = useState<string[]>([]);

  useEffect(() => {
    loadCustomFonts().then(setCustom, (error) => console.error("Failed to load the added fonts:", error));
  }, []);

  useEffect(() => {
    const style = document.getElementById(STYLE_ID) ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    style.textContent = fontCss(prefs);
    document.head.appendChild(style);
  }, [prefs]);

  useEffect(() => {
    const root = document.documentElement;
    const cssZoom = () => {
      root.style.zoom = prefs.zoom === 1 ? "" : String(prefs.zoom);
    };
    const bridge = getDesktopBridge();
    if (!bridge?.setZoom) return cssZoom();
    root.style.zoom = "";
    void bridge.setZoom(prefs.zoom).then((done) => {
      if (!done) cssZoom();
    });
  }, [prefs.zoom]);

  const setPrefs = useCallback((patch: Partial<FontPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      persist(next);
      return next;
    });
  }, []);

  const addFont = useCallback(async (file: File) => {
    const family = await addFontFile(file);
    setCustom(await listFonts());
    return family;
  }, []);

  const removeFont = useCallback(
    async (family: string) => {
      await deleteFont(family);
      setCustom(await listFonts());
      // A choice that names a font that is gone falls back to the default.
      setPrefsState((current) => {
        if (current.ui !== family && current.field !== family) return current;
        const next = { ...current, ui: current.ui === family ? null : current.ui, field: current.field === family ? null : current.field };
        persist(next);
        return next;
      });
    },
    []
  );

  return { prefs, custom, setPrefs, addFont, removeFont };
}
