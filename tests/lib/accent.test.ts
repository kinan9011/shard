import { describe, expect, it } from "vitest";
import { ACCENTS, accentCss, getStoredAccent } from "@/utils/accent";
import { contrastRatio, parseColor } from "@/utils/theme-colors";

describe("accent", () => {
  it("writes nothing without an accent", () => {
    expect(accentCss(null)).toBe("");
  });

  it("outweighs the scheme blocks in both modes and sets the accent tokens", () => {
    const css = accentCss("teal");
    expect(css).toContain("html[data-scheme]:not(.dark){");
    expect(css).toContain("html[data-scheme].dark{");
    for (const token of ["--primary:", "--primary-foreground:", "--ring:", "--sidebar-primary:", "--sidebar-primary-foreground:", "--sidebar-ring:"]) expect(css).toContain(token);
    // Nothing a stylesheet could be hurt by.
    expect(css).not.toMatch(/url\(|;\s*}|@import/);
  });

  it("keeps text on every accent readable in both modes", () => {
    for (const accent of ACCENTS) {
      const css = accentCss(accent.id);
      for (const block of css.split("\n")) {
        const primary = /--primary:([^;]+);/.exec(block)![1]!;
        const foreground = /--primary-foreground:([^;]+);/.exec(block)![1]!;
        expect(contrastRatio(parseColor(primary)!, parseColor(foreground)!), `${accent.id} ${block.slice(0, 30)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("reads only a known accent from storage", () => {
    expect(getStoredAccent({ getItem: () => "pink" })).toBe("pink");
    expect(getStoredAccent({ getItem: () => "<script>" })).toBeNull();
    expect(getStoredAccent({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(getStoredAccent(undefined)).toBeNull();
  });
});
