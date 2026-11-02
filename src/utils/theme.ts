export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
export const THEME_STORAGE_KEY = "shard-theme-preference";

export type ThemePreference = "system" | "light" | "dark";

type MatchMediaFn = (query: string) => Pick<MediaQueryList, "matches">;

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export const getSystemDarkMode = (matchMedia?: MatchMediaFn | null): boolean => {
  if (typeof matchMedia !== "function") {
    return false;
  }

  return matchMedia(SYSTEM_THEME_QUERY).matches;
};

export const getStoredThemePreference = (
  storage?: Pick<Storage, "getItem"> | null,
): ThemePreference => {
  if (!storage) {
    return "system";
  }

  try {
    const storedPreference = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : "system";
  } catch {
    return "system";
  }
};

export const resolveDarkMode = (
  preference: ThemePreference,
  systemDarkMode: boolean,
): boolean => {
  if (preference === "system") {
    return systemDarkMode;
  }

  return preference === "dark";
};

export const syncDarkClass = (
  root: Pick<HTMLElement, "classList"> | null | undefined,
  enabled: boolean,
): void => {
  root?.classList.toggle("dark", enabled);
};

export const SCHEME_STORAGE_KEY = "shard-color-scheme";

export interface ColorScheme {
  id: string;
  name: string;
  /** Modes it has colors for (see src/themes.css). In another mode the default theme shows. */
  modes: readonly ("light" | "dark")[];
}

/** Style schemes in the spirit of GNOME Text Editor's. The colors are in src/themes.css. */
export const COLOR_SCHEMES: readonly ColorScheme[] = [
  { id: "default", name: "Default", modes: ["light", "dark"] },
  { id: "adwaita", name: "Adwaita", modes: ["light", "dark"] },
  { id: "solarized", name: "Solarized", modes: ["light", "dark"] },
  { id: "classic", name: "Classic", modes: ["light"] },
  { id: "kate", name: "Kate", modes: ["light"] },
  { id: "tango", name: "Tango", modes: ["light"] },
  { id: "cobalt", name: "Cobalt", modes: ["dark"] },
  { id: "oblivion", name: "Oblivion", modes: ["dark"] },
];

export const getStoredColorScheme = (storage?: Pick<Storage, "getItem"> | null): string => {
  try {
    const stored = storage?.getItem(SCHEME_STORAGE_KEY);
    return COLOR_SCHEMES.some((scheme) => scheme.id === stored) ? stored! : "adwaita";
  } catch {
    return "adwaita";
  }
};

export const syncColorScheme = (root: Pick<HTMLElement, "setAttribute"> | null | undefined, id: string): void => {
  root?.setAttribute("data-scheme", id);
};

/** How the sidebar treats its categories: keep what was opened, or open or close them all. */
export const SIDEBAR_CATEGORIES_STORAGE_KEY = "shard-sidebar-categories";
export type SidebarCategoryMode = "remember" | "open" | "closed";
export const SIDEBAR_CATEGORY_MODES: readonly SidebarCategoryMode[] = ["remember", "open", "closed"];

/** Whether a tool opens in a new tab or replaces the selected one. */
export const OPEN_TOOLS_IN_STORAGE_KEY = "shard-open-tools-in";
export type OpenToolsIn = "new" | "current";
export const OPEN_TOOLS_IN_MODES: readonly OpenToolsIn[] = ["new", "current"];

/** How the shell moves between tools: a sidebar, or a top bar with a launcher Home. */
export const LAYOUT_STORAGE_KEY = "shard-layout";
export type Layout = "sidebar" | "launcher";
export const LAYOUTS: readonly Layout[] = ["sidebar", "launcher"];

/** The stored value if it is one of `allowed`, else `fallback`. Unreadable storage gives the fallback. */
export function getStoredChoice<T extends string>(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const stored = storage?.getItem(key);
    return allowed.find((value) => value === stored) ?? fallback;
  } catch {
    return fallback;
  }
}
