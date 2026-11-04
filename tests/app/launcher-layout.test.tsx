import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
import { ALL_TOOLS } from "@/app/toolRegistry";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const main = () => screen.getByRole("main");
const pinnedIds = () => JSON.parse(localStorage.getItem("shard-pinned") ?? "null") as string[] | null;
const update = (id: string, name: string) => ({ id, name, from: "1.0.0", to: "1.1.0", newPermissions: [], repo: "https://github.com/x/y" });

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
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
  localStorage.clear();
  resetPlugins();
  resetPluginUpdates();
});

describe("Layout setting", () => {
  it("switches to the Launcher live from Settings → Appearance and back", async () => {
    render(<Shard />);
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name: "Appearance" }));
    expect(within(main()).getByRole("radio", { name: /^Sidebar/ })).toBeChecked();
    expect(within(main()).getByRole("radio", { name: /^Launcher/ })).toBeEnabled();
    fireEvent.click(within(main()).getByRole("radio", { name: /^Launcher/ }));

    expect(screen.queryByRole("navigation", { name: "Tools" })).not.toBeInTheDocument();
    expect(localStorage.getItem("shard-layout")).toBe("launcher");
    // The Settings page stays open under the new chrome.
    expect(within(main()).getByRole("radio", { name: /^Launcher/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(main()).getByRole("radio", { name: /^Sidebar/ }));
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
    expect(localStorage.getItem("shard-layout")).toBe("sidebar");
  });

  it("starts in the stored layout and falls back to the sidebar for an unknown value", () => {
    localStorage.setItem("shard-layout", "launcher");
    const first = render(<Shard />);
    expect(screen.queryByRole("navigation", { name: "Tools" })).not.toBeInTheDocument();
    first.unmount();

    localStorage.setItem("shard-layout", "grid");
    render(<Shard />);
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
  });
});

describe("Launcher shell", () => {
  beforeEach(() => localStorage.setItem("shard-layout", "launcher"));

  it("shows the top bar with the search trigger and no sidebar", () => {
    render(<Shard />);
    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("Shard")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("button", { name: /Find a tool or command/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle sidebar" })).not.toBeInTheDocument();
  });

  it("opens the command palette from the search trigger", () => {
    render(<Shard />);
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: /Find a tool or command/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens tools as tabs next to Home and returns to Home", () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-diff"]));
    render(<Shard />);
    fireEvent.click(within(within(main()).getByRole("region", { name: "Pinned" })).getByRole("button", { name: "JSON Diff" }));

    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("tab", { name: /JSON Diff/ })).toHaveAttribute("aria-selected", "true");
    expect(within(bar).getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(bar).getByRole("button", { name: "Home" }));
    expect(within(bar).getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(main()).getByText("Find a tool, or paste JSON, a JWT, a URL or a timestamp")).toBeInTheDocument();
    // The tab stays open.
    expect(within(bar).getByRole("tab", { name: /JSON Diff/ })).toBeInTheDocument();
  });

  it("Plugins and Settings buttons open their pages; the badge counts updates", async () => {
    api.pluginUpdates.mockResolvedValue([update("cron-builder", "Cron Builder"), update("compose-validator", "Compose Validator")]);
    render(<Shard />);
    const bar = screen.getByRole("banner");

    await waitFor(() => expect(within(bar).getByRole("button", { name: "Plugins 2" })).toBeInTheDocument());
    fireEvent.click(within(bar).getByRole("button", { name: "Plugins 2" }));
    expect(within(bar).getByRole("button", { name: "Plugins 2" })).toHaveAttribute("aria-current", "page");
    // The Launcher shows the Plugins page as cards (W24).
    expect(main().querySelector("[data-variant]")).toHaveAttribute("data-variant", "cards");

    fireEvent.click(within(bar).getByRole("button", { name: "Settings" }));
    expect(within(main()).getByRole("heading", { name: "General" })).toBeInTheDocument();
  });
});

describe("Plugins page variant", () => {
  it("is the list in the Sidebar layout", async () => {
    render(<Shard />);
    fireEvent.click(await screen.findByRole("button", { name: /^Plugins/ }));
    expect(main().querySelector("[data-variant]")).toHaveAttribute("data-variant", "list");
  });
});

