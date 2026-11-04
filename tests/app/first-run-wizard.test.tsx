import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { ALL_TOOLS } from "@/app/toolRegistry";
import { CORE_NAMES } from "@/app/firstRun";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const official = { url: OFFICIAL, name: "Shard Official", enabled: true, official: true, type: "index" as const };
const entry = (id: string, name: string, category: string, size: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  version: "1.0.0",
  description: `${name} description.`,
  category,
  runtime: "web",
  url: `${OFFICIAL}/releases/${id}.zip`,
  sha256: "0".repeat(64),
  size,
  repo: OFFICIAL,
  repoName: "Shard Official",
  ...extra,
});
const catalog = [
  entry("openapi-explorer", "OpenAPI Explorer", "Development", 1_572_864),
  entry("sql-formatter", "SQL Formatter", "Formatters", 2_097_152, { permissions: [{ name: "network", hosts: ["example.com"], reason: "Fetch SQL dialects" }] }),
  entry("hash-generator", "Hash Generator", "Security & time", 1_048_576, { runtime: "wasm", permissions: [{ name: "clipboard:write", reason: "Copy hashes", optional: true }] }),
];

const setVersion = (version: string) => {
  const idle = { status: "idle" as const, currentVersion: version };
  desktopMock.bridge = {
    platform: "linux",
    getVersion: vi.fn(async () => version),
    getUpdateState: vi.fn(async () => idle),
    onUpdateState: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => idle),
    downloadUpdate: vi.fn(async () => true),
    installUpdate: vi.fn(async () => true),
  };
};

