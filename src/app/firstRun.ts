import { parse } from "semver";

export const FIRST_RUN_STORAGE_KEY = "shard-first-run-done";
/** Set while the wizard is open, so quitting half way shows the wizard again. */
export const FIRST_RUN_STARTED_KEY = "shard-first-run-started";

/** The built-in tools, in the design's order (a test checks the list against the registry). */
export const CORE_NAMES = ["JSON Viewer", "Code Playground", "Regex Tester", "JSON to Code", "JSON Schema Validator", "JSON Diff", "Text Compare", "Diff & Merge", "JWT Decoder"];

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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

export type FirstRun = "wizard" | null;

/** What to show at start-up: the wizard (a new user, or one who did not finish it) or nothing. */
export function startFirstRun(storage: Store, version: string): FirstRun {
  if (!parse(version)) return null;
  if (read(storage, FIRST_RUN_STORAGE_KEY)) return null;
  write(storage, FIRST_RUN_STARTED_KEY, "true");
  return "wizard";
}

/** The wizard is done (finished or skipped to the end): it never shows again. */
export function finishFirstRun(storage: Store) {
  write(storage, FIRST_RUN_STORAGE_KEY, "true");
  write(storage, FIRST_RUN_STARTED_KEY, null);
}
