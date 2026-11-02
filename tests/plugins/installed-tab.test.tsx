import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
  onInstallProgress: vi.fn(),
  updatePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
  revealPluginFolder: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { PluginsPage } from "@/components/plugins/PluginsPage";
import { sourceLabel } from "@/plugins/format";
import { HIDDEN_TOOLS_STORAGE_KEY } from "@/app/useToolCatalog";
import { resetPlugins } from "@/plugins/usePlugins";
import type { CatalogEntry, InstalledPlugin, PluginUpdate } from "@/plugins/api";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";

const installed = (id: string, name: string, over: Partial<InstalledPlugin> = {}, runtime: "web" | "wasm" | "web+wasm" = "web"): InstalledPlugin => ({
  id,
  version: "1.0.0",
  manifest: { id, name, version: "1.0.0", description: `${name}.`, entry: "index.html", runtime },
  source: { kind: "repo", repo: OFFICIAL },
  sha256: "0".repeat(64),
  verified: true,
  enabled: true,
  granted: [],
  installedAt: 0,
  ...over,
});

const SQL = installed("sql-formatter", "SQL Formatter", { version: "1.4.2" });
const HASH = installed("hash-generator", "Hash Generator", { version: "1.0.3" }, "wasm");
const CRON = installed("cron-builder", "Cron Builder", { version: "1.1.0" });
const COMPOSE = installed(
  "compose-validator",
  "Compose Validator",
  { version: "0.2.1", enabled: false, source: { kind: "url", url: "https://github.com/acme/compose-validator" }, granted: ["clipboard:write"] },
  "web+wasm",
);

const listed = (id: string, name: string, version: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name,
  version,
  description: `${name}.`,
  runtime: "web",
  url: `https://example.test/${id}.zip`,
  sha256: "0".repeat(64),
  repo: OFFICIAL,
  repoName: "Shard Official",
  ...over,
});

const CRON_UPDATE: PluginUpdate = { id: "cron-builder", name: "Cron Builder", from: "1.1.0", to: "1.2.0", changelog: "Adds Quartz syntax and time zones.", newPermissions: [], repo: OFFICIAL };
const COMPOSE_UPDATE: PluginUpdate = {
  id: "compose-validator",
  name: "Compose Validator",
  from: "0.2.1",
  to: "0.3.0",
  changelog: "Compose spec 2.6. Asks for one new permission.",
  newPermissions: ["clipboard:write"],
  repo: OFFICIAL,
};

function arrange(plugins: InstalledPlugin[], updates: PluginUpdate[] = []) {
  api.listPlugins.mockResolvedValue(plugins);
  api.repoCatalog.mockResolvedValue([
    listed("cron-builder", "Cron Builder", "1.2.0"),
    listed("compose-validator", "Compose Validator", "0.3.0", {
      runtime: "web+wasm",
      permissions: [
        { name: "files:open", reason: "Read compose files you open" },
        { name: "clipboard:write", reason: "Copy the fixed file", optional: true },
      ],
    }),
  ]);
  api.listRepos.mockResolvedValue([{ url: OFFICIAL, name: "Shard Official", enabled: true, official: true }]);
  api.pluginUpdates.mockResolvedValue(updates);
  api.onInstallProgress.mockResolvedValue(() => {});
  api.updatePlugin.mockResolvedValue({});
  api.setPluginGrants.mockResolvedValue({});
  api.setPluginEnabled.mockResolvedValue({});
  api.uninstallPlugin.mockResolvedValue(undefined);
  api.revealPluginFolder.mockResolvedValue(undefined);
}

const renderTab = () => render(<PluginsPage tab="installed" onTabChange={() => {}} />);
const tableRow = async (name: string) => within(await screen.findByRole("table", { name: "Installed plugins" })).getByText(name).closest('[role="row"]') as HTMLElement;

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => mock.mockReset());
  localStorage.clear();
});
afterEach(() => resetPlugins());

