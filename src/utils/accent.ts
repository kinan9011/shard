import { contrastRatio, hslToRgb } from "./theme-colors";

export const ACCENT_STORAGE_KEY = "shard-accent";

/** Accent colors: a hue and saturation. The lightness is chosen per mode so the accent reads on that mode's background. */
export const ACCENTS = [
  { id: "blue", name: "Blue", hue: 213, saturation: 77 },
  { id: "teal", name: "Teal", hue: 174, saturation: 70 },
  { id: "green", name: "Green", hue: 142, saturation: 60 },
  { id: "orange", name: "Orange", hue: 24, saturation: 90 },
  { id: "pink", name: "Pink", hue: 330, saturation: 75 },
  { id: "purple", name: "Purple", hue: 270, saturation: 65 },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const getStoredAccent = (storage?: Pick<Storage, "getItem"> | null): AccentId | null => {
  try {
    const stored = storage?.getItem(ACCENT_STORAGE_KEY);
    return ACCENTS.find((accent) => accent.id === stored)?.id ?? null;
  } catch {
    return null;
  }
};

/** The tokens one accent sets in one mode. */
function tokens(hue: number, saturation: number, dark: boolean): string {
  const lightness = dark ? 62 : 42;
  const rgb = hslToRgb(hue, saturation, lightness);
  // Text on the accent: white when it holds 4.5:1, else near black.
  const foreground = contrastRatio(rgb, [255, 255, 255]) >= 4.5 ? "0 0% 100%" : "0 0% 6%";
  const color = `${hue} ${saturation}% ${lightness}%`;
  return `--primary:${color};--primary-foreground:${foreground};--ring:${color};--sidebar-primary:${color};--sidebar-primary-foreground:${foreground};--sidebar-ring:${color}`;
}

/**
 * The stylesheet of an accent. `html[data-scheme]` outweighs the `[data-scheme="x"]` blocks of every scheme, built in or a
 * user's, so the accent wins in all of them. No accent, no stylesheet.
 */
export function accentCss(id: AccentId | null): string {
  const accent = ACCENTS.find((item) => item.id === id);
  if (!accent) return "";
  return `html[data-scheme]:not(.dark){${tokens(accent.hue, accent.saturation, false)}}\nhtml[data-scheme].dark{${tokens(accent.hue, accent.saturation, true)}}`;
}
