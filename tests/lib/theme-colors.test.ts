import { describe, expect, it } from "vitest";
import { contrastRatio, cssColor, fromPicker, parseColor, rgbToHex, rgbToTriplet, toPicker } from "@/utils/theme-colors";
import { contrastWarnings, describeWarning } from "@/utils/theme-contrast";

describe("theme colors", () => {
  it("reads both forms", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#1e1e1e")).toEqual([30, 30, 30]);
    expect(parseColor("0 0% 100%")).toEqual([255, 255, 255]);
    expect(parseColor("0 100% 50%")).toEqual([255, 0, 0]);
    expect(parseColor("red")).toBeNull();
    expect(parseColor("1 2")).toBeNull();
  });

  it("converts between a picker's hex and the form a token is written in", () => {
    expect(rgbToHex([255, 0, 128])).toBe("#ff0080");
    expect(rgbToTriplet([255, 0, 0])).toBe("0 100% 50%");
    expect(rgbToTriplet([128, 128, 128])).toBe("0 0% 50%");
    expect(fromPicker("--primary", "#ff0000")).toBe("0 100% 50%");
    expect(fromPicker("--surface-editor", "#FF0000")).toBe("#ff0000");
    expect(toPicker("0 100% 50%")).toBe("#ff0000");
    expect(toPicker("nonsense")).toBe("#000000");
    expect(cssColor("#fff")).toBe("#fff");
    expect(cssColor("1 2% 3%")).toBe("hsl(1 2% 3%)");
  });

  it("measures contrast like WCAG", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // #777 on white is the textbook just-below-4.5 pair.
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });
});

describe("contrast warnings", () => {
  it("flags faint pairs and says how faint", () => {
    const warnings = contrastWarnings({ "--background": "0 0% 100%", "--foreground": "0 0% 60%", "--border": "0 0% 10%" });
    expect(warnings.map((w) => w.foreground)).toEqual(["--foreground"]);
    expect(describeWarning(warnings[0]!)).toMatch(/^--foreground on --background is 2\.\d:1, it needs 4\.5:1$/);
  });

  it("checks syntax colors against the editor and skips pairs it cannot see", () => {
    expect(contrastWarnings({ "--surface-editor": "#ffffff", "--syntax-str": "#eeeeee" }).map((w) => w.foreground)).toEqual(["--syntax-str"]);
    // Only one side is set: the other keeps the default theme's color, so nothing can be said.
    expect(contrastWarnings({ "--foreground": "0 0% 60%" })).toEqual([]);
    expect(contrastWarnings(undefined)).toEqual([]);
  });

  it("accepts a readable theme", () => {
    expect(contrastWarnings({ "--background": "0 0% 100%", "--foreground": "0 0% 10%", "--border": "0 0% 40%", "--primary": "213 77% 40%", "--primary-foreground": "0 0% 100%" })).toEqual([]);
  });
});
