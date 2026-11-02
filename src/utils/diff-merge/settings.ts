import type { IgnoreMode } from "./blocks";
import type { HighlightMode } from "./inline";

export interface DiffSettings {
  viewer: "side" | "unified";
  ignore: IgnoreMode;
  highlight: HighlightMode;
  collapse: boolean;
  syncScroll: boolean;
  contextLines: number;
  wrap: boolean;
  showWhitespace: boolean;
  ignoreCase: boolean;
  detectLanguage: boolean;
}

export const DEFAULT_SETTINGS: DiffSettings = {
  viewer: "side",
  ignore: "none",
  highlight: "words",
  collapse: false,
  syncScroll: true,
  contextLines: 3,
  wrap: false,
  showWhitespace: false,
  ignoreCase: false,
  detectLanguage: true,
};

export const SETTINGS_KEY = "shard-diff-merge-settings";
/** Fired on `window` after `saveSettings`, so every mounted view can reload. */
export const SETTINGS_EVENT = "shard-diff-merge-settings-saved";

const ENUMS = {
  viewer: ["side", "unified"],
  ignore: ["none", "trim", "whitespace", "whitespace-lines"],
  highlight: ["words", "lines", "chars", "none"],
} as const;
const BOOLEANS = ["collapse", "syncScroll", "wrap", "showWhitespace", "ignoreCase", "detectLanguage"] as const;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Merges stored values over the defaults, dropping anything invalid. */
export function loadSettings(storage: Storage | undefined = defaultStorage()): DiffSettings {
  const out: DiffSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return out;
    const p = parsed as Record<string, unknown>;
    for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
      if ((ENUMS[key] as readonly unknown[]).includes(p[key])) (out as unknown as Record<string, unknown>)[key] = p[key];
    }
    for (const key of BOOLEANS) if (typeof p[key] === "boolean") out[key] = p[key];
    if (typeof p.contextLines === "number" && Number.isFinite(p.contextLines)) {
      out.contextLines = Math.min(20, Math.max(0, Math.round(p.contextLines)));
    }
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return out;
}

export function saveSettings(settings: DiffSettings, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* The choice still applies for this session. */
  }
  // Text mode and the file view inside Folder mode are mounted together and share these settings.
  globalThis.dispatchEvent?.(new Event(SETTINGS_EVENT));
}
