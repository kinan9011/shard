import { useSyncExternalStore } from "react";
import en from "./en";

export type Dict = Record<string, string>;
export type Dir = "ltr" | "rtl";

export const LOCALES = [
  { id: "en", name: "English", dir: "ltr", tag: "en" },
  { id: "de", name: "Deutsch", dir: "ltr", tag: "de" },
  { id: "ar", name: "العربية", dir: "rtl", tag: "ar" },
  { id: "fr", name: "Français", dir: "ltr", tag: "fr" },
  { id: "es", name: "Español", dir: "ltr", tag: "es" },
  { id: "zh", name: "简体中文", dir: "ltr", tag: "zh-CN" },
  { id: "ja", name: "日本語", dir: "ltr", tag: "ja" },
  { id: "he", name: "עברית", dir: "rtl", tag: "he" },
] as const;

export type LocaleId = (typeof LOCALES)[number]["id"];
/** What the user picked: a language, or "system" to follow the OS. */
export type LanguagePref = LocaleId | "system";

export const LANGUAGE_STORAGE_KEY = "shard-language";

/** A key of the English dictionary. A plural family (`files_one`, `files_other`) is addressed by its base (`files`). */
type PluralBase<K> = K extends `${infer B}_${"zero" | "one" | "two" | "few" | "many" | "other"}` ? B : K;
export type TKey = PluralBase<keyof typeof en>;
export type TVars = Record<string, string | number>;

const loaders: Record<Exclude<LocaleId, "en">, () => Promise<{ default: Dict }>> = {
  de: () => import("./locales/de"),
  ar: () => import("./locales/ar"),
  fr: () => import("./locales/fr"),
  es: () => import("./locales/es"),
  zh: () => import("./locales/zh"),
  ja: () => import("./locales/ja"),
  he: () => import("./locales/he"),
};

const dictionaries: Partial<Record<LocaleId, Dict>> = { en };
const info = (id: LocaleId) => LOCALES.find((l) => l.id === id) ?? LOCALES[0];

function readPref(): LanguagePref {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (value && (value === "system" || LOCALES.some((l) => l.id === value))) return value as LanguagePref;
  } catch {
    // No storage: follow the system.
  }
  return "system";
}

/** The supported language that best matches the system's list, or English. */
export function resolveSystemLocale(languages: readonly string[] | undefined = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []): LocaleId {
  for (const language of languages) {
    const primary = language?.toLowerCase().split("-")[0];
    const match = LOCALES.find((l) => l.id === primary || (primary === "iw" && l.id === "he"));
    if (match) return match.id;
  }
  return "en";
}

export const resolveLocale = (pref: LanguagePref): LocaleId => (pref === "system" ? resolveSystemLocale() : pref);

let pref: LanguagePref = readPref();
let current: LocaleId = "en";
const listeners = new Set<() => void>();
const applied = new Set<(locale: LocaleId, dir: Dir) => void>();

function applyDocument(id: LocaleId) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = info(id).tag;
  document.documentElement.dir = info(id).dir;
}

async function load(id: LocaleId): Promise<void> {
  if (dictionaries[id]) return;
  try {
    dictionaries[id] = (await loaders[id as Exclude<LocaleId, "en">]()).default;
  } catch (error) {
    // The chunk is part of the app, so this is a broken build. Stay on English.
    console.error(`Failed to load the ${id} translations:`, error);
    dictionaries[id] = {};
  }
}

function commit(id: LocaleId) {
  current = id;
  applyDocument(id);
  for (const listener of listeners) listener();
  for (const callback of applied) callback(id, info(id).dir);
}

/** The newest language request. A load that finishes after a newer request must not override it. */
let latest = 0;

/** Resolves when the saved language is loaded and applied. Direction is set at once, so the layout does not flip later. */
export const ready: Promise<void> = (() => {
  const id = resolveLocale(pref);
  applyDocument(id);
  if (id === "en") return Promise.resolve();
  const ticket = ++latest;
  return load(id).then(() => {
    if (ticket === latest) commit(id);
  });
})();

export function getLanguagePref(): LanguagePref {
  return pref;
}

export function getLocale(): LocaleId {
  return current;
}

export const getDir = (): Dir => info(current).dir;

/** Saves and applies the language. Resolves once its translations are loaded. */
export async function setLanguage(next: LanguagePref): Promise<void> {
  pref = next;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    // Not saved, still applied for this session.
  }
  const id = resolveLocale(next);
  const ticket = ++latest;
  applyDocument(id);
  await load(id);
  if (ticket === latest) commit(id);
}

/** Calls back after each language change, and once now. For the tray and the plugin frames, which are not React. */
export function onLocaleApplied(callback: (locale: LocaleId, dir: Dir) => void): () => void {
  applied.add(callback);
  callback(current, info(current).dir);
  return () => applied.delete(callback);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const pluralRules = new Map<string, Intl.PluralRules>();

function find(dict: Dict | undefined, tag: string, key: string, count: number | undefined): string | undefined {
  if (!dict) return undefined;
  if (count !== undefined) {
    let rules = pluralRules.get(tag);
    if (!rules) pluralRules.set(tag, (rules = new Intl.PluralRules(tag)));
    const category = rules.select(count);
    return dict[`${key}_${category}`] ?? dict[`${key}_other`] ?? dict[key];
  }
  return dict[key];
}

/** Translates `key`, with `{name}` placeholders filled from `vars`. `vars.count` picks the plural form. Falls back to English, then to the key. */
export function t(key: TKey, vars?: TVars): string {
  const count = typeof vars?.count === "number" ? vars.count : undefined;
  const text = find(dictionaries[current], info(current).tag, key, count) ?? find(en, "en", key, count) ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

/** `t`, and a re-render of the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

/** The current language and direction, re-rendering on change. */
export function useLocale(): { locale: LocaleId; dir: Dir; pref: LanguagePref } {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, dir: info(locale).dir, pref };
}

// A dev tool shows Latin digits in every language, so numbers read the same as in the code beside them.
const numberTag = () => `${info(current).tag}-u-nu-latn`;
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(numberTag(), options).format(value);
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(numberTag(), options).format(value);

/** Test hook: drop the saved choice and return to English. */
export function resetLanguageForTests(): void {
  pref = "system";
  commit("en");
}
