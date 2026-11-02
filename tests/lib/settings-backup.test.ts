import { describe, expect, it } from "vitest";
import { buildBackup, collectPrefs, isPrefKey, parseBackup } from "@/utils/settings-backup";

const fakeStorage = (entries: Record<string, string>) => {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (key: string) => entries[key] ?? null };
};
const REPO = "https://github.com/acme/tools";
const file = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, app: "shard", exportedAt: "2026-11-02T10:00:00.000Z", prefs: {}, repos: [], plugins: [], themes: [], ...over });

describe("which keys are settings", () => {
  it("takes preferences, per-tool layouts, and nothing that belongs to one install", () => {
    for (const key of ["shard-pinned", "shard-accent", "shard-layout", "shard-jwt-decoder-layout", "shard-diff-merge-settings"]) expect(isPrefKey(key), key).toBe(true);
    for (const key of ["shard-first-run-done", "shard-first-run-started", "shard-whats-new-seen-version", "shard-user-themes", "other", "shard-", "__proto__"]) expect(isPrefKey(key), key).toBe(false);
  });

  it("collects only those from storage", () => {
    const prefs = collectPrefs(fakeStorage({ "shard-pinned": "[]", "shard-first-run-done": "true", "shard-layout": "launcher", unrelated: "x" }));
    expect(prefs).toEqual({ "shard-pinned": "[]", "shard-layout": "launcher" });
  });
});

describe("building a backup", () => {
  it("lists the user's repositories, repository plugins, and both kinds of theme", () => {
    const backup = buildBackup(
      {
        storage: fakeStorage({ "shard-layout": "sidebar" }),
        repos: [{ url: "https://github.com/kinan9011/shard-plugins", enabled: true, official: true }, { url: REPO, enabled: false }],
        repoSettings: { checkOnStart: true, allowOutside: false },
        plugins: [
          { id: "base64", version: "1.0.0", enabled: true, source: { kind: "repo", repo: REPO } },
          { id: "from-zip", version: "1.0.0", enabled: true, source: { kind: "zip" } },
        ],
        themes: [
          { id: "nord", name: "Nord", version: "1.0.0", author: "", repo: REPO, dark: {} },
          { id: "mine", name: "Mine", version: "1.0.0", author: "Me", dark: { "--background": "0 0% 0%" } },
        ],
      },
      new Date("2026-11-02T10:00:00Z"),
    );
    expect(backup.repos).toEqual([{ url: REPO, enabled: false }]);
    expect(backup.plugins).toEqual([{ id: "base64", repo: REPO, version: "1.0.0", enabled: true }]);
    expect(backup.themes[0]).toEqual({ id: "nord", repo: REPO });
    expect(backup.themes[1]).toMatchObject({ id: "mine", theme: { author: "Me" } });
    expect(backup.exportedAt).toBe("2026-11-02T10:00:00.000Z");
  });

  it("is read back as it was written", () => {
    const backup = buildBackup({ storage: fakeStorage({ "shard-pinned": '["json-viewer"]' }), repos: [{ url: REPO, enabled: true }], plugins: [], themes: [] });
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed).toMatchObject({ ok: true, skipped: [] });
    expect(parsed.ok && parsed.backup).toEqual(backup);
  });
});

describe("reading a backup", () => {
  it("refuses what is not a Shard backup", () => {
    expect(parseBackup("nope")).toEqual({ ok: false, error: "The file is not JSON." });
    expect(parseBackup("[]")).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ schema: 1, app: "other" }))).toMatchObject({ ok: false, error: "This is not a Shard backup." });
    expect(parseBackup(file({ schema: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining("schema 2") });
    expect(parseBackup("x".repeat(3 * 1024 * 1024))).toMatchObject({ ok: false, error: expect.stringContaining("2 MB") });
  });

  it("ignores keys that are not settings, and values that cannot be", () => {
    const parsed = parseBackup(file({ prefs: { "shard-layout": "launcher", "shard-first-run-done": "true", "shard-pinned": "[not json", "shard-accent": 5, __proto__: "x" } }));
    expect(parsed.ok && parsed.backup.prefs).toEqual({ "shard-layout": "launcher" });
    expect(parsed.ok && parsed.skipped).toEqual(expect.arrayContaining(["shard-first-run-done: not a setting", "shard-pinned: not a usable value", "shard-accent: not a usable value"]));
  });

  it("keeps the repositories, plugins and themes it can place, and names the rest", () => {
    const parsed = parseBackup(
      file({
        repos: [{ url: REPO }, { url: "http://evil.test/x" }, "junk"],
        plugins: [{ id: "base64", repo: REPO, version: "1.0.0" }, { id: "../x", repo: REPO }, { id: "no-repo" }],
        themes: [{ id: "nord", repo: REPO }, { id: "mine", theme: { id: "mine", name: "Mine" } }, { id: "mismatch", theme: { id: "other" } }, { id: "Bad Id" }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.repos).toEqual([{ url: REPO, enabled: true }]);
    expect(parsed.backup.plugins).toEqual([{ id: "base64", repo: REPO, version: "1.0.0", enabled: true }]);
    expect(parsed.backup.themes.map((theme) => theme.id)).toEqual(["nord", "mine"]);
    expect(parsed.skipped).toHaveLength(6);
  });
});
