import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastWarnings } from "@/utils/theme-contrast";

const css = readFileSync("src/index.css", "utf8");

/** The tokens of the first block of index.css that starts with `start`. */
function tokens(start: string): Record<string, string> {
  const from = css.indexOf(start);
  const body = css.slice(from, css.indexOf("\n  }", from));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

// --border is a divider, not a control edge, so it is the one pair left out.
const needed = (list: ReturnType<typeof contrastWarnings>) => list.filter((warning) => warning.foreground !== "--border");

describe("default theme", () => {
  it("finds both token blocks", () => {
    expect(tokens("  :root,")["--background"]).toBe("220 23% 97%");
    expect(tokens("  .dark,")["--background"]).toBe("216 5% 18%");
  });
  it("light keeps every text and control pair readable", () => expect(needed(contrastWarnings(tokens("  :root,")))).toEqual([]));
  it("dark keeps every text and control pair readable", () => expect(needed(contrastWarnings(tokens("  .dark,")))).toEqual([]));
});
