import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  onInstallProgress: vi.fn(),
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
import { repoAddress, syncedAgo } from "@/plugins/format";
import { resetPlugins } from "@/plugins/usePlugins";
import type { CatalogEntry, Repo } from "@/plugins/api";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const OFFICIAL_URL = "https://github.com/kinan9011/shard-plugins";
const ACME_URL = "https://github.com/acme/shard-plugins";
const KAFKA_URL = "https://github.com/kinan9011/kafka-inspector";
const LEGACY_URL = "https://github.com/legacy/devtools-mirror";

const REPOS: Repo[] = [
  { url: OFFICIAL_URL, name: "Shard Official", type: "index", enabled: true, official: true, lastSync: NOW - 10 * MIN },
  { url: ACME_URL, name: "Acme internal", type: "index", enabled: true, lastSync: NOW - 2 * HOUR },
  { url: KAFKA_URL, name: "Kafka Inspector", type: "releases", enabled: true, lastSync: NOW - 30 * HOUR },
  { url: LEGACY_URL, name: "Legacy mirror", type: "index", enabled: false, lastError: "index.json not found (404)" },
];

const listed = (id: string, repo: string): CatalogEntry => ({
  id,
  name: id,
  version: "1.0.0",
  description: `${id}.`,
  runtime: "web",
  url: `https://example.test/${id}.zip`,
  sha256: "0".repeat(64),
  repo,
  repoName: "x",
});

function arrange(repos: Repo[] = REPOS, settings = { checkOnStart: true, allowOutside: false }) {
  api.listPlugins.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([
    ...Array.from({ length: 18 }, (_, index) => listed(`official-${index}`, OFFICIAL_URL)),
    listed("kafka-inspector", KAFKA_URL),
  ]);
  api.listRepos.mockResolvedValue(repos);
  api.pluginUpdates.mockResolvedValue([]);
  api.onInstallProgress.mockResolvedValue(() => {});
  api.repoSettings.mockResolvedValue(settings);
  api.setRepoSettings.mockImplementation(async (patch) => ({ ...settings, ...patch }));
  api.addRepo.mockResolvedValue({ url: "https://github.com/owner/repo", name: "Owner repo", enabled: true });
  api.removeRepo.mockResolvedValue(undefined);
  api.setRepoEnabled.mockResolvedValue({});
  api.syncRepos.mockResolvedValue(repos);
}

const renderTab = () => render(<PluginsPage tab="repositories" onTabChange={() => {}} />);
const tableRow = async (name: string) => within(await screen.findByRole("table", { name: "Repositories" })).getByText(name).closest('[role="row"]') as HTMLElement;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => mock.mockReset());
});
afterEach(() => {
  vi.restoreAllMocks();
  resetPlugins();
});

describe("syncedAgo", () => {
  it("words the age in the largest unit", () => {
    expect(syncedAgo(NOW - 20_000, NOW)).toBe("Synced just now");
    expect(syncedAgo(NOW - 10 * MIN, NOW)).toBe("Synced 10 min ago");
    expect(syncedAgo(NOW - 2 * HOUR, NOW)).toBe("Synced 2 h ago");
    expect(syncedAgo(NOW - 30 * HOUR, NOW)).toBe("Synced yesterday");
    expect(syncedAgo(NOW - 4 * 24 * HOUR, NOW)).toBe("Synced 4 days ago");
    expect(syncedAgo(NOW + MIN, NOW)).toBe("Synced just now");
  });

  it("drops the scheme from a repository address", () => {
    expect(repoAddress(OFFICIAL_URL)).toBe("github.com/kinan9011/shard-plugins");
  });
});

