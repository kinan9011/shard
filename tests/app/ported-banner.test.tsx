import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DesktopBridge } from "@/lib/desktop";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  repoBundles: vi.fn(),
  pluginUpdates: vi.fn(),
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
  syncRepos: vi.fn(),
  onInstallProgress: vi.fn(),
  onPluginUpdates: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);

const desktopMock = vi.hoisted(() => ({ bridge: null as DesktopBridge | null }));
vi.mock("@/lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop")>()),
  getDesktopBridge: () => desktopMock.bridge,
}));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import Shard from "@/app/Shard";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const official = { url: OFFICIAL, name: "Shard Official", enabled: true, official: true, type: "index" as const };
const listed = (id: string, name: string, permissions: unknown[] = []) => ({
  id,
  name,
  version: "1.0.0",
  description: `${name} description.`,
  category: "Generators",
  runtime: "web",
  permissions,
  url: `${OFFICIAL}/releases/download/v1/${id}-1.0.0.zip`,
  sha256: "0".repeat(64),
  size: 60_000,
  repo: OFFICIAL,
  repoName: "Shard Official",
});
const HASH = listed("hash-generator", "Hash Generator", [{ name: "clipboard:write", reason: "Copy hashes", optional: true }]);
const installedPlugin = (id: string, name: string, enabled = true) => ({
  id,
  version: "1.0.0",
  enabled,
  granted: [],
  verified: true,
  source: { kind: "repo", repo: OFFICIAL },
  manifest: { id, name, version: "1.0.0", description: "", entry: "index.html", runtime: "web", category: "Generators" },
});

const banner = (name: string) => screen.findByText(`${name} is now a plugin.`);

beforeEach(() => {
  localStorage.clear();
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => typeof mock === "function" && "mockReset" in mock && mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([official]);
  api.repoCatalog.mockResolvedValue([HASH, listed("uuid-generator", "UUID Generator")]);
  api.repoBundles.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
  api.syncRepos.mockResolvedValue([official]);
  api.installFromRepo.mockImplementation(async (_repo: string, id: string) => ({ id }));
  api.setPluginGrants.mockResolvedValue({});
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
  // Done and dismissed: no first-run wizard or intro banner to get in the way.
  localStorage.setItem("shard-first-run-done", "true");
  localStorage.setItem("shard-plugins-intro-seen", "true");
  const idle = { status: "idle" as const, currentVersion: "2.9.0" };
  desktopMock.bridge = {
    platform: "linux",
    getVersion: vi.fn(async () => "2.9.0"),
    getUpdateState: vi.fn(async () => idle),
    onUpdateState: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => idle),
    downloadUpdate: vi.fn(async () => true),
    installUpdate: vi.fn(async () => true),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
  });
});
afterEach(() => {
  localStorage.clear();
  desktopMock.bridge = null;
  resetPlugins();
  resetPluginUpdates();
});

describe("a tool that became a plugin", () => {
  it("shows no banner when the user never used it", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer"]));
    render(<Shard />);
    await screen.findByText("Pinned tools");
    await waitFor(() => expect(api.listPlugins).toHaveBeenCalled());
    expect(screen.queryByText(/is now a plugin\./)).not.toBeInTheDocument();
  });

  it("shows the banner for a pinned tool and keeps its pin while the plugin is not installed", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "hash-generator"]));
    localStorage.setItem("shard-recent-tools", JSON.stringify(["uuid-generator", "json-viewer"]));
    render(<Shard />);

    expect(await banner("Hash Generator")).toBeInTheDocument();
    expect(await banner("UUID Generator")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "[]")).toEqual(["json-viewer", "hash-generator"]));
    expect(JSON.parse(localStorage.getItem("shard-recent-tools") ?? "[]")).toEqual(["uuid-generator", "json-viewer"]);
  });

  it("installs from the official repository after the permission dialog, then the banner goes and the pin resolves", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["hash-generator"]));
    render(<Shard />);
    await banner("Hash Generator");

    const install = screen.getByRole("button", { name: "Install Hash Generator" });
    await waitFor(() => expect(install).toBeEnabled());
    // The install makes the plugin appear in the installed list.
    api.installFromRepo.mockImplementation(async (_repo: string, id: string) => {
      api.listPlugins.mockResolvedValue([installedPlugin(id, "Hash Generator")]);
      return { id };
    });
    fireEvent.click(install);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Allow Hash Generator to:")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and install" }));

    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "hash-generator"));
    await waitFor(() => expect(screen.queryByText("Hash Generator is now a plugin.")).not.toBeInTheDocument());
    // Its pin slot is kept and now shows the plugin.
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("button", { name: "Hash Generator" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "[]")).toEqual(["hash-generator"]);
  });

  it("installs a plugin that asks for nothing without a dialog", async () => {
    localStorage.setItem("shard-recent-tools", JSON.stringify(["uuid-generator"]));
    api.repoCatalog.mockResolvedValue([listed("uuid-generator", "UUID Generator")]);
    render(<Shard />);
    await banner("UUID Generator");
    const install = screen.getByRole("button", { name: "Install UUID Generator" });
    await waitFor(() => expect(install).toBeEnabled());
    fireEvent.click(install);
    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "uuid-generator"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tries the official repository and shows the install error when the plugin is not listed (no release yet)", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["hash-generator"]));
    api.repoCatalog.mockResolvedValue([]);
    api.installFromRepo.mockRejectedValue(new Error("Not a plugin repository"));
    render(<Shard />);
    await banner("Hash Generator");
    const install = screen.getByRole("button", { name: "Install Hash Generator" });
    await waitFor(() => expect(install).toBeEnabled());
    fireEvent.click(install);

    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "hash-generator"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't install Hash Generator", { description: "Not a plugin repository" }));
    // The banner stays so the user can try again.
    expect(screen.getByText("Hash Generator is now a plugin.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "[]")).toEqual(["hash-generator"]);
  });

  it("dismissing the banner drops the pin and the recent entry of that tool only", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "hash-generator", "uuid-generator"]));
    localStorage.setItem("shard-recent-tools", JSON.stringify(["hash-generator"]));
    render(<Shard />);
    await banner("Hash Generator");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss the Hash Generator notice" }));

    await waitFor(() => expect(screen.queryByText("Hash Generator is now a plugin.")).not.toBeInTheDocument());
    expect(screen.getByText("UUID Generator is now a plugin.")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "[]")).toEqual(["json-viewer", "uuid-generator"]));
    expect(JSON.parse(localStorage.getItem("shard-recent-tools") ?? "[]")).toEqual([]);
  });

  it("offers nothing when the plugin is installed, even if it is switched off", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["hash-generator"]));
    api.listPlugins.mockResolvedValue([installedPlugin("hash-generator", "Hash Generator", false)]);
    render(<Shard />);
    await screen.findByText("Pinned tools");
    await waitFor(() => expect(api.listPlugins).toHaveBeenCalled());
    expect(screen.queryByText(/is now a plugin\./)).not.toBeInTheDocument();
  });
});

