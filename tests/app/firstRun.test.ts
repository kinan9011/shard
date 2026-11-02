import { afterEach, describe, expect, it } from "vitest";
import { FIRST_RUN_STARTED_KEY, FIRST_RUN_STORAGE_KEY, PLUGINS_INTRO_STORAGE_KEY, dismissPluginsIntro, finishFirstRun, hadStoredState, startFirstRun } from "@/app/firstRun";

afterEach(() => localStorage.clear());

describe("hadStoredState", () => {
  it("is true only when a shard-* key exists", () => {
    expect(hadStoredState(localStorage)).toBe(false);
    localStorage.setItem("other", "1");
    expect(hadStoredState(localStorage)).toBe(false);
    localStorage.setItem("shard-recent-tools", "[]");
    expect(hadStoredState(localStorage)).toBe(true);
    expect(hadStoredState(undefined)).toBe(false);
  });
});

describe("startFirstRun", () => {
  it("shows the wizard to a new user and remembers that it started", () => {
    expect(startFirstRun(localStorage, "3.0.0", false)).toBe("wizard");
    expect(localStorage.getItem(FIRST_RUN_STARTED_KEY)).toBe("true");
    // Quit half way: still the wizard, never the banner.
    expect(startFirstRun(localStorage, "3.0.0", true)).toBe("wizard");
    expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBeNull();
  });

  it("shows an upgrading user the banner once, not the wizard", () => {
    expect(startFirstRun(localStorage, "3.0.0", true)).toBe("intro");
    expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBe("true");
    expect(startFirstRun(localStorage, "3.0.0", true)).toBe("intro");
    dismissPluginsIntro(localStorage);
    expect(startFirstRun(localStorage, "3.0.0", true)).toBeNull();
  });

  it("shows nothing after the wizard is finished", () => {
    startFirstRun(localStorage, "3.0.0", false);
    finishFirstRun(localStorage);
    expect(localStorage.getItem(FIRST_RUN_STARTED_KEY)).toBeNull();
    expect(localStorage.getItem(PLUGINS_INTRO_STORAGE_KEY)).toBe("true");
    expect(startFirstRun(localStorage, "3.0.0", true)).toBeNull();
  });

  it("only applies from 3.0.0, pre-releases included", () => {
    expect(startFirstRun(localStorage, "2.8.0", false)).toBeNull();
    expect(startFirstRun(localStorage, "", false)).toBeNull();
    expect(startFirstRun(localStorage, "not a version", false)).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(startFirstRun(localStorage, "3.0.0-beta.1", false)).toBe("wizard");
  });
});
