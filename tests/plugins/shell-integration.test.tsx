import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const desktopMock = vi.hoisted(() => ({ bridge: null as unknown }));
vi.mock("@/lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop")>()),
  getDesktopBridge: () => desktopMock.bridge,
}));

const toastMock = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return toast;
});
vi.mock("sonner", () => ({ toast: toastMock }));

import Shard from "@/app/Shard";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const CATEGORY = "Development Tools";

const plugin = (id: string, name: string) =>
  ({ id, enabled: true, source: { kind: "zip" }, manifest: { name, category: CATEGORY, keywords: [], entry: "index.html" } }) as never;
const update = (id: string, name: string) => ({ id, name, from: "1.0.0", to: "1.1.0", newPermissions: [], repo: OFFICIAL });

const KAFKA = plugin("kafka-inspector", "Kafka Inspector");
const UPDATES = [update("cron-builder", "Cron Builder"), update("compose-validator", "Compose Validator")];

let sendLink: (url: string) => void = () => {};

function arrange(options: { plugins?: unknown[]; updates?: unknown[]; hideBuiltins?: "all" | "all-but-json" } = {}) {
  api.listPlugins.mockResolvedValue(options.plugins ?? [KAFKA]);
  api.pluginUpdates.mockResolvedValue(options.updates ?? []);
  if (options.hideBuiltins) {
    const hidden = ALL_TOOLS.filter((tool) => options.hideBuiltins === "all" || tool.id !== "json-viewer").map((tool) => tool.id);
    localStorage.setItem("shard-hidden-tools", JSON.stringify(hidden));
  }
}

const main = () => screen.getByRole("main");
const sidebar = () => screen.getByRole("navigation");

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => typeof mock === "function" && "mockReset" in mock && mock.mockReset());
  api.listRepos.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([]);
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
  desktopMock.bridge = null;
  sendLink = () => {};
  resetPlugins();
  resetPluginUpdates();
});

describe("plugin tools in the sidebar and on Home", () => {
  it("lists a plugin tool in its category and tags it on Home", async () => {
    arrange({ hideBuiltins: "all-but-json" });
    render(<Shard />);

    fireEvent.click(await within(sidebar()).findByRole("button", { name: new RegExp(`^${CATEGORY}`) }));
    expect(within(sidebar()).getByRole("button", { name: "Kafka Inspector" })).toBeInTheDocument();

    const kafka = await within(main()).findByRole("button", { name: "Kafka Inspector" });
    expect(within(kafka).getByText("Plugin")).toBeInTheDocument();
    expect(within(within(main()).getByRole("button", { name: "JSON Viewer" })).queryByText("Plugin")).not.toBeInTheDocument();
  });
});

describe("Plugins and Settings in the sidebar", () => {
  it("shows the update count on Plugins and opens the page, with no second Plugins link", async () => {
    arrange({ updates: UPDATES });
    render(<Shard />);

    const destination = await screen.findByRole("button", { name: "Plugins 2 updates" });
    expect(screen.getAllByRole("button", { name: /^Plugins/ })).toHaveLength(1);
    fireEvent.click(destination);

    expect(within(main()).getByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Plugins/ })).toHaveAttribute("aria-current", "page");
  });

  it("has no badge without updates and shows the version above What's new", async () => {
    arrange();
    render(<Shard />);
    expect(await screen.findByRole("button", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Browser preview")).toBeInTheDocument();
  });

  it("opens Plugins when the start-up check reports updates", async () => {
    arrange();
    let report: () => void = () => {};
    api.onPluginUpdates.mockImplementation(async (callback: () => void) => {
      report = callback;
      return () => {};
    });
    render(<Shard />);
    await waitFor(() => expect(api.onPluginUpdates).toHaveBeenCalled());

    api.pluginUpdates.mockResolvedValue([update("cron-builder", "Cron Builder")]);
    act(() => report());

    expect(await screen.findByRole("button", { name: "Plugins 1 update" })).toBeInTheDocument();
  });
});

