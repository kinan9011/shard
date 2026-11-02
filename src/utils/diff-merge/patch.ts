import { getUnifiedDiff } from "@/utils/text-compare";

/** Unified patch with `a/` and `b/` file names; "" when the texts are identical. */
export function buildPatch(a: string, b: string, nameA: string, nameB: string, context = 3): string {
  // A shared trailing newline would add a phantom empty context line to the last hunk.
  const bothEnd = a.endsWith("\n") && b.endsWith("\n");
  const lines = getUnifiedDiff(bothEnd ? a.slice(0, -1) : a, bothEnd ? b.slice(0, -1) : b, context);
  if (!lines.some((line) => line.startsWith("@@"))) return "";
  return [`--- a/${nameA}`, `+++ b/${nameB}`, ...lines.slice(2)].join("\n") + "\n";
}
