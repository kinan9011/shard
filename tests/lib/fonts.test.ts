import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_PREFS, FONT_STORAGE_KEY, fontCss, getStoredFonts, sanitizeFamily } from "@/utils/fonts";

const stored = (value: unknown) => getStoredFonts({ getItem: (key) => (key === FONT_STORAGE_KEY ? JSON.stringify(value) : null) });

describe("fonts", () => {
  it("emits nothing for the defaults", () => {
    expect(fontCss(DEFAULT_FONT_PREFS)).toBe("");
  });

  it("sets the UI font on :root in front of the default stack", () => {
    expect(fontCss({ ...DEFAULT_FONT_PREFS, ui: "Fira Sans" })).toBe(':root{--font-ui:"Fira Sans",var(--font-ui-stack)}');
  });

  it("keeps system-ui as a keyword", () => {
    expect(fontCss({ ...DEFAULT_FONT_PREFS, ui: "system-ui" })).toContain("--font-ui:system-ui,");
  });

  it("gives fields the font, size and a line height of size + 7", () => {
    const css = fontCss({ ...DEFAULT_FONT_PREFS, field: "Fira Code", fieldSize: 16 });
    expect(css).toContain("textarea");
    expect(css).toContain('font-family:"Fira Code",var(--font-code-stack) !important');
    expect(css).toContain("font-size:16px !important;line-height:23px !important");
  });

  it("refuses names that could break out of the stylesheet", () => {
    for (const bad of ['a"}body{display:none', "a;b", "a</style>", "", "x".repeat(65), 5, null]) expect(sanitizeFamily(bad), String(bad)).toBeNull();
    expect(sanitizeFamily("  Source Code Pro-2 ")).toBe("Source Code Pro-2");
  });

  it("falls back to the defaults for missing, broken or out-of-range storage", () => {
    expect(getStoredFonts(null)).toEqual(DEFAULT_FONT_PREFS);
    expect(getStoredFonts({ getItem: () => "{broken" })).toEqual(DEFAULT_FONT_PREFS);
    expect(stored({ ui: "A;B", zoom: 3, field: 7, fieldSize: 99 })).toEqual(DEFAULT_FONT_PREFS);
    expect(stored({ ui: "Fira Sans", zoom: 1.25, field: "Fira Code", fieldSize: 15 })).toEqual({ ui: "Fira Sans", zoom: 1.25, field: "Fira Code", fieldSize: 15 });
  });
});
