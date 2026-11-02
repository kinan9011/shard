import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ listPlugins: vi.fn(), listRepos: vi.fn(), repoCatalog: vi.fn(), pluginUpdates: vi.fn(), installFromRepo: vi.fn(), setPluginGrants: vi.fn(), onInstallProgress: vi.fn(async () => () => {}) }));
vi.mock("@/plugins/api", () => api);

import { PluginsPage } from "@/components/plugins/PluginsPage";
import { PermissionList } from "@/components/plugins/PermissionList";
import { permissionRows } from "@/plugins/permissions";
import { resetPlugins } from "@/plugins/usePlugins";
import type { CatalogEntry } from "@/plugins/api";

const OFFICIAL = "https://github.com/kinan9011/shard-plugins";
const KAFKA_REPO = "https://github.com/kinan9011/kafka-inspector";

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

const KAFKA = entry("kafka-inspector", "Kafka Inspector", {
  runtime: "web+wasm",
  version: "0.3.1",
  description: "Connect to a Kafka broker on your machine.",
  repo: KAFKA_REPO,
  repoName: "kinan9011",
  sha256: "9c41f2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabe07a",
  size: 2516582,
  released: "2026-10-18",
  minAppVersion: "1.0.0",
  changelog: "Adds Avro decoding.",
  permissions: [
    { name: "network", hosts: ["localhost:9092"], reason: "Connect to localhost:9092 and brokers you add" },
    { name: "files:open", reason: "Read files you open in the tool" },
    { name: "clipboard:write", reason: "Copy decoded messages", optional: true },
  ],
});
const CRON = entry("cron-builder", "Cron Builder", { version: "1.1.0" });
const HASH = entry("hash-generator", "Hash Generator", { runtime: "wasm", category: "Security" });

const REPOS = [
  { url: OFFICIAL, name: "Shard Official", enabled: true, official: true },
  { url: KAFKA_REPO, name: "kinan9011", enabled: true },
];

const installed = (id: string, license?: string) =>
  ({ id, enabled: true, source: { kind: "zip" }, manifest: { name: id, category: "Development", keywords: [], entry: "index.html", license } }) as never;

function arrange(options: { installed?: unknown[]; updates?: unknown[] } = {}) {
  api.listPlugins.mockResolvedValue(options.installed ?? [installed("hash-generator", "MIT")]);
  api.repoCatalog.mockResolvedValue([CRON, HASH, KAFKA]);
  api.listRepos.mockResolvedValue(REPOS);
  api.pluginUpdates.mockResolvedValue(options.updates ?? [{ id: "cron-builder", name: "Cron Builder", from: "1.0.0", to: "1.2.0", newPermissions: [], repo: OFFICIAL }]);
}

async function open(name: string) {
  render(<PluginsPage tab="browse" onTabChange={() => {}} />);
  const row = (await screen.findByText(name)).closest("[data-plugin-row]") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name }));
}

const pane = () => screen.getByRole("region", { name: "Plugin details" });

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.onInstallProgress.mockResolvedValue(() => {});
});
afterEach(() => resetPlugins());

describe("PermissionList", () => {
  it("renders a row with its reason and Required or Optional", () => {
    render(<PermissionList rows={permissionRows(KAFKA)} />);
    const items = screen.getAllByRole("listitem");
    ["Network", "Files", "Clipboard", "WASM backend"].forEach((label, index) => expect(within(items[index]!).getByText(label)).toBeInTheDocument());
    expect(within(items[0]!).getByText("Connect to localhost:9092 and brokers you add")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Required")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Optional")).toBeInTheDocument();
    expect(within(items[3]!).getByText("Runs sandboxed, with no direct access to your system")).toBeInTheDocument();
  });
});

