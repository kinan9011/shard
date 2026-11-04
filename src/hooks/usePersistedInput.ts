import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** "false" turns remembering off. Anything else, including nothing, leaves it on. */
export const REMEMBER_INPUTS_KEY = "shard-remember-inputs";
const INPUT_PREFIX = "shard-input:";
/** The tab ids of the last session. Written by the shell, forgotten together with the inputs. */
export const OPEN_TABS_STORAGE_KEY = "shard-open-tabs";
// ponytail: a flat cap, no quota handling. A bigger paste is simply not remembered.
export const MAX_REMEMBERED_INPUT = 200_000;

export function rememberInputsEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_INPUTS_KEY) !== "false";
  } catch {
    return false;
  }
}

/** Forgets every remembered input and the saved tabs. Used when the setting is turned off. */
export function clearRememberedInputs(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(INPUT_PREFIX)) keys.push(key);
    }
    keys.push(OPEN_TABS_STORAGE_KEY);
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: there is nothing to forget.
  }
}

/**
 * `useState` for a tool's main text field that survives a restart.
 * Only give it fields that are safe to keep on disk: never a secret, password or private key.
 */
export function usePersistedInput(name: string, initial = ""): [string, Dispatch<SetStateAction<string>>] {
  const storageKey = INPUT_PREFIX + name;
  const [value, setValue] = useState(() => {
    if (!rememberInputsEnabled()) return initial;
    try {
      return localStorage.getItem(storageKey) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (!rememberInputsEnabled()) return;
    try {
      if (value && value !== initial && value.length <= MAX_REMEMBERED_INPUT) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // Storage blocked or full: the input just isn't remembered.
    }
    // `initial` is a default, not an input: a changing default must not rewrite storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, value]);
  return [value, setValue];
}