describe("Launcher Home", () => {
  beforeEach(() => localStorage.setItem("shard-layout", "launcher"));

  it("shows the search hero, the paste hint and category chips", () => {
    render(<Shard />);
    expect(within(main()).getByRole("button", { name: /Find a tool, or paste JSON/ })).toBeInTheDocument();
    expect(within(main()).getByText("Paste anything with Ctrl+V and Shard suggests the right tool.")).toBeInTheDocument();
    const group = within(main()).getByRole("region", { name: "Development Tools" });
    expect(within(group).getByRole("button", { name: "JSON Viewer" })).toBeInTheDocument();
    expect(within(main()).getByRole("button", { name: "Get more tools" })).toBeInTheDocument();
  });

  it("offers to pin tools when none are pinned", () => {
    render(<Shard />);
    fireEvent.click(within(main()).getByRole("button", { name: "Pin tools to Home" }));
    expect(within(main()).getByText("Drag to reorder")).toBeInTheDocument();
    expect(within(main()).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("opens a pinned tile and Get more tools opens Plugins", () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "json-diff"]));
    render(<Shard />);
    const pinned = within(main()).getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("Drag to reorder")).toBeInTheDocument();
    expect(within(pinned).getAllByRole("button").map((b) => b.getAttribute("aria-label")).filter(Boolean)).toEqual(["JSON Viewer", "JSON Diff"]);

    fireEvent.click(within(main()).getByRole("button", { name: "Get more tools" }));
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(within(main()).queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument();
  });

  it("reorders pinned tiles with Alt+Arrow and saves the order", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "json-diff", "regex-generator"]));
    render(<Shard />);
    const pinned = () => within(main()).getByRole("region", { name: "Pinned" });
    const tile = (name: string) => within(pinned()).getByRole("button", { name });

    tile("JSON Viewer").focus();
    fireEvent.keyDown(tile("JSON Viewer"), { key: "ArrowRight", altKey: true });

    await waitFor(() => expect(pinnedIds()).toEqual(["json-diff", "json-viewer", "regex-generator"]));
    expect(within(main()).getByRole("status")).toHaveTextContent("JSON Viewer moved to position 2 of 3");
    expect(document.activeElement).toBe(tile("JSON Viewer"));
  });

  it("shows the update banner", async () => {
    api.pluginUpdates.mockResolvedValue([update("cron-builder", "Cron Builder")]);
    render(<Shard />);
    expect(await within(main()).findByText("1 plugin update is ready: Cron Builder.")).toBeInTheDocument();
  });
});

describe("Launcher empty state (09 B)", () => {
  const hideEverything = () => {
    localStorage.setItem("shard-layout", "launcher");
    localStorage.setItem("shard-hidden-tools", JSON.stringify(ALL_TOOLS.map((tool) => tool.id)));
  };

  it("shows the search hero above a dashed card with the ways to add tools", async () => {
    hideEverything();
    render(<Shard />);

    expect(await within(main()).findByRole("heading", { name: "No tools installed yet" })).toBeInTheDocument();
    expect(within(main()).getByText("Install plugins from the Shard Official repository, or add your own from a zip file, a folder or a repo URL.")).toBeInTheDocument();
    expect(within(main()).getByRole("button", { name: /^Find a tool (Ctrl|⌘)/ })).toBeInTheDocument();
    expect(within(main()).getByRole("button", { name: "Install from file or URL" })).toBeInTheDocument();
    expect(within(main()).queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tools" })).not.toBeInTheDocument();
  });

  it("opens the palette from the hero and Plugins from Browse plugins", async () => {
    hideEverything();
    render(<Shard />);
    await within(main()).findByRole("heading", { name: "No tools installed yet" });

    fireEvent.click(within(main()).getByRole("button", { name: /^Find a tool (Ctrl|⌘)/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(within(main()).getByRole("button", { name: "Browse plugins" }));
    expect(await within(main()).findByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
  });
});