describe("update banner on Home", () => {
  it("names the plugins and Review opens Plugins → Installed", async () => {
    arrange({ updates: UPDATES });
    render(<Shard />);

    expect(await within(main()).findByText("2 plugin updates are ready: Cron Builder and Compose Validator.")).toBeInTheDocument();
    fireEvent.click(within(main()).getByRole("button", { name: "Review" }));

    expect(await within(main()).findByRole("tab", { name: /Installed/ })).toHaveAttribute("aria-selected", "true");
  });

  it("uses the singular for one update and shows nothing without updates", async () => {
    arrange({ updates: [update("cron-builder", "Cron Builder")] });
    const { unmount } = render(<Shard />);
    expect(await within(main()).findByText("1 plugin update is ready: Cron Builder.")).toBeInTheDocument();
    unmount();

    resetPluginUpdates();
    arrange();
    render(<Shard />);
    await within(main()).findByText("Your workspace");
    expect(within(main()).queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});

describe("empty states (no built-in shown, no plugin installed)", () => {
  it("offers Browse plugins in the sidebar and on Home", async () => {
    arrange({ plugins: [], hideBuiltins: "all" });
    render(<Shard />);

    expect(await within(sidebar()).findByText("No tools installed")).toBeInTheDocument();
    expect(within(sidebar()).getByText("Tools you install show up here, grouped by category.")).toBeInTheDocument();
    expect(within(main()).getByRole("heading", { name: "No tools installed yet" })).toBeInTheDocument();
    expect(within(main()).getByText("Install plugins from the Shard Official repository, or add your own from a zip file, a folder or a repo URL.")).toBeInTheDocument();

    fireEvent.click(within(sidebar()).getByRole("button", { name: "Browse plugins" }));
    expect(await within(main()).findByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the install dialog from Home", async () => {
    arrange({ plugins: [], hideBuiltins: "all" });
    render(<Shard />);

    fireEvent.click(await within(main()).findByRole("button", { name: "Install from file or URL" }));

    expect(await screen.findByRole("heading", { name: "Install plugin" })).toBeInTheDocument();
  });

  it("is not shown while a plugin is installed, or before the plugins are read", async () => {
    arrange({ hideBuiltins: "all" });
    render(<Shard />);
    expect(screen.queryByText("No tools installed")).not.toBeInTheDocument();
    expect(await within(main()).findByRole("button", { name: "Kafka Inspector" })).toBeInTheDocument();
    expect(screen.queryByText("No tools installed")).not.toBeInTheDocument();
  });
});

describe("command palette", () => {
  const openPalette = async (query: string) => {
    fireEvent.click(await screen.findByRole("button", { name: /Open command palette/ }));
    fireEvent.change(await screen.findByPlaceholderText("Search tools..."), { target: { value: query } });
  };

  it("finds plugin tools", async () => {
    arrange();
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });
    await openPalette("kafka");
    expect(await screen.findByRole("option", { name: /Kafka Inspector/ })).toBeInTheDocument();
  });

  it("has Open Plugins", async () => {
    arrange();
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });
    await openPalette("open plugins");
    fireEvent.click(await screen.findByRole("option", { name: /Open Plugins/ }));

    expect(await within(main()).findByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument();
  });

  it("checks for plugin updates and says what it found", async () => {
    arrange();
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });

    await openPalette("check for plugin");
    api.pluginUpdates.mockResolvedValue([update("cron-builder", "Cron Builder")]);
    fireEvent.click(await screen.findByRole("option", { name: /Check for plugin updates/ }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("1 plugin update is available.", expect.anything()));
    expect(api.syncRepos).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Plugins 1 update" })).toBeInTheDocument();

    await openPalette("check for plugin");
    api.pluginUpdates.mockResolvedValue([]);
    fireEvent.click(await screen.findByRole("option", { name: /Check for plugin updates/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("All plugins are up to date."));
  });

  it("reports a failed check", async () => {
    arrange();
    api.syncRepos.mockRejectedValue(new Error("offline"));
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });

    await openPalette("check for plugin");
    fireEvent.click(await screen.findByRole("option", { name: /Check for plugin updates/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("offline"));
  });

  it("still reads the known updates when a repository cannot be synced", async () => {
    arrange();
    api.syncRepos.mockRejectedValue(new Error("offline"));
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });

    await openPalette("check for plugin");
    api.pluginUpdates.mockResolvedValue([update("cron-builder", "Cron Builder")]);
    fireEvent.click(await screen.findByRole("option", { name: /Check for plugin updates/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("offline"));
    expect(await screen.findByRole("button", { name: "Plugins 1 update" })).toBeInTheDocument();
  });

  it("does not offer commands while the field is empty", async () => {
    arrange();
    render(<Shard />);
    await screen.findByRole("button", { name: "Plugins" });
    await openPalette("");
    expect(screen.queryByRole("option", { name: /Open Plugins/ })).not.toBeInTheDocument();
  });
});

describe("deep links to plugin tools", () => {
  const bridge = () => {
    const idle = { status: "idle" as const, currentVersion: "2.0.0" };
    desktopMock.bridge = {
      platform: "darwin",
      getVersion: vi.fn(async () => "2.0.0"),
      getUpdateState: vi.fn(async () => idle),
      onUpdateState: vi.fn(() => () => {}),
      checkForUpdates: vi.fn(async () => idle),
      downloadUpdate: vi.fn(async () => true),
      installUpdate: vi.fn(async () => true),
      onDeepLink: vi.fn((callback: (url: string) => void) => {
        sendLink = callback;
        return () => {};
      }),
    };
    localStorage.setItem("shard-whats-new-seen-version", "2.0.0");
  };

  it("opens an installed plugin", async () => {
    arrange();
    bridge();
    render(<Shard />);
    await within(main()).findByText("Your workspace");
    await screen.findByRole("button", { name: "Plugins" });
    await waitFor(() => expect(api.listPlugins).toHaveBeenCalled());
    await act(async () => {});

    act(() => sendLink("shard://tool/kafka-inspector"));

    expect(await screen.findByRole("tab", { name: /Kafka Inspector/ })).toHaveAttribute("aria-selected", "true");
  });

  it("waits for the installed plugins when the link comes first", async () => {
    let finish: (plugins: unknown[]) => void = () => {};
    api.listPlugins.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    api.pluginUpdates.mockResolvedValue([]);
    bridge();
    render(<Shard />);
    await waitFor(() => expect((desktopMock.bridge as { onDeepLink: ReturnType<typeof vi.fn> }).onDeepLink).toHaveBeenCalled());

    act(() => sendLink("shard://tool/kafka-inspector"));
    expect(screen.queryByRole("tab", { name: /Kafka Inspector/ })).not.toBeInTheDocument();

    await act(async () => finish([KAFKA]));
    expect(await screen.findByRole("tab", { name: /Kafka Inspector/ })).toHaveAttribute("aria-selected", "true");
  });

  it("does not hold on to a link that is not about a tool", async () => {
    let finish: (plugins: unknown[]) => void = () => {};
    api.listPlugins.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    api.pluginUpdates.mockResolvedValue([]);
    bridge();
    render(<Shard />);
    await waitFor(() => expect((desktopMock.bridge as { onDeepLink: ReturnType<typeof vi.fn> }).onDeepLink).toHaveBeenCalled());

    act(() => sendLink("https://example.com/not-a-link"));
    await act(async () => finish([KAFKA]));
    await screen.findByRole("button", { name: "Plugins" });

    expect(screen.queryByRole("tab", { selected: true })).not.toBeInTheDocument();
  });
});

describe("stored pinned tools and recents survive the start-up", () => {
  const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? "null");

  it("keeps the id of an installed plugin and drops an unknown one once the plugins are read", async () => {
    let finish: (plugins: unknown[]) => void = () => {};
    api.listPlugins.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    api.pluginUpdates.mockResolvedValue([]);
    localStorage.setItem("shard-pinned", JSON.stringify(["kafka-inspector", "gone-tool", "json-viewer"]));
    localStorage.setItem("shard-recent-tools", JSON.stringify(["gone-tool", "kafka-inspector"]));

    render(<Shard />);
    await within(main()).findByText("Your workspace");

    // Not read yet: nothing is pruned or rewritten, so the plugin's id is not lost.
    expect(stored("shard-pinned")).toEqual(["kafka-inspector", "gone-tool", "json-viewer"]);
    expect(stored("shard-recent-tools")).toEqual(["gone-tool", "kafka-inspector"]);

    await act(async () => finish([KAFKA]));

    await waitFor(() => expect(stored("shard-pinned")).toEqual(["kafka-inspector", "json-viewer"]));
    expect(stored("shard-recent-tools")).toEqual(["kafka-inspector"]);
    const pinnedSection = within(main()).getByText("Pinned tools").parentElement?.parentElement as HTMLElement;
    expect(within(pinnedSection).getByRole("button", { name: "Kafka Inspector" })).toBeInTheDocument();
    expect(within(pinnedSection).getByRole("button", { name: "JSON Viewer" })).toBeInTheDocument();
  });

  it("drops the ids of an uninstalled plugin", async () => {
    arrange({ plugins: [] });
    localStorage.setItem("shard-pinned", JSON.stringify(["kafka-inspector"]));

    render(<Shard />);

    await waitFor(() => expect(stored("shard-pinned")).toEqual([]));
    expect(within(main()).queryByRole("button", { name: "Kafka Inspector" })).not.toBeInTheDocument();
  });

  it("keeps the stored ids when the plugins cannot be read", async () => {
    api.listPlugins.mockRejectedValue(new Error("store unavailable"));
    api.pluginUpdates.mockResolvedValue([]);
    localStorage.setItem("shard-pinned", JSON.stringify(["kafka-inspector"]));

    render(<Shard />);
    await within(main()).findByText("Your workspace");
    await act(async () => {});

    expect(stored("shard-pinned")).toEqual(["kafka-inspector"]);
  });

  it("still saves new recents when the plugins cannot be read, keeping the stored plugin id", async () => {
    api.listPlugins.mockRejectedValue(new Error("store unavailable"));
    api.pluginUpdates.mockResolvedValue([]);
    localStorage.setItem("shard-recent-tools", JSON.stringify(["kafka-inspector"]));

    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "JSON Viewer" }));

    await waitFor(() => expect(stored("shard-recent-tools")).toEqual(["json-viewer", "kafka-inspector"]));
  });
});

describe("empty state is only for no installed plugin", () => {
  it("is not shown when a disabled plugin is installed", async () => {
    arrange({ plugins: [{ ...(KAFKA as object), enabled: false }], hideBuiltins: "all" });
    render(<Shard />);
    await within(main()).findByText("Your workspace");
    await act(async () => {});
    expect(screen.queryByText("No tools installed")).not.toBeInTheDocument();
  });
});
