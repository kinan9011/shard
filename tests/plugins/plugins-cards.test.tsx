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
  onPluginUpdates: vi.fn(),
  updatePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
  revealPluginFolder: vi.fn(),
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  setRepoEnabled: vi.fn(),
  syncRepos: vi.fn(),
  repoSettings: vi.fn(),
  setRepoSettings: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { PluginsPage } from "@/components/plugins/PluginsPage";
import { HIDDEN_TOOLS_STORAGE_KEY } from "@/app/useToolCatalog";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";
import type { CatalogEntry, InstalledPlugin, PluginUpdate, Repo } from "@/plugins/api";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const ACME = "https://github.com/acme/shard-plugins";
const NOW = Date.now();

const REPOS: Repo[] = [
  { url: OFFICIAL, name: "Shard Official", type: "index", enabled: true, official: true, lastSync: NOW - 10 * 60_000 },
  { url: ACME, name: "Acme internal", type: "index", enabled: true, lastSync: NOW - 2 * 3_600_000 },
  { url: "https://github.com/legacy/devtools-mirror", name: "Legacy mirror", type: "index", enabled: false, lastError: "index.json not found (404)" },
];

const entry = (id: string, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name,
  version: "1.0.0",
  description: `${name} description.`,
  category: "Development",
  runtime: "web",
  url: `https://example.test/${id}.zip`,
  sha256: "9c41f2".padEnd(59, "0") + "be07a",
  size: 2_516_582,
  released: "2026-10-18",
  repo: OFFICIAL,
  repoName: "Shard Official",
  ...over,
});

const CATALOG: CatalogEntry[] = [
  entry("cron-builder", "Cron Builder", { version: "1.2.0", category: "Time & Date" }),
  entry("hash-generator", "Hash Generator", { runtime: "wasm", category: "Security", version: "1.0.3" }),
  entry("kafka-inspector", "Kafka Inspector", {
    runtime: "web+wasm",
    version: "0.3.1",
    repo: ACME,
    repoName: "Acme internal",
    permissions: [
      { name: "network", hosts: ["localhost:9092"], reason: "Connect to localhost:9092 and brokers you add" },
      { name: "clipboard:write", reason: "Copy decoded messages", optional: true },
    ],
  }),
];

const plugin = (id: string, name: string, version: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id,
  version,
  manifest: { id, name, version, description: `${name}.`, entry: "index.html", runtime: "web", license: "MIT", screenshots: ["shot1.png"] },
  source: { kind: "repo", repo: OFFICIAL },
  sha256: "0".repeat(64),
  verified: true,
  enabled: true,
  granted: [],
  installedAt: 0,
  ...over,
});

const CRON_UPDATE: PluginUpdate = { id: "cron-builder", name: "Cron Builder", from: "1.1.0", to: "1.2.0", newPermissions: [], repo: OFFICIAL };
const COMPOSE_UPDATE: PluginUpdate = { id: "compose-validator", name: "Compose Validator", from: "0.2.1", to: "0.3.0", newPermissions: ["clipboard:write"], repo: OFFICIAL };

function arrange(options: { installed?: InstalledPlugin[]; updates?: PluginUpdate[]; repos?: Repo[]; catalog?: CatalogEntry[] } = {}) {
  api.listPlugins.mockResolvedValue(options.installed ?? [plugin("hash-generator", "Hash Generator", "1.0.3")]);
  api.repoCatalog.mockResolvedValue(options.catalog ?? CATALOG);
  api.listRepos.mockResolvedValue(options.repos ?? REPOS);
  api.pluginUpdates.mockResolvedValue(options.updates ?? [CRON_UPDATE]);
  api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
  api.syncRepos.mockResolvedValue(REPOS);
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-plugin-card]"));
const cardFor = (name: string) => screen.getByText(name, { selector: "[data-plugin-card] *" }).closest("[data-plugin-card]") as HTMLElement;

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
  window.localStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
});
afterEach(() => {
  resetPlugins();
  resetPluginUpdates();
});