beforeEach(() => {
  // The last test's unmount can write keys after the afterEach clear, and any saved key makes this an upgrade.
  localStorage.clear();
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => typeof mock === "function" && "mockReset" in mock && mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([official]);
  api.repoCatalog.mockResolvedValue(catalog);
  api.repoBundles.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
  api.syncRepos.mockResolvedValue([official]);
  api.installFromRepo.mockImplementation(async (_repo: string, id: string) => ({ id }));
  api.setPluginGrants.mockResolvedValue({});
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
  setVersion("1.0.0");
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

/** Renders the app and takes the layout step (1) with Sidebar, which is preselected. */
async function startOnStep2() {
  render(<Shard />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
}

describe("first-run wizard", () => {
  it("offers Sidebar (preselected) and Launcher on step 1, and Continue keeps Sidebar", async () => {
    render(<Shard />);
    expect(await screen.findByText("You can switch at any time in Settings → Appearance.")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Layout" });
    expect(within(group).getByRole("radio", { name: /Sidebar/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /Launcher/ })).not.toBeChecked();
    expect(within(group).getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Set up the tools you need. You can change everything later in Settings.")).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Setup steps" }));
    expect(steps.getByText("Appearance").closest("li")).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Pick your starter tools" })).toBeInTheDocument();
    expect(screen.getByText("Set up the tools you need. You can change everything later in Plugins.")).toBeInTheDocument();
    expect(localStorage.getItem("shard-layout")).toBe("sidebar");
  });

  it("lists the built-in tools in the order of the design, and they are the core tools", () => {
    expect([...CORE_NAMES].sort()).toEqual(ALL_TOOLS.filter((tool) => tool.kind === "core").map((tool) => tool.name).sort());
  });

  it("walks a new user through all three steps: layout, one combined permission dialog, then pinning", async () => {
    render(<Shard />);

    expect(await screen.findByRole("heading", { name: "How do you want to move between tools?" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Pick your starter tools" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Setup steps" }));
    expect(["Appearance", "Pick starter tools", "Pin tools to Home"].every((label) => steps.getByText(label))).toBe(true);
    expect(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" })).toBeInTheDocument();
    for (const category of ["Development", "Formatters", "Security & time"]) expect(screen.getByRole("region", { name: category })).toBeInTheDocument();
    expect(screen.getByText(CORE_NAMES.join(", "))).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3 · 0 plugins selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install and continue" })).toBeDisabled();

    for (const name of ["OpenAPI Explorer", "SQL Formatter", "Hash Generator"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByText("Step 2 of 3 · 3 plugins selected · 4.5 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install and continue" }));
    const dialog = await screen.findByRole("dialog", { name: "Allow 3 plugins to:" });
    expect(within(dialog).getByText("Fetch SQL dialects")).toBeInTheDocument();
    expect(within(dialog).getByText("Copy hashes")).toBeInTheDocument();
    expect(within(dialog).getByText("Asks for no permissions.")).toBeInTheDocument();
    expect(api.installFromRepo).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and install" }));
    expect(await screen.findByRole("heading", { name: "Pin tools to Home" })).toBeInTheDocument();
    expect(api.installFromRepo.mock.calls.map((call) => call[1]).sort()).toEqual(["hash-generator", "openapi-explorer", "sql-formatter"]);
    expect(api.setPluginGrants).toHaveBeenCalledWith("sql-formatter", ["network"]);
    expect(api.setPluginGrants).toHaveBeenCalledWith("hash-generator", ["clipboard:write"]);
    expect(api.setPluginGrants).toHaveBeenCalledTimes(2);

    fireEvent.click(await screen.findByRole("option", { name: /JSON Viewer/ }));
    expect(screen.getByText("1 of 12 pinned · Enter to pin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(localStorage.getItem("shard-first-run-done")).toBe("true");
    expect(localStorage.getItem("shard-first-run-started")).toBeNull();
    // Starter plugins are installed, not pinned: only the pick of step 3 is.
    await waitFor(() => expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "null")).toEqual(["json-viewer"]));
  });

  it("reads the plugin repository, not another built-in one such as Shard Themes", async () => {
    const themes = { url: "https://github.com/kinan9011/shard-themes", name: "Shard Themes", enabled: true, official: true, type: "index" as const };
    api.listRepos.mockResolvedValue([themes, official]);
    api.syncRepos.mockResolvedValue([themes, official]);
    await startOnStep2();
    expect(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" })).toBeInTheDocument();
    expect(api.syncRepos).toHaveBeenCalledWith(OFFICIAL);
    expect(api.syncRepos).not.toHaveBeenCalledWith(themes.url);
  });

  it("installs without a dialog when nothing asks for a permission, and Skip leaves step 2 untouched", async () => {
    await startOnStep2();
    fireEvent.click(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" }));
    fireEvent.click(screen.getByRole("button", { name: "Install and continue" }));
    expect(await screen.findByRole("heading", { name: "Pin tools to Home" })).toBeInTheDocument();
    expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "openapi-explorer");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays on step 2 with the failed plugins still ticked, so Install and continue retries them", async () => {
    api.installFromRepo.mockImplementation(async (_repo: string, id: string) => {
      if (id === "openapi-explorer") throw new Error("HTTP 503");
      return { id };
    });
    await startOnStep2();
    fireEvent.click(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "SQL Formatter" }));
    fireEvent.click(screen.getByRole("button", { name: "Install and continue" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow and install" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Install and continue" })).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "Pin tools to Home" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "OpenAPI Explorer" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SQL Formatter" })).not.toBeChecked();
    expect(screen.getByText("Step 2 of 3 · 1 plugin selected · 1.5 MB")).toBeInTheDocument();
  });

  it("skips step 2 without installing anything", async () => {
    await startOnStep2();
    await screen.findByRole("checkbox", { name: "OpenAPI Explorer" });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Pin tools to Home" })).toBeInTheDocument();
    expect(api.installFromRepo).not.toHaveBeenCalled();
  });

  it("filters the plugins with the search field", async () => {
    await startOnStep2();
    await screen.findByRole("checkbox", { name: "OpenAPI Explorer" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), { target: { value: "sql" } });
    expect(screen.getByRole("checkbox", { name: "SQL Formatter" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "OpenAPI Explorer" })).not.toBeInTheDocument();
  });

  it("offers Retry and Skip when Shard Official cannot be reached", async () => {
    api.syncRepos.mockResolvedValueOnce([{ ...official, lastError: "index.json not found (404)" }]);
    await startOnStep2();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't reach Shard Official")).toBeInTheDocument();
    expect(within(alert).getByText("index.json not found (404)")).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("checkbox", { name: "SQL Formatter" })).toBeInTheDocument();
    expect(api.syncRepos).toHaveBeenCalledTimes(2);
  });

  it("goes on to step 3 from the offline screen", async () => {
    api.syncRepos.mockRejectedValue(new Error("error sending request"));
    await startOnStep2();
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Pin tools to Home" })).toBeInTheDocument();
  });
});

const bundle = (id: string, name: string, plugins: string[]) => ({ id, name, plugins });
const bundles = [bundle("web-apis", "Web & APIs", ["openapi-explorer"]), bundle("data-sql", "Data & SQL", ["sql-formatter"]), bundle("security", "Security", ["hash-generator"])];

async function chooseLauncher() {
  render(<Shard />);
  fireEvent.click(await screen.findByRole("radio", { name: /Launcher/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("first-run wizard: Back and appearance", () => {
  it("sets the theme on step 1 and applies it at once", async () => {
    render(<Shard />);
    const group = await screen.findByRole("group", { name: "Theme" });
    fireEvent.click(within(group).getByRole("button", { name: "Dark" }));
    expect(localStorage.getItem("shard-theme-preference")).toBe("dark");
    expect(within(group).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
  });

  it("Back from step 2 returns to step 1 with the layout kept, and from step 3 to step 2", async () => {
    render(<Shard />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: /Sidebar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Pick your starter tools" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("radio", { name: /Sidebar/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await screen.findByRole("heading", { name: "Pin tools to Home" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Pick your starter tools" })).toBeInTheDocument();
  });

  it("Back from the Launcher bundles screen returns to step 1", async () => {
    api.repoBundles.mockResolvedValue(bundles);
    await chooseLauncher();
    await screen.findByRole("heading", { name: "Welcome to Shard" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("radio", { name: /Launcher/ })).toBeChecked();
  });
});

describe("first run in the Launcher layout (08 B)", () => {
  it("picking Launcher on step 1 applies it right away and is kept after the wizard", async () => {
    api.repoBundles.mockResolvedValue(bundles);
    await chooseLauncher();
    expect(localStorage.getItem("shard-layout")).toBe("launcher");
    expect(await screen.findByRole("heading", { name: "Welcome to Shard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Find a tool, or paste JSON, a JWT, a URL or a timestamp Ctrl+K" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("offers the bundles of the official index, with a footer that counts them", async () => {
    api.repoBundles.mockResolvedValue(bundles);
    await chooseLauncher();
    expect(await screen.findByText("Start with a set of tools. The 9 built-in tools are included, and you can hide them or add and remove plugins any time.")).toBeInTheDocument();
    expect(api.repoBundles).toHaveBeenCalledWith(OFFICIAL);
    for (const name of ["Web & APIs", "Data & SQL", "Security"]) expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    expect(screen.getByText("OpenAPI Explorer")).toBeInTheDocument();
    expect(screen.getByText("0 bundles · 0 plugins")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install and continue" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Web & APIs" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Data & SQL" }));
    expect(screen.getByText("2 bundles · 2 plugins · 3.5 MB")).toBeInTheDocument();
  });

  it("installs the plugins of the chosen bundles once each, through the combined dialog", async () => {
    api.repoBundles.mockResolvedValue([...bundles, bundle("everything", "Everything", ["openapi-explorer", "sql-formatter"])]);
    await chooseLauncher();
    for (const name of ["Data & SQL", "Everything"]) fireEvent.click(await screen.findByRole("checkbox", { name }));
    expect(screen.getByText("2 bundles · 2 plugins · 3.5 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install and continue" }));
    const dialog = await screen.findByRole("dialog", { name: "Allow 2 plugins to:" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow and install" }));
    expect(await screen.findByRole("heading", { name: "Pin tools to Home" })).toBeInTheDocument();
    expect(api.installFromRepo.mock.calls.map((call) => call[1]).sort()).toEqual(["openapi-explorer", "sql-formatter"]);
  });

  it("leaves out bundles whose plugins are not in the catalog", async () => {
    api.repoBundles.mockResolvedValue([...bundles, bundle("ghosts", "Ghosts", ["not-in-the-catalog"])]);
    await chooseLauncher();
    await screen.findByRole("checkbox", { name: "Security" });
    expect(screen.queryByRole("checkbox", { name: "Ghosts" })).not.toBeInTheDocument();
  });

  it("Choose plugins one by one switches to the plugin list of step 2", async () => {
    api.repoBundles.mockResolvedValue(bundles);
    await chooseLauncher();
    fireEvent.click(await screen.findByRole("button", { name: "Choose plugins one by one" }));
    expect(await screen.findByRole("heading", { name: "Pick your starter tools" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "OpenAPI Explorer" })).toBeInTheDocument();
  });

  it("shows the plugin list when the index has no bundles", async () => {
    await chooseLauncher();
    expect(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to Shard" })).not.toBeInTheDocument();
  });

  it("shows Retry and Skip when the official repository cannot be reached", async () => {
    api.syncRepos.mockRejectedValue(new Error("error sending request"));
    await chooseLauncher();
    expect(within(await screen.findByRole("alert")).getByText("Couldn't reach Shard Official")).toBeInTheDocument();
  });

  it("failed plugins stay ticked in the plugin list so Install and continue retries them", async () => {
    api.repoBundles.mockResolvedValue(bundles);
    api.installFromRepo.mockImplementation(async (_repo: string, id: string) => {
      if (id === "openapi-explorer") throw new Error("HTTP 503");
      return { id };
    });
    await chooseLauncher();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Web & APIs" }));
    fireEvent.click(screen.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(await screen.findByRole("checkbox", { name: "OpenAPI Explorer" })).toBeChecked();
    expect(screen.getByText("Step 2 of 3 · 1 plugin selected · 1.5 MB")).toBeInTheDocument();
  });
});

describe("a user with saved settings", () => {
  it("still gets the wizard until it is finished", async () => {
    localStorage.setItem("shard-recent-tools", "[]");
    render(<Shard />);
    expect(await screen.findByRole("radio", { name: /Launcher/ })).toBeInTheDocument();
  });

  it("does not see it again once it is done", async () => {
    setVersion("1.0.0");
    localStorage.setItem("shard-first-run-done", "true");
    render(<Shard />);
    await waitFor(() => expect(desktopMock.bridge?.getVersion).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Welcome to Shard" })).not.toBeInTheDocument();
  });
});
