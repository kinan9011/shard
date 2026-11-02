import { contrastWarnings, describeWarning } from "@/utils/theme-contrast";
import { cssColor } from "@/utils/theme-colors";
import type { UserTheme } from "@/utils/theme";

const CHIPS = ["--background", "--foreground", "--primary", "--syntax-str", "--syntax-kw"] as const;

/** Five color chips of a theme in the mode in effect, and a "Low contrast" note when a pair is too faint. */
export function ThemeSwatches({ theme, dark }: { theme: UserTheme; dark: boolean }) {
  const tokens = dark ? theme.dark : theme.light;
  if (!tokens) return <span className="text-xs text-muted-foreground">{dark ? "Light only" : "Dark only"}</span>;
  const warnings = contrastWarnings(tokens);
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex" aria-hidden="true" data-testid={`swatches-${theme.id}`}>
        {CHIPS.map((token) => (tokens[token] ? <span key={token} className="size-3.5 border border-foreground/15 first:rounded-l-sm last:rounded-r-sm" style={{ background: cssColor(tokens[token]!) }} /> : null))}
      </span>
      {warnings.length > 0 && (
        <span className="rounded-sm bg-warning/15 px-1.5 text-2xs font-medium text-warning" title={warnings.map(describeWarning).join("\n")}>
          Low contrast
        </span>
      )}
    </span>
  );
}
