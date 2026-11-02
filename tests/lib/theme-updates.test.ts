import { describe, expect, it } from "vitest";
import { isNewerVersion, themeUpdates } from "@/utils/theme-updates";

const REPO = "https://github.com/acme/themes";
const listed = (id: string, version: string, repo = REPO) => ({ id, version, repo });

describe("theme updates", () => {
  it("compares semver, not strings", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    // A repository that lists an older version is not an update.
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
    // Not semver: any difference counts.
    expect(isNewerVersion("b", "a")).toBe(true);
    expect(isNewerVersion("a", "a")).toBe(false);
  });

  it("lists only newer themes that came from the same repository", () => {
    const installed = [
      { id: "nord", version: "1.0.0", repo: REPO },
      { id: "dracula", version: "1.0.0" },
      { id: "gruvbox", version: "1.0.0", repo: "https://github.com/other/themes" },
      { id: "tokyo", version: "2.0.0", repo: REPO },
    ];
    const entries = [listed("nord", "1.1.0"), listed("dracula", "2.0.0"), listed("gruvbox", "2.0.0"), listed("tokyo", "1.0.0"), listed("new", "1.0.0")];
    expect(themeUpdates(installed, entries).map((entry) => entry.id)).toEqual(["nord"]);
  });
});
