import { afterEach, describe, expect, it } from "vitest";
import { FIRST_RUN_STARTED_KEY, FIRST_RUN_STORAGE_KEY, finishFirstRun, startFirstRun } from "@/app/firstRun";

afterEach(() => localStorage.clear());

describe("startFirstRun", () => {
  it("shows the wizard to a new user and remembers that it started", () => {
    expect(startFirstRun(localStorage, "1.0.0")).toBe("wizard");
    expect(localStorage.getItem(FIRST_RUN_STARTED_KEY)).toBe("true");
    // Quit half way: still the wizard.
    expect(startFirstRun(localStorage, "1.0.0")).toBe("wizard");
    expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBeNull();
  });

  it("shows nothing after the wizard is finished", () => {
    startFirstRun(localStorage, "1.0.0");
    finishFirstRun(localStorage);
    expect(localStorage.getItem(FIRST_RUN_STARTED_KEY)).toBeNull();
    expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBe("true");
    expect(startFirstRun(localStorage, "1.0.0")).toBeNull();
  });

  it("needs a valid version, pre-releases included", () => {
    expect(startFirstRun(localStorage, "")).toBeNull();
    expect(startFirstRun(localStorage, "not a version")).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(startFirstRun(localStorage, "1.0.0-beta.1")).toBe("wizard");
  });
});
