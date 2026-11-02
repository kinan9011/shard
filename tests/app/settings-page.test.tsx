import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  syncRepos: vi.fn(),
  onInstallProgress: vi.fn(),
  onPluginUpdates: vi.fn(),
  repoSettings: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);

import Shard from "@/app/Shard";
import { resetPlugins } from "@/plugins/usePlugins";

const main = () => screen.getByRole("main");
const sidebar = () => screen.getByRole("navigation", { name: "Tools" });
const categoryButtons = () => within(sidebar()).getAllByRole("button", { expanded: false }).concat(within(sidebar()).queryAllByRole("button", { expanded: true }));
const openSettings = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));
const settingsNav = () => within(screen.getByRole("navigation", { name: "Settings sections" }));

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
  api.syncRepos.mockResolvedValue([]);
  api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
  });
});
afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-scheme");
  localStorage.clear();
  resetPlugins();
});

describe("Settings page", () => {
  it("opens from the sidebar on Appearance with the seven sections", async () => {
    render(<Shard />);
    openSettings();

    expect(within(main()).getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(within(main()).getByText("Changes apply right away.")).toBeInTheDocument();
    for (const name of ["General", "Appearance", "Built-in tools", "Home", "Plugins", "Shortcuts", "About"]) {
      expect(settingsNav().getByRole("button", { name })).toBeInTheDocument();
    }
    expect(settingsNav().getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    // The Shortcuts dialog is no longer what Settings opens.
    expect(screen.queryByRole("dialog", { name: "Shortcut Settings" })).not.toBeInTheDocument();
  });

  it("switches section from the nav", () => {
    render(<Shard />);
    openSettings();
    fireEvent.click(settingsNav().getByRole("button", { name: "About" }));
    expect(within(main()).getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(settingsNav().getByRole("button", { name: "About" })).toHaveAttribute("aria-current", "page");
    expect(within(main()).queryByRole("group", { name: "Theme" })).not.toBeInTheDocument();
  });

  it("shows both layout cards, Sidebar selected by default", () => {
    render(<Shard />);
    openSettings();
    const sidebarCard = within(main()).getByRole("radio", { name: /^Sidebar/ });
    const launcher = within(main()).getByRole("radio", { name: /^Launcher/ });
    expect(sidebarCard).toBeChecked();
    expect(launcher).toBeEnabled();
    expect(launcher).not.toBeChecked();
    expect(within(main()).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(within(within(main()).getByRole("radiogroup", { name: "Layout" })).getByText("Default")).toBeInTheDocument();
  });

  it("applies and stores the theme right away", async () => {
    render(<Shard />);
    openSettings();
    const theme = within(within(main()).getByRole("group", { name: "Theme" }));
    expect(theme.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(theme.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("shard-theme-preference")).toBe("dark");
    expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Accent color", () => {
  afterEach(() => document.getElementById("shard-accent")?.remove());

  it("applies an accent over the scheme, stores it, and goes back to the scheme's own", async () => {
    render(<Shard />);
    openSettings();
    const accent = within(within(main()).getByRole("group", { name: "Accent color" }));
    expect(accent.getByRole("button", { name: "Scheme" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(accent.getByRole("button", { name: "Orange" }));
    expect(localStorage.getItem("shard-accent")).toBe("orange");
    expect(document.getElementById("shard-accent")?.textContent).toContain("--primary:24 90%");
    fireEvent.click(accent.getByRole("button", { name: "Scheme" }));
    expect(localStorage.getItem("shard-accent")).toBeNull();
    expect(document.getElementById("shard-accent")?.textContent).toBe("");
  });
});

describe("Settings sections", () => {
  const openSection = (name: string) => {
    openSettings();
    fireEvent.click(settingsNav().getByRole("button", { name }));
  };

  it("keeps Home as a placeholder until it has settings", () => {
    render(<Shard />);
    openSection("Home");
    expect(within(main()).getByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(within(main()).getByText("Coming soon.")).toBeInTheDocument();
  });

  it("explains in the browser preview that updates need the desktop app", () => {
    render(<Shard />);
    openSection("General");
    expect(within(main()).getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(within(main()).getByText("Updates are available in the desktop app.")).toBeInTheDocument();
    expect(within(main()).queryByRole("switch", { name: "Update automatically" })).not.toBeInTheDocument();
    expect(within(main()).queryByRole("button", { name: "Check for Updates" })).not.toBeInTheDocument();
  });

  it("resets all data only after a second click, and Cancel backs out", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<Shard />);
    openSection("General");
    localStorage.setItem("some-setting", "1");

    fireEvent.click(within(main()).getByRole("button", { name: "Reset…" }));
    fireEvent.click(within(main()).getByRole("button", { name: "Cancel" }));
    expect(within(main()).getByRole("button", { name: "Reset…" })).toBeInTheDocument();
    expect(localStorage.getItem("some-setting")).toBe("1");
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(within(main()).getByRole("button", { name: "Reset…" }));
    fireEvent.click(within(main()).getByRole("button", { name: "Remove all data" }));
    expect(localStorage.length).toBe(0);
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("lists the shortcuts with their keys", () => {
    render(<Shard />);
    openSection("Shortcuts");
    expect(within(main()).getByRole("button", { name: "Record Open Command Palette" })).toHaveTextContent("Ctrl+K");
    expect(within(main()).getByRole("button", { name: "Record Go Home" })).toBeInTheDocument();
  });

  it("sends the Plugins section to the matching Plugins tabs", async () => {
    render(<Shard />);
    openSection("Plugins");
    fireEvent.click(within(main()).getByRole("button", { name: "Open Repositories" }));
    expect(await screen.findByRole("tab", { name: /^Repositories/ })).toHaveAttribute("aria-selected", "true");

    openSection("Plugins");
    fireEvent.click(within(main()).getByRole("button", { name: "Open Installed" }));
    expect(await screen.findByRole("tab", { name: /^Installed/ })).toHaveAttribute("aria-selected", "true");
  });

  it("checks for plugin updates from the Plugins section", async () => {
    render(<Shard />);
    openSection("Plugins");
    fireEvent.click(within(main()).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(api.syncRepos).toHaveBeenCalled());
    await waitFor(() => expect(api.pluginUpdates).toHaveBeenCalled());
  });

  it("shows the version, release notes and links in About", () => {
    render(<Shard />);
    openSection("About");
    expect(within(main()).getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(within(main()).getByText("Browser preview")).toBeInTheDocument();
    expect(within(main()).getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/kinan9011/shard");
    expect(within(main()).getByRole("link", { name: "Open an issue" })).toHaveAttribute("href", "https://github.com/kinan9011/shard/issues");
    expect(within(main()).getByRole("link", { name: "View releases" })).toHaveAttribute("href", "https://github.com/kinan9011/shard/releases");
  });
});

describe("Sidebar categories setting", () => {
  it("opens or closes every category at once, and Remember restores what was open", () => {
    render(<Shard />);
    const total = categoryButtons().length;
    expect(total).toBeGreaterThan(1);
    expect(within(sidebar()).queryAllByRole("button", { expanded: true })).toHaveLength(0);

    openSettings();
    const group = within(within(main()).getByRole("group", { name: "Sidebar categories" }));
    expect(group.getByRole("button", { name: "Remember" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(group.getByRole("button", { name: "All open" }));
    expect(within(sidebar()).getAllByRole("button", { expanded: true })).toHaveLength(total);
    expect(localStorage.getItem("shard-sidebar-categories")).toBe("open");

    fireEvent.click(group.getByRole("button", { name: "All closed" }));
    expect(within(sidebar()).queryAllByRole("button", { expanded: true })).toHaveLength(0);

    fireEvent.click(group.getByRole("button", { name: "Remember" }));
    const first = within(sidebar()).getAllByRole("button", { expanded: false })[0];
    fireEvent.click(first);
    expect(within(sidebar()).getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("remembers the open categories across launches only in Remember mode", () => {
    const { unmount } = render(<Shard />);
    fireEvent.click(within(sidebar()).getAllByRole("button", { expanded: false })[0]);
    expect(localStorage.getItem("shard-sidebar-expanded")).not.toBeNull();
    unmount();

    render(<Shard />);
    expect(within(sidebar()).getAllByRole("button", { expanded: true })).toHaveLength(1);
  });
});

describe("Open tools in setting", () => {
  // Through the sidebar filter, so it works from any view.
  const openTool = (name: string) => {
    fireEvent.change(screen.getByLabelText("Filter tools"), { target: { value: name } });
    fireEvent.click(within(sidebar()).getByRole("button", { name }));
  };
  const tabs = () => screen.getAllByRole("tab");

  it("opens a new tab by default", async () => {
    render(<Shard />);
    openTool("JSON Viewer");
    await waitFor(() => expect(tabs()).toHaveLength(1));
    openTool("Regex Tester");
    await waitFor(() => expect(tabs()).toHaveLength(2));
  });

  it("replaces the current tab when set to Current tab", async () => {
    render(<Shard />);
    openSettings();
    const group = within(within(main()).getByRole("group", { name: "Open tools in" }));
    expect(group.getByRole("button", { name: "New tab" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(group.getByRole("button", { name: "Current tab" }));
    expect(localStorage.getItem("shard-open-tools-in")).toBe("current");

    // From Settings there is no tool tab to replace, so the first tool gets a tab of its own.
    openTool("JSON Viewer");
    await waitFor(() => expect(tabs()).toHaveLength(1));
    openTool("Regex Tester");
    await waitFor(() => expect(tabs()[0]).toHaveTextContent("Regex Tester"));
    expect(tabs()).toHaveLength(1);
  });
});

describe("Sidebar categories at launch", () => {
  it("does not apply a remembered list to All open or All closed", () => {
    localStorage.setItem("shard-sidebar-expanded", JSON.stringify(["Generators"]));
    localStorage.setItem("shard-sidebar-categories", "open");
    render(<Shard />);
    // All open: every category is open, the remembered one is not flipped shut.
    expect(within(sidebar()).queryAllByRole("button", { expanded: false })).toHaveLength(0);
  });
});

describe("Built-in tools section", () => {
  it("hides a built-in tool from the sidebar and closes its open tab, and shows it again", async () => {
    render(<Shard />);
    fireEvent.change(screen.getByLabelText("Filter tools"), { target: { value: "JSON Viewer" } });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "JSON Viewer" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "JSON Viewer" })).toBeInTheDocument());

    openSettings();
    fireEvent.click(settingsNav().getByRole("button", { name: "Built-in tools" }));
    const list = within(within(main()).getByRole("list", { name: "Built-in tools" }));
    expect(list.getAllByRole("switch")).toHaveLength(9);

    fireEvent.click(list.getByRole("switch", { name: "Show JSON Viewer" }));
    expect(JSON.parse(localStorage.getItem("shard-hidden-tools") ?? "[]")).toContain("json-viewer");
    await waitFor(() => expect(screen.queryByRole("tab", { name: "JSON Viewer" })).toBeNull());
    expect(within(sidebar()).queryByRole("button", { name: "JSON Viewer" })).toBeNull();

    fireEvent.click(list.getByRole("switch", { name: "Show JSON Viewer" }));
    expect(JSON.parse(localStorage.getItem("shard-hidden-tools") ?? "[]")).not.toContain("json-viewer");
  });
});