describe("Repositories tab: table", () => {
  it("shows the add row with the helper text from the design", async () => {
    arrange();
    renderTab();
    await tableRow("Shard Official");
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add repository" })).toBeDisabled();
    expect(
      screen.getByText("A repository either lists many plugins in an index.json, or is a single plugin published as GitHub Releases. Shard detects which."),
    ).toBeInTheDocument();
  });

  it("lists name, Official tag, address, type, count and status", async () => {
    arrange();
    renderTab();

    const official = await tableRow("Shard Official");
    expect(within(official).getByText("Official")).toBeInTheDocument();
    expect(within(official).getByText("github.com/kinan9011/shard-plugins")).toBeInTheDocument();
    expect(within(official).getByText("index.json")).toBeInTheDocument();
    expect(within(official).getByText("18 plugins")).toBeInTheDocument();
    expect(within(official).getByText("Synced 10 min ago")).toBeInTheDocument();

    const kafka = await tableRow("Kafka Inspector");
    expect(within(kafka).getByText("GitHub Releases")).toBeInTheDocument();
    expect(within(kafka).getByText("1 plugin")).toBeInTheDocument();
    expect(within(kafka).getByText("Synced yesterday")).toBeInTheDocument();
    expect(within(kafka).queryByText("Official")).not.toBeInTheDocument();
  });

  it("shows an error in the destructive colour, with a dash for the count", async () => {
    arrange();
    renderTab();
    const legacy = await tableRow("Legacy mirror");
    expect(within(legacy).getByText("index.json not found (404)").parentElement).toHaveClass("text-destructive");
    expect(within(legacy).getByText("–")).toBeInTheDocument();
    expect(within(legacy).getByRole("switch")).not.toBeChecked();
  });

  it("says a repository that never synced has not synced yet", async () => {
    arrange([{ url: ACME_URL, name: "Acme internal", enabled: true }]);
    renderTab();
    const row = await tableRow("Acme internal");
    expect(within(row).getByText("Not synced yet")).toBeInTheDocument();
    // No type and no count yet.
    expect(within(row).getAllByText("–")).toHaveLength(2);
  });

  it("gives the Official row a lock instead of a menu", async () => {
    arrange();
    renderTab();
    const official = await tableRow("Shard Official");
    expect(within(official).getByLabelText("The official repository can't be removed")).toBeInTheDocument();
    expect(within(official).queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    expect(within(official).getByRole("button", { name: "Sync Shard Official" })).toBeInTheDocument();
  });
});

describe("Repositories tab: row actions", () => {
  it("syncs one repository from the icon and reloads", async () => {
    arrange();
    renderTab();
    const acme = await tableRow("Acme internal");
    fireEvent.click(within(acme).getByRole("button", { name: "Sync Acme internal" }));
    await waitFor(() => expect(api.syncRepos).toHaveBeenCalledWith(ACME_URL));
    await waitFor(() => expect(api.listRepos).toHaveBeenCalledTimes(2));
  });

  it("reports a sync that ended in an error", async () => {
    arrange();
    api.syncRepos.mockResolvedValue(REPOS.map((repo) => (repo.url === ACME_URL ? { ...repo, lastError: "index.json not found (404)" } : repo)));
    renderTab();
    const acme = await tableRow("Acme internal");
    fireEvent.click(within(acme).getByRole("button", { name: "Sync Acme internal" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't sync Acme internal", { description: "index.json not found (404)" }));
  });

  it("turns a repository off and on with its switch", async () => {
    arrange();
    renderTab();
    const acme = await tableRow("Acme internal");
    fireEvent.click(within(acme).getByRole("switch"));
    await waitFor(() => expect(api.setRepoEnabled).toHaveBeenCalledWith(ACME_URL, false));
    await waitFor(() => expect(api.listRepos).toHaveBeenCalledTimes(2));

    const legacy = await tableRow("Legacy mirror");
    fireEvent.click(within(legacy).getByRole("switch"));
    await waitFor(() => expect(api.setRepoEnabled).toHaveBeenCalledWith(LEGACY_URL, true));
  });

  it("offers Sync now and Remove in the menu, and Retry after an error", async () => {
    arrange();
    renderTab();
    const acme = await tableRow("Acme internal");
    fireEvent.click(within(acme).getByRole("button", { name: "Actions for Acme internal" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Sync now" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    const legacy = await tableRow("Legacy mirror");
    fireEvent.click(within(legacy).getByRole("button", { name: "Actions for Legacy mirror" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Retry" }));
    await waitFor(() => expect(api.syncRepos).toHaveBeenCalledWith(LEGACY_URL));
  });

  it("removes a repository from the menu", async () => {
    arrange();
    renderTab();
    const kafka = await tableRow("Kafka Inspector");
    fireEvent.click(within(kafka).getByRole("button", { name: "Actions for Kafka Inspector" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(api.removeRepo).toHaveBeenCalledWith(KAFKA_URL));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Repository removed", { description: "Kafka Inspector" }));
    await waitFor(() => expect(api.listRepos).toHaveBeenCalledTimes(2));
  });

  it("shows why a switch or a removal failed", async () => {
    arrange();
    api.setRepoEnabled.mockRejectedValue(new Error("disk full"));
    renderTab();
    const acme = await tableRow("Acme internal");
    fireEvent.click(within(acme).getByRole("switch"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't turn off Acme internal", { description: "disk full" }));
  });
});

describe("Repositories tab: add", () => {
  it("adds the trimmed URL, clears the input and reloads", async () => {
    arrange();
    renderTab();
    await tableRow("Shard Official");
    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "  https://github.com/owner/repo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    await waitFor(() => expect(api.addRepo).toHaveBeenCalledWith("https://github.com/owner/repo"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Repository added", { description: "Owner repo" }));
    expect(input).toHaveValue("");
    await waitFor(() => expect(api.listRepos).toHaveBeenCalledTimes(2));
  });

  it("submits with Enter", async () => {
    arrange();
    renderTab();
    await tableRow("Shard Official");
    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/owner/repo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.addRepo).toHaveBeenCalledTimes(1));
  });

  it("keeps the input and shows the reason when the repository is refused", async () => {
    arrange();
    api.addRepo.mockRejectedValue(new Error("Not a plugin repository"));
    renderTab();
    await tableRow("Shard Official");
    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/owner/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't add the repository", { description: "Not a plugin repository" }));
    expect(input).toHaveValue("https://github.com/owner/nope");
  });
});

describe("Repositories tab: footer settings", () => {
  it("loads both switches from the settings", async () => {
    arrange(REPOS, { checkOnStart: false, allowOutside: true });
    renderTab();
    const check = await screen.findByRole("combobox", { name: "Check for updates" });
    await waitFor(() => expect(check).toHaveValue("manual"));
    expect(screen.getByRole("switch", { name: /Allow installs from zip files, folders and URLs outside these repositories/ })).toBeChecked();
  });

  it("saves the update check choice", async () => {
    arrange();
    renderTab();
    const check = await screen.findByRole("combobox", { name: "Check for updates" });
    await waitFor(() => expect(check).toHaveValue("start"));
    fireEvent.change(check, { target: { value: "manual" } });
    await waitFor(() => expect(api.setRepoSettings).toHaveBeenCalledWith({ checkOnStart: false }));
  });

  it("saves the outside-installs switch", async () => {
    arrange();
    renderTab();
    const allow = await screen.findByRole("switch", { name: /Allow installs from zip files/ });
    await waitFor(() => expect(allow).not.toBeDisabled());
    fireEvent.click(allow);
    await waitFor(() => expect(api.setRepoSettings).toHaveBeenCalledWith({ allowOutside: true }));
    expect(allow).toBeChecked();
  });

  it("puts the switch back and says why when saving fails", async () => {
    arrange();
    api.setRepoSettings.mockRejectedValue(new Error("read-only"));
    renderTab();
    const allow = await screen.findByRole("switch", { name: /Allow installs from zip files/ });
    await waitFor(() => expect(allow).not.toBeDisabled());
    fireEvent.click(allow);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't save the setting", { description: "read-only" }));
    expect(allow).not.toBeChecked();
  });
});
