import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
  onInstallProgress: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { PluginsPage } from "@/components/plugins/PluginsPage";
import { PermissionDialog } from "@/components/plugins/PermissionDialog";
import { permissionRows } from "@/plugins/permissions";
import { describeInstallError, grantsFor } from "@/plugins/useInstallFlow";
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
  repo: KAFKA_REPO,
  repoName: "kinan9011",
  size: 2516582,
  permissions: [
    { name: "network", hosts: ["localhost:9092"], reason: "Connect to localhost:9092 and brokers you add" },
    { name: "files:open", reason: "Read files you open in the tool" },
    { name: "clipboard:write", reason: "Copy decoded messages", optional: true },
  ],
});
const CRON = entry("cron-builder", "Cron Builder", { version: "1.1.0" });

type ProgressCallback = (progress: { id: string; received: number; total: number | null }) => void;
let emitProgress: ProgressCallback = () => {};
const unlisten = vi.fn();

function arrange() {
  api.listPlugins.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([CRON, KAFKA]);
  api.listRepos.mockResolvedValue([
    { url: OFFICIAL, name: "Shard Official", enabled: true, official: true },
    { url: KAFKA_REPO, name: "kinan9011", enabled: true },
  ]);
  api.pluginUpdates.mockResolvedValue([]);
  api.installFromRepo.mockResolvedValue({ id: "kafka-inspector" });
  api.setPluginGrants.mockResolvedValue({ id: "kafka-inspector" });
  api.onInstallProgress.mockImplementation(async (callback: ProgressCallback) => {
    emitProgress = callback;
    return unlisten;
  });
}

const rowFor = async (name: string) => (await screen.findByText(name)).closest("[data-plugin-row]") as HTMLElement;
const dialog = () => screen.getByRole("dialog", { name: "Allow Kafka Inspector to:" });

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => mock.mockReset());
  unlisten.mockReset();
});
afterEach(() => resetPlugins());

describe("grantsFor", () => {
  const rows = permissionRows(KAFKA);
  it("keeps every required name and the optional ones that are on, and skips the WASM row", () => {
    expect(grantsFor(rows, new Set(["clipboard"]))).toEqual(["network", "files:open", "clipboard:write"]);
    expect(grantsFor(rows, new Set())).toEqual(["network", "files:open"]);
  });
});

describe("describeInstallError", () => {
  it("names a checksum mismatch", () => {
    expect(describeInstallError("Kafka Inspector", "The checksum does not match. Expected aa, the file is bb.").title).toBe("Checksum doesn't match");
  });
  it("names a newer-app requirement", () => {
    const { title, description } = describeInstallError("Kafka Inspector", "Requires Shard 9.0.0");
    expect(title).toBe("Needs a newer Shard");
    expect(description).toContain("9.0.0");
  });
  it("names a network failure", () => {
    expect(describeInstallError("Kafka Inspector", "The request timed out").title).toBe("Download failed");
    expect(describeInstallError("Kafka Inspector", "HTTP 503").title).toBe("Download failed");
  });
  it("falls back to the plugin name and the message", () => {
    expect(describeInstallError("Kafka Inspector", "Disk full")).toEqual({ title: "Couldn't install Kafka Inspector", description: "Disk full" });
  });
});

