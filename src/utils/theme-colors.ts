/** Colors of a theme file. Most tokens are an HSL triplet (`213 77% 48%`), the `--surface-*` and `--syntax-*` ones are hex (`#1e1e1e`). */
export type RGB = readonly [number, number, number];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TRIPLET = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/;

export function hslToRgb(h: number, s: number, l: number): RGB {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** The color of a token value in either of the two forms, or null when it is neither. */
export function parseColor(value: string): RGB | null {
  const hex = HEX.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as unknown as RGB;
  }
  const triplet = TRIPLET.exec(value);
  return triplet ? hslToRgb(Number(triplet[1]), Number(triplet[2]), Number(triplet[3])) : null;
}

export const rgbToHex = (rgb: RGB): string => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function rgbToTriplet([r, g, b]: RGB): string {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** A value of a token as CSS, for a swatch: the triplets are wrapped in `hsl()`. */
export const cssColor = (value: string): string => (value.startsWith("#") ? value : `hsl(${value})`);

/** Tokens written as hex: the rest are triplets. Same rule as `valid_value` in src-tauri/src/themes.rs. */
export const isHexToken = (token: string): boolean => token.startsWith("--surface-") || token.startsWith("--syntax-");

/** A color picker value (`#rrggbb`) as the form the token is written in. */
export const fromPicker = (token: string, hex: string): string => {
  const rgb = parseColor(hex);
  return !rgb ? hex : isHexToken(token) ? rgbToHex(rgb) : rgbToTriplet(rgb);
};

/** A token value as a color picker value (`#rrggbb`). */
export const toPicker = (value: string): string => {
  const rgb = parseColor(value);
  return rgb ? rgbToHex(rgb) : "#000000";
};

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
