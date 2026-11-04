import { t } from "@/i18n";
import { contrastRatio, parseColor } from "./theme-colors";

const TEXT = 4.5;
const UI = 3;

/** Pairs a theme should keep readable: [foreground, background, minimum ratio]. docs/themes.md asks for the same numbers. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["--foreground", "--background", TEXT],
  ["--muted-foreground", "--background", TEXT],
  ["--card-foreground", "--card", TEXT],
  ["--popover-foreground", "--popover", TEXT],
  ["--primary-foreground", "--primary", TEXT],
  ["--secondary-foreground", "--secondary", TEXT],
  ["--accent-foreground", "--accent", TEXT],
  ["--destructive-foreground", "--destructive", TEXT],
  ["--success-foreground", "--success", TEXT],
  ["--warning-foreground", "--warning", TEXT],
  ["--info-foreground", "--info", TEXT],
  ["--sidebar-foreground", "--sidebar-background", TEXT],
  ["--sidebar-primary-foreground", "--sidebar-primary", TEXT],
  ["--sidebar-accent-foreground", "--sidebar-accent", TEXT],
  ["--syntax-fn", "--surface-editor", TEXT],
  ["--syntax-kw", "--surface-editor", TEXT],
  ["--syntax-lit", "--surface-editor", TEXT],
  ["--syntax-num", "--surface-editor", TEXT],
  ["--syntax-str", "--surface-editor", TEXT],
  ["--border", "--background", UI],
  ["--input", "--background", UI],
  ["--ring", "--background", UI],
];

export interface ContrastWarning {
  foreground: string;
  background: string;
  ratio: number;
  needed: number;
}

/**
 * The pairs of one mode's tokens that are too faint. A pair is only checked when the theme sets both of its tokens: a token
 * it leaves out keeps the default theme's color, which this block cannot know.
 */
export function contrastWarnings(tokens: Readonly<Record<string, string>> | undefined): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const [foreground, background, needed] of PAIRS) {
    const fg = parseColor(tokens?.[foreground] ?? "");
    const bg = parseColor(tokens?.[background] ?? "");
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < needed) out.push({ foreground, background, ratio, needed });
  }
  return out;
}

export const describeWarning = (w: ContrastWarning): string =>
  t("settings.contrast.warning", { foreground: w.foreground, background: w.background, ratio: w.ratio.toFixed(1), needed: w.needed });