describe("PermissionDialog", () => {
  it("shows the design copy for a third-party plugin from a repository", () => {
    render(<PermissionDialog entry={KAFKA} official={false} verified onCancel={() => {}} onConfirm={() => {}} />);
    const box = within(dialog());
    expect(box.getByText("Allow Kafka Inspector to:")).toBeInTheDocument();
    expect(box.getByText("Version 0.3.1 from github.com/kinan9011/kafka-inspector")).toBeInTheDocument();
    expect(box.getAllByText("Required")).toHaveLength(3);
    expect(box.getByRole("switch", { name: "Clipboard" })).toBeChecked();
    expect(box.getByText("SHA-256 checksum matches the release.")).toBeInTheDocument();
    expect(box.getByText("Third-party plugin. It isn't listed in the Shard Official repository.")).toBeInTheDocument();
    expect(box.getByText("Optional permissions can be changed later in Installed.")).toBeInTheDocument();
    expect(box.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(box.getByRole("button", { name: "Allow and install" })).toBeInTheDocument();
  });

  it("warns about an unverified package and leaves out the third-party line for the official repository", () => {
    render(<PermissionDialog entry={KAFKA} official verified={false} onCancel={() => {}} onConfirm={() => {}} />);
    const box = within(dialog());
    expect(box.queryByText("SHA-256 checksum matches the release.")).not.toBeInTheDocument();
    expect(box.getByText(/Unverified/)).toBeInTheDocument();
    expect(box.queryByText(/Third-party plugin/)).not.toBeInTheDocument();
  });

  it("confirms with the switched-on optional permissions, and cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<PermissionDialog entry={KAFKA} official={false} verified onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(within(dialog()).getByRole("switch", { name: "Clipboard" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Allow and install" }));
    expect(onConfirm).toHaveBeenCalledWith(["network", "files:open"]);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("the install flow", () => {
  it("asks first, installs from the repository, then saves the grants and toasts with Open", async () => {
    arrange();
    const onOpenPlugin = vi.fn();
    render(<PluginsPage tab="browse" onTabChange={() => {}} onOpenPlugin={onOpenPlugin} />);
    fireEvent.click(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Install" }));
    expect(api.installFromRepo).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("switch", { name: "Clipboard" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Allow and install" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(api.installFromRepo).toHaveBeenCalledWith(KAFKA_REPO, "kafka-inspector");
    expect(api.setPluginGrants).toHaveBeenCalledWith("kafka-inspector", ["network", "files:open"]);
    expect(api.installFromRepo.mock.invocationCallOrder[0]).toBeLessThan(api.setPluginGrants.mock.invocationCallOrder[0]!);
    const [title, options] = toastMock.success.mock.calls[0]!;
    expect(title).toBe("Installed");
    expect(options.description).toBe("Kafka Inspector");
    options.action.onClick();
    expect(onOpenPlugin).toHaveBeenCalledWith("kafka-inspector");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("installs nothing when the dialog is cancelled", async () => {
    arrange();
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Install" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.installFromRepo).not.toHaveBeenCalled();
  });

  it("skips the dialog for a plugin that asks for nothing, and saves no grants", async () => {
    arrange();
    api.installFromRepo.mockResolvedValue({ id: "cron-builder" });
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(within(await rowFor("Cron Builder")).getByRole("button", { name: "Install" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.installFromRepo).toHaveBeenCalledWith(OFFICIAL, "cron-builder");
    expect(api.setPluginGrants).not.toHaveBeenCalled();
  });

  it("shows the download progress on the row and ignores other plugins' events", async () => {
    arrange();
    let finish: (value: unknown) => void = () => {};
    api.installFromRepo.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    const row = await rowFor("Kafka Inspector");
    fireEvent.click(within(row).getByRole("button", { name: "Install" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Allow and install" }));
    const busy = await within(row).findByRole("button", { name: /Installing/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent("Installing…");
    act(() => emitProgress({ id: "cron-builder", received: 10, total: 100 }));
    expect(busy).toHaveTextContent("Installing…");
    act(() => emitProgress({ id: "kafka-inspector", received: 50, total: 100 }));
    expect(busy).toHaveTextContent("Installing… 50%");
    await act(async () => finish({ id: "kafka-inspector" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it.each([
    ["The checksum does not match. Expected aa, the file is bb.", "Checksum doesn't match"],
    ["The request timed out", "Download failed"],
    ["Requires Shard 9.0.0", "Needs a newer Shard"],
  ])("reports %s as an error toast and installs no grants", async (message, title) => {
    arrange();
    api.installFromRepo.mockRejectedValue(message);
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Install" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0]![0]).toBe(title);
    expect(api.setPluginGrants).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    // The button is usable again.
    expect(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Install" })).toBeEnabled();
  });

  it("says so when the plugin installed but its permissions could not be saved", async () => {
    arrange();
    api.setPluginGrants.mockRejectedValue("disk full");
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Install" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0]![0]).toBe("Installed, but permissions weren't saved");
  });

  it("installs from the detail pane too, and stops listening on unmount", async () => {
    arrange();
    const { unmount } = render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(within(await rowFor("Kafka Inspector")).getByRole("button", { name: "Kafka Inspector" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Plugin details" })).getByRole("button", { name: "Install" }));
    expect(dialog()).toBeInTheDocument();
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
