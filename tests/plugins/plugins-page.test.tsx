import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ listPlugins: vi.fn(), listRepos: vi.fn(), repoCatalog: vi.fn(), pluginUpdates: vi.fn(), installFromRepo: vi.fn(), setPluginGrants: vi.fn(), onInstallProgress: vi.fn(async () => () => {}), onPluginUpdates: vi.fn(async () => () => {}), syncRepos: vi.fn() }));
vi.mock("@/plugins/api", () => api);

import Shard from "@/app/Shard";
import { PluginsPage } from "@/components/plugins/PluginsPage";
import { joinCatalog } from "@/plugins/usePluginCatalog";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";
import type { CatalogEntry } from "@/plugins/api";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const ACME = "https://github.com/acme/internal";

const entry = (id: string, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name,
  version: "1.0.0",
  description: `${name} description.`,
  category: "Development",
  runtime: "web",
  url: `https://example.test/${id}.zip`,
  sha256: "0".repeat(64),
  repo: OFFICIAL,
  repoName: "Shard Official",
  ...over,
});

const CATALOG: CatalogEntry[] = [
  entry("compose-validator", "Compose Validator", { runtime: "web+wasm", version: "0.2.1", repo: ACME, repoName: "Acme internal", released: "2026-10-01" }),
  entry("cron-builder", "Cron Builder", { version: "1.1.0", category: "Time & Date", released: "2026-10-20" }),
  entry("hash-generator", "Hash Generator", { runtime: "wasm", version: "1.0.3", category: "Security", released: "2026-09-01" }),
  entry("kafka-inspector", "Kafka Inspector", { runtime: "web+wasm", version: "0.3.1", released: "2026-10-18" }),
  entry("loose", "Loose Plugin", { category: undefined, version: "0.0.1" }),
];

const REPOS = [
  { url: OFFICIAL, name: "Shard Official", enabled: true, official: true },
  { url: ACME, name: "Acme internal", enabled: true },
];

const installed = (id: string) => ({ id, enabled: true, source: { kind: "zip" }, manifest: { name: id, category: "Development", keywords: [], entry: "index.html" } }) as never;

function arrange(options: { catalog?: CatalogEntry[]; installed?: string[]; updates?: unknown[] } = {}) {
  api.listPlugins.mockResolvedValue((options.installed ?? ["hash-generator"]).map(installed));
  api.repoCatalog.mockResolvedValue(options.catalog ?? CATALOG);
  api.listRepos.mockResolvedValue(REPOS);
  api.pluginUpdates.mockResolvedValue(
    options.updates ?? [
      { id: "compose-validator", name: "Compose Validator", from: "0.2.1", to: "0.3.0", newPermissions: [], repo: ACME },
      { id: "cron-builder", name: "Cron Builder", from: "1.0.0", to: "1.2.0", newPermissions: [], repo: OFFICIAL },
    ],
  );
}

const rowFor = (name: string) => screen.getByText(name).closest("[data-plugin-row]") as HTMLElement;
const rowNames = () => screen.queryAllByTestId("plugin-name").map((node) => node.textContent);

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
});
afterEach(() => {
  resetPlugins();
  resetPluginUpdates();
});

describe("joinCatalog", () => {
  const list = [entry("a", "A"), entry("b", "B"), entry("c", "C", { repo: ACME })];

  it("marks install, installed and update", () => {
    const rows = joinCatalog(list, [installed("b"), installed("c")], [{ id: "c", name: "C", from: "1.0.0", to: "2.0.0", newPermissions: [], repo: ACME }]);
    expect(rows.map((row) => row.action)).toEqual([{ kind: "install" }, { kind: "installed" }, { kind: "update", to: "2.0.0" }]);
  });

  it("ignores an update that comes from another repository", () => {
    const rows = joinCatalog([entry("c", "C")], [installed("c")], [{ id: "c", name: "C", from: "1.0.0", to: "2.0.0", newPermissions: [], repo: ACME }]);
    expect(rows[0]?.action).toEqual({ kind: "installed" });
  });
});

describe("PluginsPage", () => {
  it("shows the title, the subtitle, the install button and the tab badges", async () => {
    arrange();
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByText("Add tools from your repositories, a zip file, a folder or a repo URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install from file or URL" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: /Installed.*2 updates/ })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /Repositories.*2/ })).toBeInTheDocument();
  });

  it("uses the singular for one update and no badge for none", async () => {
    arrange({ updates: [{ id: "cron-builder", name: "Cron Builder", from: "1.0.0", to: "1.2.0", newPermissions: [], repo: OFFICIAL }] });
    const { unmount } = render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    expect(await screen.findByText("1 update")).toBeInTheDocument();
    unmount();
    arrange({ updates: [] });
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Cron Builder");
    expect(screen.queryByText(/updates?$/)).not.toBeInTheDocument();
  });

  it("reports a tab change", () => {
    arrange();
    const onTabChange = vi.fn();
    render(<PluginsPage tab="browse" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /Installed/ }));
    expect(onTabChange).toHaveBeenCalledWith("installed");
    fireEvent.click(screen.getByRole("tab", { name: /Repositories/ }));
    expect(onTabChange).toHaveBeenCalledWith("repositories");
  });
});