const paste = (text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  act(() => {
    document.body.dispatchEvent(event);
  });
};
const COLOR = listed("color-palette", "Color Palette", [{ name: "clipboard:write", reason: "Copy colors, palettes and CSS", optional: true }]);

describe("paste suggestions for a tool that became a plugin", () => {
  it("offers Install for a pasted color, then installs from the official repository after the permission dialog", async () => {
    api.repoCatalog.mockResolvedValue([COLOR]);
    render(<Shard />);
    await screen.findByText("Pinned tools");
    const install = await waitFor(() => {
      paste("#3b82f6");
      return screen.getByRole("button", { name: /^Install Color Palette/ });
    });
    expect(screen.getByText("Looks like a color.")).toBeInTheDocument();
    fireEvent.click(install);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Allow Color Palette to:")).toBeInTheDocument();
    api.installFromRepo.mockImplementation(async (_repo: string, id: string) => {
      api.listPlugins.mockResolvedValue([installedPlugin(id, "Color Palette")]);
      return { id };
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "color-palette"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Installed", expect.objectContaining({ description: "Color Palette" })));
    // The suggestion is gone and the install flow is over: pasting again offers the tool itself.
    await waitFor(() => {
      paste("#3b82f6");
      expect(screen.getByRole("button", { name: /^Open Color Palette/ })).toBeInTheDocument();
    });
  });

  it("installs without a dialog when the plugin asks for nothing, and cancelling the dialog installs nothing", async () => {
    api.repoCatalog.mockResolvedValue([listed("cron-calculator", "Cron Calculator"), COLOR]);
    render(<Shard />);
    await screen.findByText("Pinned tools");
    const cron = await waitFor(() => {
      paste("*/5 * * * *");
      return screen.getByRole("button", { name: /^Install Cron Calculator/ });
    });
    fireEvent.click(cron);
    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "cron-calculator"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    api.installFromRepo.mockClear();
    paste("#3b82f6");
    fireEvent.click(await screen.findByRole("button", { name: /^Install Color Palette/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.installFromRepo).not.toHaveBeenCalled();
  });

  it("offers to open it once installed", async () => {
    api.listPlugins.mockResolvedValue([installedPlugin("color-palette", "Color Palette")]);
    render(<Shard />);
    await screen.findByText("Pinned tools");
    await waitFor(() => {
      paste("#3b82f6");
      expect(screen.getByRole("button", { name: /^Open Color Palette/ })).toBeInTheDocument();
    });
  });

  it("offers nothing for a color when the plugin is switched off", async () => {
    api.listPlugins.mockResolvedValue([installedPlugin("color-palette", "Color Palette", false)]);
    render(<Shard />);
    await screen.findByText("Pinned tools");
    await waitFor(() => expect(api.listPlugins).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    paste("#3b82f6");
    expect(screen.queryByText("Looks like a color.")).not.toBeInTheDocument();
  });
});
