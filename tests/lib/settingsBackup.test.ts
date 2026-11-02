import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ installTheme: vi.fn(), listThemes: vi.fn(), saveFile: vi.fn(), saveTheme: vi.fn() }));
const api = vi.hoisted(() => ({ addRepo: vi.fn(), listPlugins: vi.fn(), listRepos: vi.fn(), repoSettings: vi.fn(), setRepoEnabled: vi.fn(), setRepoSettings: vi.fn(), syncRepos: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);
vi.mock("@/plugins/api", () => api);

import { exportBackup, restoreBackup } from "@/lib/settingsBackup";
import type { Backup } from "@/utils/settings-backup";

const REPO = "https://github.com/acme/tools";
const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
const backup = (over: Partial<Backup> = {}): Backup => ({ schema: 1, app: "shard", exportedAt: "2026-11-02T10:00:00.000Z", prefs: {}, repos: [], plugins: [], themes: [], ...over });

beforeEach(() => {
  localStorage.clear();
  Object.values(desktop).forEach((mock) => mock.mockReset());
  Object.values(api).forEach((mock) => mock.mockReset());
  desktop.saveFile.mockResolvedValue(true);
  desktop.listThemes.mockResolvedValue({ themes: [], errors: [] });
  desktop.saveTheme.mockResolvedValue({});
  desktop.installTheme.mockResolvedValue({});
  api.listRepos.mockResolvedValue([{ url: OFFICIAL, name: "Official", enabled: true, official: true }]);
  api.listPlugins.mockResolvedValue([]);
  api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
  api.addRepo.mockResolvedValue({});
  api.setRepoEnabled.mockResolvedValue({});
  api.setRepoSettings.mockResolvedValue({});
  api.syncRepos.mockResolvedValue([]);
});

describe("export", () => {
  it("writes a dated file with the settings and, on the desktop, what the app folder holds", async () => {
    localStorage.setItem("shard-layout", "launcher");
    localStorage.setItem("shard-first-run-done", "true");
    api.listRepos.mockResolvedValue([{ url: OFFICIAL, enabled: true, official: true }, { url: REPO, enabled: true }]);
    api.listPlugins.mockResolvedValue([{ id: "base64", version: "1.0.0", enabled: true, source: { kind: "repo", repo: OFFICIAL } }]);
    expect(await exportBackup(true)).toBe(true);
    const [blob, name] = desktop.saveFile.mock.calls[0]!;
    expect(name).toMatch(/^shard-settings-\d{4}-\d{2}-\d{2}\.json$/);
    const written = JSON.parse(await readBlob(blob));
    expect(written.prefs).toEqual({ "shard-layout": "launcher" });
    expect(written.repos).toEqual([{ url: REPO, enabled: true }]);
    expect(written.plugins).toEqual([{ id: "base64", repo: OFFICIAL, version: "1.0.0", enabled: true }]);
  });

  it("leaves the app folder out in the browser", async () => {
    await exportBackup(false);
    expect(api.listRepos).not.toHaveBeenCalled();
    expect(JSON.parse(await readBlob(desktop.saveFile.mock.calls[0]![0]))).toMatchObject({ repos: [], plugins: [], themes: [] });
  });
});

describe("restore", () => {
  it("writes the settings and says the app must reload", async () => {
    const done = await restoreBackup(backup({ prefs: { "shard-layout": "launcher", "shard-accent": "teal" } }), false);
    expect(localStorage.getItem("shard-accent")).toBe("teal");
    expect(done).toMatchObject({ lines: ["Restored 2 settings."], plugins: [], needsReload: true });
    expect(api.listRepos).not.toHaveBeenCalled();
  });

  it("adds missing repositories (off when they were off), syncs, and restores both kinds of theme", async () => {
    api.listRepos.mockResolvedValue([{ url: OFFICIAL }, { url: "https://github.com/acme/have" }]);
    const done = await restoreBackup(
      backup({
        repos: [{ url: REPO, enabled: false }, { url: "https://github.com/acme/have", enabled: true }],
        repoSettings: { checkOnStart: false, allowOutside: false },
        themes: [{ id: "mine", theme: { id: "mine", name: "Mine", version: "1.0.0", author: "" } }, { id: "nord", repo: REPO }],
      }),
      true,
    );
    expect(api.addRepo).toHaveBeenCalledTimes(1);
    expect(api.addRepo).toHaveBeenCalledWith(REPO);
    expect(api.setRepoEnabled).toHaveBeenCalledWith(REPO, false);
    expect(api.setRepoSettings).toHaveBeenCalledWith({ checkOnStart: false, allowOutside: false });
    expect(api.syncRepos).toHaveBeenCalled();
    expect(desktop.saveTheme).toHaveBeenCalledWith({ id: "mine", name: "Mine", version: "1.0.0", author: "" }, false);
    expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "nord");
    expect(done.lines).toEqual(expect.arrayContaining(["Added 1 repository.", "Restored 2 themes."]));
  });

  it("does not touch a theme that is already there, and reports a failure without stopping", async () => {
    desktop.listThemes.mockResolvedValue({ themes: [{ id: "mine" }], errors: [] });
    desktop.installTheme.mockRejectedValue(new Error("not listed"));
    api.addRepo.mockRejectedValue(new Error("Not a plugin repository"));
    const done = await restoreBackup(
      backup({ repos: [{ url: REPO, enabled: true }], themes: [{ id: "mine", theme: { id: "mine", name: "Mine", version: "1.0.0", author: "" } }, { id: "nord", repo: REPO }] }),
      true,
    );
    expect(desktop.saveTheme).not.toHaveBeenCalled();
    expect(done.lines).toEqual([`Repository ${REPO}: Not a plugin repository`, "Theme nord: not listed"]);
  });

  it("hands back the plugins that are not installed, to be approved", async () => {
    api.listPlugins.mockResolvedValue([{ id: "base64" }]);
    const plugins = [
      { id: "base64", repo: OFFICIAL, version: "1.0.0", enabled: true },
      { id: "checksum", repo: OFFICIAL, version: "1.0.0", enabled: false },
    ];
    const done = await restoreBackup(backup({ plugins }), true);
    expect(done.plugins).toEqual([plugins[1]]);
  });
});