describe("Installed tab: updates", () => {
  it("lists each update with from → to, the changelog line and the New permission tag", async () => {
    arrange([SQL, CRON, COMPOSE], [CRON_UPDATE, COMPOSE_UPDATE]);
    renderTab();

    const section = await screen.findByRole("region", { name: "Updates available" });
    expect(within(section).getByText("Updates available · 2")).toBeInTheDocument();
    expect(within(section).getByText("1.2.0")).toBeInTheDocument();
    expect(within(section).getByText("Adds Quartz syntax and time zones.")).toBeInTheDocument();
    expect(within(section).getAllByText("New permission")).toHaveLength(1);
    expect(within(section).getByRole("button", { name: "Update all" })).toBeInTheDocument();
  });

  it("has no Updates section without updates", async () => {
    arrange([SQL]);
    renderTab();
    await screen.findByText("Installed plugins · 1");
    expect(screen.queryByText(/Updates available/)).not.toBeInTheDocument();
  });

  it("updates in place when the update adds no permission, and keeps the grants", async () => {
    arrange([CRON], [CRON_UPDATE]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Update Cron Builder" }));

    await waitFor(() => expect(api.updatePlugin).toHaveBeenCalledWith("cron-builder"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Updated", expect.objectContaining({ description: "Cron Builder 1.1.0 → 1.2.0" })));
    expect(api.setPluginGrants).not.toHaveBeenCalled();
  });

  it("asks first when the update adds a permission, with the new row tagged and the old choice kept", async () => {
    arrange([COMPOSE], [COMPOSE_UPDATE]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Update Compose Validator" }));

    const dialog = await screen.findByRole("dialog", { name: "Allow Compose Validator to:" });
    expect(api.updatePlugin).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Update to version 0.3.0 from github.com/kinan9011/shard-plugins")).toBeInTheDocument();
    expect(within(dialog).getByText("New")).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Clipboard" })).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and update" }));

    await waitFor(() => expect(api.updatePlugin).toHaveBeenCalledWith("compose-validator"));
    await waitFor(() => expect(api.setPluginGrants).toHaveBeenCalledWith("compose-validator", ["files:open", "clipboard:write"]));
    expect(api.updatePlugin.mock.invocationCallOrder[0]).toBeLessThan(api.setPluginGrants.mock.invocationCallOrder[0]);
  });

  it("leaves the plugin alone when the dialog is cancelled", async () => {
    arrange([COMPOSE], [COMPOSE_UPDATE]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Update Compose Validator" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.updatePlugin).not.toHaveBeenCalled();
  });

  it("Update all runs the plain updates and asks for the others, one dialog at a time", async () => {
    arrange([CRON, COMPOSE], [CRON_UPDATE, COMPOSE_UPDATE]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Update all" }));

    await waitFor(() => expect(api.updatePlugin).toHaveBeenCalledWith("cron-builder"));
    expect(api.updatePlugin).not.toHaveBeenCalledWith("compose-validator");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow and update" }));
    await waitFor(() => expect(api.updatePlugin).toHaveBeenCalledWith("compose-validator"));
  });
});

describe("Installed tab: table", () => {
  it("shows name, version, source, runtime and the enabled switch of each plugin, and dims a disabled one", async () => {
    arrange([SQL, HASH, COMPOSE]);
    renderTab();

    expect(await screen.findByText("Installed plugins · 3")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Installed plugins" });
    for (const header of ["Name", "Version", "Source", "Runtime", "Enabled"]) expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();

    const sql = await tableRow("SQL Formatter");
    expect(within(sql).getByText("1.4.2")).toBeInTheDocument();
    expect(within(sql).getByText("Shard Official")).toBeInTheDocument();
    expect(within(sql).getByText("Web")).toBeInTheDocument();
    expect(within(sql).getByRole("switch")).toBeChecked();
    expect(within(await tableRow("Hash Generator")).getByText("WASM")).toBeInTheDocument();

    const compose = await tableRow("Compose Validator");
    expect(within(compose).getByText("acme/compose-validator")).toBeInTheDocument();
    expect(within(compose).getByText("Web + WASM")).toBeInTheDocument();
    expect(within(compose).getByRole("switch")).not.toBeChecked();
    expect(compose.className).toContain("opacity-60");
  });

  it("words the source of a zip, a folder and an unlisted repository", () => {
    const repos = [{ url: OFFICIAL, name: "Shard Official", enabled: true }];
    expect(sourceLabel(installed("a-a", "A", { source: { kind: "zip" } }), repos)).toBe("Zip file");
    expect(sourceLabel(installed("a-a", "A", { source: { kind: "folder" } }), repos)).toBe("Folder");
    expect(sourceLabel(installed("a-a", "A", { source: { kind: "repo", repo: "https://github.com/x/y" } }), repos)).toBe("x/y");
  });

  it("says so when nothing is installed", async () => {
    arrange([]);
    renderTab();
    expect(await screen.findByText("No plugins installed yet.")).toBeInTheDocument();
  });

  it("switches a plugin on or off", async () => {
    arrange([SQL]);
    renderTab();

    fireEvent.click(within(await tableRow("SQL Formatter")).getByRole("switch"));

    await waitFor(() => expect(api.setPluginEnabled).toHaveBeenCalledWith("sql-formatter", false));
    await waitFor(() => expect(api.listPlugins).toHaveBeenCalledTimes(2));
  });

  it("toasts a switch that failed", async () => {
    arrange([SQL]);
    api.setPluginEnabled.mockRejectedValue(new Error("Disk full"));
    renderTab();

    fireEvent.click(within(await tableRow("SQL Formatter")).getByRole("switch"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't disable SQL Formatter", { description: "Disk full" }));
  });
});

describe("Installed tab: row menu", () => {
  const openMenu = async (name: string) => {
    fireEvent.click(within(await tableRow(name)).getByRole("button", { name: `Actions for ${name}` }));
    return screen.findByRole("menu");
  };

  it("offers Permissions…, Show in folder and Uninstall", async () => {
    arrange([SQL]);
    renderTab();
    const menu = await openMenu("SQL Formatter");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Permissions…", "Show in folder", "Uninstall"]);
  });

  it("reopens the permission dialog in manage mode and saves the choice", async () => {
    const clip = installed("clip-tool", "Clip Tool", { granted: [] });
    clip.manifest.permissions = [{ name: "clipboard:write", reason: "Copy results", optional: true }];
    arrange([clip]);
    renderTab();

    fireEvent.click(within(await openMenu("Clip Tool")).getByRole("menuitem", { name: "Permissions…" }));

    const dialog = await screen.findByRole("dialog", { name: "Allow Clip Tool to:" });
    expect(within(dialog).queryByText(/changed later/)).not.toBeInTheDocument();
    const toggle = within(dialog).getByRole("switch", { name: "Clipboard" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setPluginGrants).toHaveBeenCalledWith("clip-tool", ["clipboard:write"]));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Permissions saved", { description: "Clip Tool" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the folder", async () => {
    arrange([SQL]);
    renderTab();
    fireEvent.click(within(await openMenu("SQL Formatter")).getByRole("menuitem", { name: "Show in folder" }));
    await waitFor(() => expect(api.revealPluginFolder).toHaveBeenCalledWith("sql-formatter"));
  });

  it("asks before uninstalling, and keeps the plugin on Cancel", async () => {
    arrange([SQL]);
    renderTab();

    fireEvent.click(within(await openMenu("SQL Formatter")).getByRole("menuitem", { name: "Uninstall" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Uninstall SQL Formatter?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("uninstalls after the confirmation and reads the lists again", async () => {
    arrange([SQL]);
    renderTab();

    fireEvent.click(within(await openMenu("SQL Formatter")).getByRole("menuitem", { name: "Uninstall" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Uninstall" }));

    await waitFor(() => expect(api.uninstallPlugin).toHaveBeenCalledWith("sql-formatter"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Uninstalled", { description: "SQL Formatter" }));
    await waitFor(() => expect(api.pluginUpdates).toHaveBeenCalledTimes(2));
  });
});

describe("Installed tab: built-in tools", () => {
  it("names the built-in tools and says they can be hidden but not uninstalled", async () => {
    arrange([]);
    renderTab();

    expect(await screen.findByText("9 built-in tools")).toBeInTheDocument();
    expect(screen.getByText(/JSON Viewer, Code Playground, Regex Tester and 6 more\. Built in, so they can be hidden but not uninstalled\./)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Built-in tools" })).not.toBeInTheDocument();
  });

  it("expands to a Show switch per tool that writes the hidden set", async () => {
    arrange([]);
    localStorage.setItem(HIDDEN_TOOLS_STORAGE_KEY, JSON.stringify(["jwt-decoder"]));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

    const list = screen.getByRole("list", { name: "Built-in tools" });
    expect(within(list).getAllByRole("switch")).toHaveLength(9);
    expect(within(list).getByRole("switch", { name: "Show JWT Decoder" })).not.toBeChecked();
    fireEvent.click(within(list).getByRole("switch", { name: "Show JSON Viewer" }));
    expect(JSON.parse(localStorage.getItem(HIDDEN_TOOLS_STORAGE_KEY) ?? "[]").sort()).toEqual(["json-viewer", "jwt-decoder"]);
    fireEvent.click(within(list).getByRole("switch", { name: "Show JWT Decoder" }));
    expect(JSON.parse(localStorage.getItem(HIDDEN_TOOLS_STORAGE_KEY) ?? "[]")).toEqual(["json-viewer"]);
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});

describe("Installed tab: update not in the catalog", () => {
  it("still asks about a new permission it can only name", async () => {
    arrange([COMPOSE], [COMPOSE_UPDATE]);
    api.repoCatalog.mockResolvedValue([]);
    const plain = installed("plain-tool", "Plain Tool", { version: "1.0.0" });
    api.listPlugins.mockResolvedValue([plain]);
    api.pluginUpdates.mockResolvedValue([{ id: "plain-tool", name: "Plain Tool", from: "1.0.0", to: "1.1.0", newPermissions: ["clipboard:write"], repo: OFFICIAL }]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Update Plain Tool" }));

    const dialog = await screen.findByRole("dialog", { name: "Allow Plain Tool to:" });
    expect(within(dialog).getByText("New")).toBeInTheDocument();
  });
});
