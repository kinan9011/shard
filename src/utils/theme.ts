import { t, type TKey } from "@/i18n";

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

/** Names of the built-in schemes that are words, so they translate. The others (Adwaita, Kate...) are proper names. */
const SCHEME_NAME_KEYS: Readonly<Record<string, TKey>> = { default: "settings.scheme.default", classic: "settings.scheme.classic" };

/** The name to show for a scheme: translated for the built-in ones, as written for a theme of the user's. */
export const schemeName = (scheme: Pick<ColorScheme, "id" | "name" | "user">): string => {
  const key = scheme.user ? undefined : SCHEME_NAME_KEYS[scheme.id];
  return key ? t(key) : scheme.name;
};

export interface ColorScheme {
  id: string;
  name: string;
  /** Modes it has colors for (see src/themes.css). In another mode the default theme shows. */
  modes: readonly ("light" | "dark")[];
  /** Made by the user (a file in the themes folder) rather than built in. */
  user?: boolean;
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

const SCHEME_ID = /^[a-z0-9-]{1,40}$/;

/** The stored scheme id if it is well formed. A user theme is not known yet at startup: see `resolveColorScheme`. */
export const getStoredColorScheme = (storage?: Pick<Storage, "getItem"> | null): string => {
  try {
    const stored = storage?.getItem(SCHEME_STORAGE_KEY);
    return stored && SCHEME_ID.test(stored) ? stored : "adwaita";
  } catch {
    return "adwaita";
  }
};

/** The scheme to show: `id` while the user themes are still loading or when it exists, else Adwaita (a removed theme). */
export const resolveColorScheme = (id: string, schemes: readonly ColorScheme[], themesLoaded: boolean): string =>
  !themesLoaded || schemes.some((scheme) => scheme.id === id) ? id : "adwaita";

export const syncColorScheme = (root: Pick<HTMLElement, "setAttribute"> | null | undefined, id: string): void => {
  root?.setAttribute("data-scheme", id);
};

/** A theme file as `theme_list` returns it. Rust has checked it; `themeCss` still only lets safe text through. */
export interface UserTheme {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  /** The repository it was installed from. Absent for a theme the user made or imported. */
  repo?: string;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

const SAFE_TOKEN = /^--[a-z-]{1,40}$/;
const SAFE_VALUE = /^[#0-9a-fA-F .%]{1,16}$/;

/** The stylesheet of the user themes: one block per mode, in the form of src/themes.css. Text that is not a token or a color is dropped. */
export function themeCss(themes: readonly UserTheme[]): string {
  const block = (selector: string, tokens: Record<string, string> | undefined) => {
    const declarations = Object.entries(tokens ?? {})
      .filter(([token, value]) => SAFE_TOKEN.test(token) && SAFE_VALUE.test(value))
      .map(([token, value]) => `${token}:${value}`)
      .join(";");
    return declarations ? `${selector}{${declarations}}` : "";
  };
  return themes
    .filter((theme) => SCHEME_ID.test(theme.id))
    .map((theme) => block(`[data-scheme="${theme.id}"]:not(.dark)`, theme.light) + block(`[data-scheme="${theme.id}"].dark`, theme.dark))
    .join("\n");
}

export const userThemeSchemes = (themes: readonly UserTheme[]): ColorScheme[] =>
  themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    modes: [...(theme.light ? (["light"] as const) : []), ...(theme.dark ? (["dark"] as const) : [])],
    user: true,
  }));

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
