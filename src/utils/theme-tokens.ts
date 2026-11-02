/** The tokens a theme file may set, in the groups the editor shows them in. Keep in step with `TOKENS` in src-tauri/src/themes.rs. */
export const TOKEN_GROUPS: readonly { title: string; tokens: readonly string[] }[] = [
  { title: "Page", tokens: ["--background", "--foreground", "--muted", "--muted-foreground", "--border", "--input", "--ring"] },
  { title: "Cards and menus", tokens: ["--card", "--card-foreground", "--popover", "--popover-foreground", "--secondary", "--secondary-foreground", "--accent", "--accent-foreground"] },
  { title: "Main color", tokens: ["--primary", "--primary-foreground"] },
  { title: "Status", tokens: ["--destructive", "--destructive-foreground", "--success", "--success-foreground", "--warning", "--warning-foreground", "--info", "--info-foreground"] },
  {
    title: "Sidebar",
    tokens: ["--sidebar-background", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring", "--chrome-input-border", "--chrome-muted-foreground"],
  },
  { title: "Editor", tokens: ["--surface-chrome", "--surface-editor", "--surface-raised", "--surface-sidebar", "--syntax-fn", "--syntax-kw", "--syntax-lit", "--syntax-num", "--syntax-str"] },
];

export const ALL_TOKENS: readonly string[] = TOKEN_GROUPS.flatMap((group) => group.tokens);

/** A name as a theme id: `Tokyo Night!` is `tokyo-night`. At most 40 characters of a-z, 0-9 and -. */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

/** What a token shows when nothing set it: mid gray, in the form the token is written in. */
export const FALLBACK = (token: string): string => (token.startsWith("--surface-") || token.startsWith("--syntax-") ? "#808080" : "0 0% 50%");
