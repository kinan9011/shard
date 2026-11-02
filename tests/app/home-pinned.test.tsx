import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
  syncRepos: vi.fn(),
  onInstallProgress: vi.fn(),
  onPluginUpdates: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import Shard from "@/app/Shard";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const pinnedIds = () => JSON.parse(localStorage.getItem("shard-pinned") ?? "null") as string[] | null;
const main = () => screen.getByRole("main");
const tiles = () => within(main()).getAllByRole("group").map((tile) => tile.getAttribute("aria-label"));

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => typeof mock === "function" && "mockReset" in mock && mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([{ url: "https://github.com/kinan9011/shard-plugins", name: "Shard Official", enabled: true, official: true }]);
  api.repoCatalog.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
  api.syncRepos.mockResolvedValue([]);
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

describe("Home pinned tools", () => {
  it("reorders a tile with Alt+Arrow and saves the order", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "code-playground", "regex-generator"]));
    render(<Shard />);

    fireEvent.click(await within(main()).findByRole("button", { name: "Edit" }));
    expect(within(main()).getByText("Drag to reorder")).toBeInTheDocument();
    expect(tiles()).toEqual(["JSON Viewer", "Code Playground", "Regex Tester"]);

    const first = within(main()).getByRole("group", { name: "JSON Viewer" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(tiles()).toEqual(["Code Playground", "JSON Viewer", "Regex Tester"]));
    expect(pinnedIds()).toEqual(["code-playground", "json-viewer", "regex-generator"]);
    // Focus stays on the moved tile, so the next key press moves it again.
    await waitFor(() => expect(within(main()).getByRole("group", { name: "JSON Viewer" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(tiles()).toEqual(["JSON Viewer", "Code Playground", "Regex Tester"]));

    // Without Alt the arrows do nothing.
    fireEvent.keyDown(within(main()).getByRole("group", { name: "JSON Viewer" }), { key: "ArrowDown" });
    expect(tiles()).toEqual(["JSON Viewer", "Code Playground", "Regex Tester"]);
  });

  it("reorders by dragging and removes with ×", async () => {
    localStorage.setItem("shard-pinned", JSON.stringify(["json-viewer", "code-playground", "regex-generator"]));
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Edit" }));

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(within(main()).getByRole("group", { name: "JSON Viewer" }), { dataTransfer });
    fireEvent.dragOver(within(main()).getByRole("group", { name: "Regex Tester" }), { dataTransfer });
    fireEvent.dragEnd(within(main()).getByRole("group", { name: "JSON Viewer" }));
    expect(tiles()).toEqual(["Code Playground", "Regex Tester", "JSON Viewer"]);

    fireEvent.click(within(main()).getByRole("button", { name: "Unpin Regex Tester" }));
    expect(tiles()).toEqual(["Code Playground", "JSON Viewer"]);
    expect(pinnedIds()).toEqual(["code-playground", "json-viewer"]);

    fireEvent.click(within(main()).getByRole("button", { name: "Done" }));
    expect(within(main()).queryByText("Drag to reorder")).not.toBeInTheDocument();
    expect(within(main()).getByRole("button", { name: "Code Playground" })).toBeInTheDocument();
  });

  it("stops at 12 pinned tools", async () => {
    // The 9 built-in tools and 3 ported tools (kept in the list while their plugin is not installed) fill the 12 slots.
    const entry = (id: string, name: string) => ({ id, name, version: "1.0.0", description: "Test.", category: "Development", runtime: "web", url: "https://example.test/p.zip", sha256: "0".repeat(64), repo: "https://github.com/kinan9011/shard-plugins", repoName: "Shard Official", permissions: [] });
    const extra = entry("extra-tool", "Extra Tool");
    api.repoCatalog.mockResolvedValue([extra]);
    const twelve = [...ALL_TOOLS.map((tool) => tool.id), "base64", "qr-reader", "token-counter"];
    localStorage.setItem("shard-pinned", JSON.stringify(twelve));
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Edit" }));
    fireEvent.click(within(main()).getByRole("button", { name: "Add tool" }));

    const picker = await screen.findByRole("dialog");
    expect(within(picker).getByText("12 of 12 pinned · Enter to pin")).toBeInTheDocument();
    fireEvent.click(await within(picker).findByRole("option", { name: new RegExp(extra.name) }));
    expect(toastMock.error).toHaveBeenCalledWith("You can pin up to 12 tools. Unpin one first.");
    expect(pinnedIds()).toEqual(twelve);
  });

  it("searches the picker and pins with Enter", async () => {
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Pin tools to Home" }));

    const picker = await screen.findByRole("dialog");
    const search = within(picker).getByRole("combobox", { name: "Search tools to pin" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "regex tester" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(pinnedIds()).toEqual(["regex-generator"]);
    expect(within(picker).getByText("1 of 12 pinned · Enter to pin")).toBeInTheDocument();
  });

  it("installs a not-installed plugin from the picker and pins it", async () => {
    const entry = { id: "cron-builder", name: "Cron Builder", version: "1.0.3", description: "Hashes.", category: "Security", runtime: "web", url: "https://example.test/h.zip", sha256: "0".repeat(64), repo: "https://github.com/kinan9011/shard-plugins", repoName: "Shard Official", permissions: [] };
    api.repoCatalog.mockResolvedValue([entry]);
    api.installFromRepo.mockImplementation(async () => {
      api.listPlugins.mockResolvedValue([{ id: "cron-builder", enabled: true, source: { kind: "repo" }, manifest: { name: "Cron Builder", category: "Security", keywords: [], entry: "index.html" } }]);
      return {};
    });
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Pin tools to Home" }));

    const picker = await screen.findByRole("dialog");
    const row = await within(picker).findByRole("option", { name: /Cron Builder/ });
    expect(within(row).getByText("Not installed")).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: /JSON Viewer/ })).toHaveTextContent("Built-in");
    fireEvent.click(row);

    // A plugin that asks for nothing installs without the permission dialog.
    await waitFor(() => expect(api.installFromRepo).toHaveBeenCalledWith(entry.repo, "cron-builder"));
    await waitFor(() => expect(pinnedIds()).toEqual(["cron-builder"]));
    expect(toastMock.success).toHaveBeenCalledWith("Installed", expect.anything());
    await waitFor(() => expect(tiles()).toEqual(["Cron Builder"]));
  });

  it("asks for permissions before installing a plugin that needs them", async () => {
    const entry = { id: "kafka-inspector", name: "Kafka Inspector", version: "0.3.1", description: "Kafka.", category: "Development", runtime: "web", url: "https://example.test/k.zip", sha256: "0".repeat(64), repo: "https://github.com/kinan9011/shard-plugins", repoName: "Shard Official", permissions: [{ name: "clipboard:write", reason: "Copy messages" }] };
    api.repoCatalog.mockResolvedValue([entry]);
    api.installFromRepo.mockResolvedValue({});
    api.setPluginGrants.mockResolvedValue({});
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Pin tools to Home" }));

    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("option", { name: /Kafka Inspector/ }));
    expect(api.installFromRepo).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(pinnedIds()).toEqual(["kafka-inspector"]));
    expect(api.setPluginGrants).toHaveBeenCalled();
  });

  it("does not pin a plugin whose install fails", async () => {
    const entry = { id: "cron-builder", name: "Cron Builder", version: "1.0.3", description: "Hashes.", category: "Security", runtime: "web", url: "https://example.test/h.zip", sha256: "0".repeat(64), repo: "https://github.com/kinan9011/shard-plugins", repoName: "Shard Official", permissions: [] };
    api.repoCatalog.mockResolvedValue([entry]);
    api.installFromRepo.mockRejectedValue(new Error("HTTP 500"));
    render(<Shard />);
    fireEvent.click(await within(main()).findByRole("button", { name: "Pin tools to Home" }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("option", { name: /Cron Builder/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(pinnedIds() ?? []).toEqual([]);
  });
});
