import { useCallback, useEffect, useState } from "react";
import { ACCENT_STORAGE_KEY, accentCss, getStoredAccent, type AccentId } from "@/utils/accent";

const STYLE_ID = "shard-accent";

/** The accent color the user picked (or null for the theme's own), kept in storage and in a <style> of <head>. */
export function useAccent(): [AccentId | null, (next: AccentId | null) => void] {
  const [accent, setAccentState] = useState<AccentId | null>(() => getStoredAccent(typeof window !== "undefined" ? window.localStorage : undefined));

  useEffect(() => {
    const style = document.getElementById(STYLE_ID) ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    style.textContent = accentCss(accent);
    document.head.appendChild(style);
  }, [accent]);

  const setAccent = useCallback((next: AccentId | null) => {
    setAccentState(next);
    try {
      if (next) localStorage.setItem(ACCENT_STORAGE_KEY, next);
      else localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch (error) {
      console.error("Failed to save accent color:", error);
    }
  }, []);
  return [accent, setAccent];
}