describe("Plugin detail pane", () => {
  it("opens from a Browse row: the filters give way to a compact list and the details", async () => {
    arrange();
    await open("Kafka Inspector");
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search plugins")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kafka Inspector/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cron Builder/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(pane()).getByRole("heading", { name: "Kafka Inspector" })).toBeInTheDocument();
  });

  it("shows the header: source, badges and the primary action", async () => {
    arrange();
    await open("Kafka Inspector");
    const detail = within(pane());
    expect(detail.getByText("kinan9011 · from kinan9011/kafka-inspector")).toBeInTheDocument();
    expect(detail.getByText("Web + WASM")).toBeInTheDocument();
    expect(detail.getByText("Third-party")).toBeInTheDocument();
    expect(detail.getByText("v0.3.1")).toBeInTheDocument();
    expect(detail.getByRole("button", { name: "Install" })).toBeEnabled();
  });

  it("marks no plugin of the official repository as third-party, and shows Update and Installed", async () => {
    arrange();
    await open("Cron Builder");
    expect(within(pane()).queryByText("Third-party")).not.toBeInTheDocument();
    expect(within(pane()).getByRole("button", { name: "Update to 1.2.0" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Hash Generator/ }));
    expect(within(pane()).getByText("Installed")).toBeInTheDocument();
  });

  it("shows the Overview: description, details grid and checksum", async () => {
    arrange();
    await open("Kafka Inspector");
    const detail = within(pane());
    expect(detail.getByText("Connect to a Kafka broker on your machine.")).toBeInTheDocument();
    expect(detail.getByText("0.3.1, released 18 Oct 2026")).toBeInTheDocument();
    expect(detail.getByText("2.4 MB")).toBeInTheDocument();
    expect(detail.getByText("Web UI + WASM backend")).toBeInTheDocument();
    expect(detail.getByText("Shard 1.0 or later")).toBeInTheDocument();
    expect(detail.getByRole("link", { name: "github.com/kinan9011/kafka-inspector" })).toHaveAttribute("href", KAFKA_REPO);
    expect(detail.getByText("SHA-256 9c41f2…be07a")).toBeInTheDocument();
    expect(detail.getByText("matches release")).toBeInTheDocument();
    expect(detail.getAllByRole("listitem")).toHaveLength(4);
  });

  it("links the source only over https", async () => {
    api.listPlugins.mockResolvedValue([]);
    api.repoCatalog.mockResolvedValue([entry("odd", "Odd Plugin", { repo: "javascript:alert(1)" })]);
    api.listRepos.mockResolvedValue([]);
    api.pluginUpdates.mockResolvedValue([]);
    await open("Odd Plugin");
    expect(within(pane()).queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not take the license of a copy installed from another repository", async () => {
    arrange({ installed: [{ ...(installed("kafka-inspector", "GPL") as object), source: { kind: "repo", repo: OFFICIAL } }] });
    await open("Kafka Inspector");
    expect(within(pane()).getByText("License").nextElementSibling).toHaveTextContent("—");
  });

  it("keeps Escape in the search box from closing the pane, and focuses the pane on open", async () => {
    arrange();
    await open("Kafka Inspector");
    expect(pane()).toHaveFocus();
    fireEvent.keyDown(screen.getByPlaceholderText("Search plugins"), { key: "Escape" });
    expect(pane()).toBeInTheDocument();
  });

  it("takes the license from the installed manifest and says so when unknown", async () => {
    arrange();
    await open("Kafka Inspector");
    expect(within(pane()).getByText("License").nextElementSibling).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: /Hash Generator/ }));
    expect(within(pane()).getByText("License").nextElementSibling).toHaveTextContent("MIT");
  });

  it("lists the permissions on their own tab, with the count", async () => {
    arrange();
    await open("Kafka Inspector");
    fireEvent.click(within(pane()).getByRole("tab", { name: "Permissions 4" }));
    const items = within(pane()).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[1]!).getByText("Read files you open in the tool")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Optional")).toBeInTheDocument();
    expect(within(pane()).queryByText("SHA-256 9c41f2…be07a")).not.toBeInTheDocument();
  });

  it("shows the changelog, or says there is none", async () => {
    arrange();
    await open("Kafka Inspector");
    fireEvent.click(within(pane()).getByRole("tab", { name: "Changelog" }));
    expect(within(pane()).getByText("Adds Avro decoding.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cron Builder/ }));
    expect(within(pane()).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(pane()).getByRole("tab", { name: "Changelog" }));
    expect(within(pane()).getByText("No changelog yet.")).toBeInTheDocument();
  });

  it("goes back to the full list when the selected row is clicked again, or on Escape", async () => {
    arrange();
    await open("Kafka Inspector");
    fireEvent.click(screen.getByRole("button", { name: /Kafka Inspector/ }));
    expect(screen.getByRole("group", { name: "Category" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Plugin details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cron Builder" }));
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
    fireEvent.keyDown(pane(), { key: "Escape" });
    expect(screen.getByRole("group", { name: "Category" })).toBeInTheDocument();
  });

  it("marks updates and installed plugins in the compact list", async () => {
    arrange();
    await open("Kafka Inspector");
    expect(within(screen.getByRole("button", { name: /Cron Builder/ })).getByLabelText("Update available")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Hash Generator/ })).getByLabelText("Installed")).toBeInTheDocument();
  });

  it("keeps the search in the compact list and narrows it", async () => {
    arrange();
    await open("Kafka Inspector");
    fireEvent.change(screen.getByPlaceholderText("Search plugins"), { target: { value: "cron" } });
    expect(screen.queryByRole("button", { name: /Hash Generator/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cron Builder/ })).toBeInTheDocument();
  });
});