describe("BrowseTab", () => {
  const open = async () => {
    arrange();
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    await screen.findByText("Kafka Inspector");
  };

  it("lists each plugin with its runtime, description, source and action", async () => {
    await open();
    const compose = rowFor("Compose Validator");
    expect(within(compose).getByText("Web + WASM")).toBeInTheDocument();
    expect(within(compose).getByText("Compose Validator description.")).toBeInTheDocument();
    expect(within(compose).getByText("Acme internal · 0.2.1")).toBeInTheDocument();
    expect(within(compose).getByRole("button", { name: "Update to 0.3.0" })).toBeInTheDocument();
    expect(within(rowFor("Hash Generator")).getByText("WASM")).toBeInTheDocument();
    expect(within(rowFor("Hash Generator")).getByText("Installed")).toBeInTheDocument();
    expect(within(rowFor("Kafka Inspector")).getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(within(rowFor("Cron Builder")).getByText("Web")).toBeInTheDocument();
  });

  it("keeps Update disabled and enables Install", async () => {
    await open();
    expect(within(rowFor("Kafka Inspector")).getByRole("button", { name: "Install" })).toBeEnabled();
    expect(within(rowFor("Cron Builder")).getByRole("button", { name: "Update to 1.2.0" })).toBeDisabled();
  });

  it("counts the plugins and the repositories", async () => {
    await open();
    expect(screen.getByText("5 plugins from 2 repositories")).toBeInTheDocument();
  });

  it("sorts by name, or newest first", async () => {
    await open();
    expect(rowNames()).toEqual(["Compose Validator", "Cron Builder", "Hash Generator", "Kafka Inspector", "Loose Plugin"]);
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "newest" } });
    expect(rowNames()).toEqual(["Cron Builder", "Kafka Inspector", "Compose Validator", "Hash Generator", "Loose Plugin"]);
  });

  it("filters by category, with counts; plugins without one are Other", async () => {
    await open();
    const categories = screen.getByRole("group", { name: "Category" });
    expect(within(categories).getByRole("button", { name: /^All\s*5$/ })).toBeInTheDocument();
    expect(within(categories).getByRole("button", { name: /^Development\s*2$/ })).toBeInTheDocument();
    fireEvent.click(within(categories).getByRole("button", { name: /^Security/ }));
    expect(rowNames()).toEqual(["Hash Generator"]);
    expect(screen.getByText("1 plugin from 1 repository")).toBeInTheDocument();
    fireEvent.click(within(categories).getByRole("button", { name: /^Other/ }));
    expect(rowNames()).toEqual(["Loose Plugin"]);
  });

  it("filters by repository and recounts the categories", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: ACME } });
    expect(rowNames()).toEqual(["Compose Validator"]);
    const categories = screen.getByRole("group", { name: "Category" });
    expect(within(categories).getByRole("button", { name: /^All\s*1$/ })).toBeInTheDocument();
    expect(within(categories).queryByRole("button", { name: /^Security/ })).not.toBeInTheDocument();
  });

  it("filters by runtime chips", async () => {
    await open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Web" }));
    expect(rowNames()).toEqual(["Compose Validator", "Hash Generator", "Kafka Inspector"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Web + WASM" }));
    expect(rowNames()).toEqual([]);
    expect(screen.getByText("No plugins match.")).toBeInTheDocument();
  });

  it("searches name, description and id", async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText("Search plugins"), { target: { value: "kafka" } });
    expect(rowNames()).toEqual(["Kafka Inspector"]);
    fireEvent.change(screen.getByPlaceholderText("Search plugins"), { target: { value: "cron-builder" } });
    expect(rowNames()).toEqual(["Cron Builder"]);
  });

  it("says so when no repository lists a plugin, and when the catalog fails", async () => {
    arrange({ catalog: [] });
    const { unmount } = render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    expect(await screen.findByText("No plugins yet. Add a repository to see its plugins.")).toBeInTheDocument();
    unmount();
    arrange();
    api.repoCatalog.mockRejectedValue(new Error("boom"));
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});

describe("Plugins entry in the sidebar", () => {
  it("opens the Plugins page", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    arrange();
    render(<Shard />);
    fireEvent.click(screen.getByRole("button", { name: /^Plugins/ }));
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    await waitFor(() => expect(within(main).getByText("Kafka Inspector")).toBeInTheDocument());
    expect(within(main).queryByText("Quick Access")).not.toBeInTheDocument();
  });
});
