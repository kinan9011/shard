import { parse } from "semver";

export const FIRST_RUN_STORAGE_KEY = "shard-first-run-done";
/** Set while the wizard is open, so quitting half way shows the wizard again and not the upgrade banner. */
export const FIRST_RUN_STARTED_KEY = "shard-first-run-started";
export const PLUGINS_INTRO_STORAGE_KEY = "shard-plugins-intro-seen";

/** The built-in tools, in the design's order (a test checks the list against the registry). */
export const CORE_NAMES = ["JSON Viewer", "Code Playground", "Regex Tester", "JSON to Code", "JSON Schema Validator", "JSON Diff", "Text Compare", "Diff & Merge", "JWT Decoder"];

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;

const read = (storage: Store, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};
const write = (storage: Store, key: string, value: string | null) => {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be blocked: the wizard then shows again on the next start, which is harmless.
  }
};

/** Whether the app has saved anything before: an upgrade, not a first install. Read before the app writes its own keys. */
export function hadStoredState(storage: Store | undefined): boolean {
  if (!storage) return false;
  try {
    for (let index = 0; index < storage.length; index++) if (storage.key(index)?.startsWith("shard-")) return true;
  } catch {
    // Treated as a fresh install.
  }
  return false;
}

export type FirstRun = "wizard" | "intro" | null;

/**
 * What to show at start-up: the wizard (a new user, or one who did not finish it), the one-time "Plugins are here"
 * banner (a user upgrading from 2.x), or nothing. Only for 3.0.0 and later.
 */
export function startFirstRun(storage: Store, version: string, existingUser: boolean): FirstRun {
  const parsed = parse(version);
  if (!parsed || parsed.major < 3) return null;
  if (read(storage, FIRST_RUN_STORAGE_KEY)) return read(storage, PLUGINS_INTRO_STORAGE_KEY) ? null : "intro";
  if (read(storage, FIRST_RUN_STARTED_KEY)) return "wizard";
  if (existingUser) {
    write(storage, FIRST_RUN_STORAGE_KEY, "true");
    return "intro";
  }
  write(storage, FIRST_RUN_STARTED_KEY, "true");
  return "wizard";
}

/** The wizard is done (finished or skipped to the end): it never shows again, and neither does the banner. */
export function finishFirstRun(storage: Store) {
  write(storage, FIRST_RUN_STORAGE_KEY, "true");
  write(storage, PLUGINS_INTRO_STORAGE_KEY, "true");
  write(storage, FIRST_RUN_STARTED_KEY, null);
}

export function dismissPluginsIntro(storage: Store) {
  write(storage, PLUGINS_INTRO_STORAGE_KEY, "true");
}