describe("PluginsPage variant=cards: Browse (02 B)", () => {
  it("shows a card per plugin and category chips instead of the filter column", async () => {
    arrange();
    const { container } = render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Kafka Inspector");
    expect(container.firstElementChild).toHaveAttribute("data-variant", "cards");
    expect(cards()).toHaveLength(3);
    const kafka = within(cardFor("Kafka Inspector"));
    expect(kafka.getByText("Acme internal · v0.3.1")).toBeInTheDocument();
    expect(kafka.getByText("Kafka Inspector description.")).toBeInTheDocument();
    expect(kafka.getByText("Web + WASM")).toBeInTheDocument();
    expect(kafka.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(within(cardFor("Hash Generator")).getByText("Installed")).toBeInTheDocument();
    expect(within(cardFor("Cron Builder")).getByRole("button", { name: "Update to 1.2.0" })).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "Category" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual(["All", "Development", "Security", "Time & Date"]);
    expect(screen.queryByText("Runtime")).not.toBeInTheDocument();
  });

  it("filters by category chip, by repository and by search", async () => {
    arrange();
    render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Kafka Inspector");
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Security" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Repository" }), { target: { value: ACME } });
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Kafka Inspector" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Repository" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), { target: { value: "cron" } });
    expect(cards()).toHaveLength(1);
  });

  it("starts the install flow from a card", async () => {
    arrange();
    render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Kafka Inspector");
    fireEvent.click(within(cardFor("Kafka Inspector")).getByRole("button", { name: "Install" }));
    // It asks for permissions, so the shared permission dialog opens.
    expect(await screen.findByRole("dialog", { name: /Allow Kafka Inspector to/ })).toBeInTheDocument();
  });
});

