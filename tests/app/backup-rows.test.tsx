import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lib = vi.hoisted(() => ({ exportBackup: vi.fn(), restoreBackup: vi.fn() }));
const api = vi.hoisted(() => ({
  listPlugins: vi.fn(), listRepos: vi.fn(), repoCatalog: vi.fn(), pluginUpdates: vi.fn(), installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(), setPluginEnabled: vi.fn(), onInstallProgress: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/settingsBackup", () => lib);
vi.mock("@/plugins/api", () => api);
vi.mock("sonner", () => ({ toast: toastMock }));

import { BackupRows } from "@/components/app/settings/BackupRows";
import { resetPlugins } from "@/plugins/usePlugins";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const file = (text: string) => new File([text], "backup.json", { type: "application/json" });
const backupText = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, app: "shard", exportedAt: "", prefs: { "shard-layout": "launcher" }, repos: [], plugins: [], themes: [], ...over });
const upload = (text: string) => fireEvent.change(screen.getByLabelText("Settings file"), { target: { files: [file(text)] } });
// jsdom's File has no .text() in every version; give it one.
beforeEach(() => {
  Object.defineProperty(File.prototype, "text", { configurable: true, value: function () { return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(this as Blob); }); } });
  resetPlugins();
  Object.values(lib).forEach((mock) => mock.mockReset());
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([{ url: OFFICIAL, name: "Shard Official", enabled: true, official: true }]);
  api.pluginUpdates.mockResolvedValue([]);
  api.onInstallProgress.mockResolvedValue(() => {});
  api.setPluginEnabled.mockResolvedValue({});
  lib.exportBackup.mockResolvedValue(true);
});

describe("Backup rows", () => {
  it("exports and says so", async () => {
    render(<BackupRows native />);
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Settings exported"));
    expect(lib.exportBackup).toHaveBeenCalledWith(true);
  });

  it("refuses a file that is not a backup", async () => {
    render(<BackupRows native />);
    upload("not json");
    expect(await screen.findByText("The file is not JSON.")).toBeInTheDocument();
    expect(lib.restoreBackup).not.toHaveBeenCalled();
  });

  it("restores a backup, lists what was skipped, and offers a reload", async () => {
    lib.restoreBackup.mockResolvedValue({ lines: ["Restored 1 setting."], plugins: [], needsReload: true });
    render(<BackupRows native={false} />);
    upload(backupText({ prefs: { "shard-layout": "launcher", "shard-first-run-done": "true" } }));
    expect(await screen.findByText("Restored 1 setting.")).toBeInTheDocument();
    expect(screen.getByText("Skipped shard-first-run-done: not a setting.")).toBeInTheDocument();
    expect(lib.restoreBackup.mock.calls[0]![0].prefs).toEqual({ "shard-layout": "launcher" });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    fireEvent.click(screen.getByRole("button", { name: "Reload to apply" }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("installs the plugins of a backup behind one approval, and leaves a disabled one disabled", async () => {
    const entry = (id: string, permissions: unknown[]) => ({ id, name: id, version: "1.0.0", description: "", category: "Development", runtime: "web", url: "https://example.test/p.zip", sha256: "0".repeat(64), repo: OFFICIAL, repoName: "Shard Official", permissions });
    api.repoCatalog.mockResolvedValue([entry("base64", [{ name: "clipboard:write", reason: "Copy" }]), entry("checksum", [])]);
    api.installFromRepo.mockResolvedValue({});
    api.setPluginGrants.mockResolvedValue({});
    const wanted = [{ id: "base64", repo: OFFICIAL, version: "1.0.0", enabled: true }, { id: "checksum", repo: OFFICIAL, version: "1.0.0", enabled: false }, { id: "gone", repo: OFFICIAL, version: "1.0.0", enabled: true }];
    lib.restoreBackup.mockResolvedValue({ lines: [], plugins: wanted, needsReload: false });
    render(<BackupRows native />);
    upload(backupText({ plugins: wanted }));

    // base64 asks for a permission: one dialog, nothing installed before it is approved.
    const dialog = await screen.findByRole("dialog");
    expect(api.installFromRepo).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.setPluginEnabled).toHaveBeenCalledWith("checksum", false));
    expect(await screen.findByText("Installed 2 of 2 plugins.")).toBeInTheDocument();
    expect(screen.getByText("gone is not listed any more, so it was not installed.")).toBeInTheDocument();
  });

  it("installs nothing when the approval is cancelled", async () => {
    const entry = { id: "base64", name: "base64", version: "1.0.0", description: "", category: "Development", runtime: "web", url: "https://example.test/p.zip", sha256: "0".repeat(64), repo: OFFICIAL, repoName: "Shard Official", permissions: [{ name: "clipboard:write", reason: "Copy" }] };
    api.repoCatalog.mockResolvedValue([entry]);
    const wanted = [{ id: "base64", repo: OFFICIAL, version: "1.0.0", enabled: true }];
    lib.restoreBackup.mockResolvedValue({ lines: [], plugins: wanted, needsReload: false });
    render(<BackupRows native />);
    upload(backupText({ plugins: wanted }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Plugins were not installed.")).toBeInTheDocument();
    expect(api.installFromRepo).not.toHaveBeenCalled();
  });
});