describe("PluginsPage variant=cards: Detail (03 B)", () => {
  it("opens a full page with a back link, the details and what it asks for", async () => {
    arrange();
    render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Kafka Inspector" }));
    const page = await screen.findByRole("region", { name: "Plugin details" });
    // The page replaces the tabs (they stay mounted, hidden).
    expect(screen.getByText("Add tools from your repositories, a zip file, a folder or a repo URL.").closest(".hidden")).not.toBeNull();
    expect(within(page).getByRole("button", { name: "Plugins" })).toBeInTheDocument();
    expect(within(page).getByRole("heading", { name: "Kafka Inspector" })).toBeInTheDocument();
    expect(within(page).getByText("Third-party")).toBeInTheDocument();
    const details = within(within(page).getByRole("region", { name: "Details" }));
    expect(details.getByText("0.3.1, released 18 Oct 2026")).toBeInTheDocument();
    expect(details.getByText("2.4 MB")).toBeInTheDocument();
    expect(details.getByText("Web UI + WASM backend")).toBeInTheDocument();
    expect(details.getByText("matches release")).toBeInTheDocument();
    const asks = within(within(page).getByRole("region", { name: "Asks for" }));
    expect(asks.getByText("Network").parentElement).toHaveTextContent("Required");
    expect(asks.getByText("Clipboard").parentElement).toHaveTextContent("Optional");
    expect(asks.getByText("WASM backend").parentElement).toHaveTextContent("Required");
  });

  it("shows the screenshot of an installed plugin's manifest", async () => {
    arrange({ installed: [plugin("kafka-inspector", "Kafka Inspector", "0.3.1", { source: { kind: "repo", repo: ACME } })] });
    render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Kafka Inspector" }));
    const image = await screen.findByRole("img", { name: "Screenshot of Kafka Inspector" });
    expect(image.getAttribute("src")).toContain("kafka-inspector/shot1.png");
    fireEvent.error(image);
    expect(screen.queryByRole("img", { name: "Screenshot of Kafka Inspector" })).not.toBeInTheDocument();
  });

  it("goes back with the back link or Escape, and Browse keeps its search", async () => {
    arrange();
    render(<PluginsPage variant="cards" tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Kafka Inspector");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), { target: { value: "kafka" } });
    fireEvent.click(screen.getByRole("button", { name: "Kafka Inspector" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Plugin details" })).getByRole("button", { name: "Plugins" }));
    expect(screen.queryByRole("region", { name: "Plugin details" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search plugins" })).toHaveValue("kafka");
    await waitFor(() => expect(screen.getByRole("button", { name: "Kafka Inspector" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Kafka Inspector" }));
    fireEvent.keyDown(await screen.findByRole("region", { name: "Plugin details" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Plugin details" })).not.toBeInTheDocument();
  });
});

describe("PluginsPage variant=cards: Installed (04 B)", () => {
  const INSTALLED = [
    plugin("hash-generator", "Hash Generator", "1.0.3", { manifest: { id: "hash-generator", name: "Hash Generator", version: "1.0.3", description: "", entry: "index.html", runtime: "wasm" } }),
    plugin("cron-builder", "Cron Builder", "1.1.0"),
    plugin("compose-validator", "Compose Validator", "0.2.1", { enabled: false }),
  ];

  it("shows the banner, the plugin cards and the built-in chips", async () => {
    arrange({ installed: INSTALLED, updates: [CRON_UPDATE, COMPOSE_UPDATE] });
    render(<PluginsPage variant="cards" tab="installed" onTabChange={() => {}} />);
    await screen.findByText("Plugins · 3");
    expect(screen.getByText("2 updates ready.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Updates available" })).toHaveTextContent(
      "2 updates ready. Cron Builder 1.2.0 and Compose Validator 0.3.0. Compose Validator asks for one new permission.",
    );
    expect(cards()).toHaveLength(3);
    const cron = within(cardFor("Cron Builder"));
    expect(cron.getByText("Shard Official · v1.1.0")).toBeInTheDocument();
    expect(cron.getByRole("button", { name: "Update Cron Builder" })).toHaveTextContent("Update 1.2.0");
    expect(within(cardFor("Hash Generator")).getByText("WASM")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enabled: Compose Validator" })).not.toBeChecked();
    expect(screen.getByText("Built-in · 9")).toBeInTheDocument();
    expect(screen.getByText("Can be hidden, not uninstalled")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("Update all starts the updates, Review focuses the first update button", async () => {
    arrange({ installed: INSTALLED, updates: [CRON_UPDATE] });
    api.updatePlugin.mockResolvedValue(undefined);
    render(<PluginsPage variant="cards" tab="installed" onTabChange={() => {}} />);
    await screen.findByText("1 update ready.");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: "Update Cron Builder" })).toHaveFocus();
  });

  it("turns a plugin on and off with the card switch", async () => {
    arrange({ installed: INSTALLED, updates: [] });
    api.setPluginEnabled.mockResolvedValue(undefined);
    render(<PluginsPage variant="cards" tab="installed" onTabChange={() => {}} />);
    await screen.findByText("Plugins · 3");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled: Compose Validator" }));
    await waitFor(() => expect(api.setPluginEnabled).toHaveBeenCalledWith("compose-validator", true));
  });

  it("opens the card menu with Permissions, Show in folder and Uninstall", async () => {
    arrange({ installed: INSTALLED, updates: [] });
    render(<PluginsPage variant="cards" tab="installed" onTabChange={() => {}} />);
    await screen.findByText("Plugins · 3");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Cron Builder" }));
    expect(await screen.findByRole("menuitem", { name: "Permissions…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Show in folder" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Uninstall" })).toBeInTheDocument();
  });

  it("hides and shows a built-in tool from its chip", async () => {
    arrange({ installed: [], updates: [] });
    render(<PluginsPage variant="cards" tab="installed" onTabChange={() => {}} />);
    const chip = await screen.findByRole("button", { name: "JSON Viewer" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "JSON Viewer" })).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(HIDDEN_TOOLS_STORAGE_KEY)).toContain("json-viewer");
    fireEvent.click(screen.getByRole("button", { name: "JSON Viewer" }));
    expect(screen.getByRole("button", { name: "JSON Viewer" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PluginsPage variant=cards: Repositories (05 B)", () => {
  it("shows a card per repository with its actions", async () => {
    arrange();
    render(<PluginsPage variant="cards" tab="repositories" onTabChange={() => {}} />);
    await screen.findByText("Legacy mirror");
    expect(cards()).toHaveLength(0);
    const repoCards = Array.from(document.querySelectorAll<HTMLElement>("[data-repo-card]"));
    expect(repoCards).toHaveLength(3);
    const [official, acme, legacy] = repoCards.map((card) => within(card));
    expect(official?.getByText("Official")).toBeInTheDocument();
    expect(official?.getByText("github.com/kinan9011/shard-plugins")).toBeInTheDocument();
    expect(official?.getByText("Official repository can be turned off, not removed")).toBeInTheDocument();
    expect(official?.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(official?.getByText("Synced 10 min ago")).toBeInTheDocument();
    expect(acme?.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(acme?.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(legacy?.getByText("index.json not found (404)")).toBeInTheDocument();
    expect(legacy?.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(repoCards[2]?.className).toContain("border-destructive/40");
    expect(screen.getByText("Allow installs from outside these repositories")).toBeInTheDocument();
  });

  it("syncs, removes and toggles from a card", async () => {
    arrange();
    api.removeRepo.mockResolvedValue(undefined);
    api.setRepoEnabled.mockResolvedValue(undefined);
    render(<PluginsPage variant="cards" tab="repositories" onTabChange={() => {}} />);
    await screen.findByText("Acme internal");
    const acme = within(Array.from(document.querySelectorAll<HTMLElement>("[data-repo-card]"))[1] as HTMLElement);
    fireEvent.click(acme.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.syncRepos).toHaveBeenCalledWith(ACME));
    fireEvent.click(acme.getByRole("switch", { name: "Enabled: Acme internal" }));
    await waitFor(() => expect(api.setRepoEnabled).toHaveBeenCalledWith(ACME, false));
    fireEvent.click(acme.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeRepo).toHaveBeenCalledWith(ACME));
  });
});
