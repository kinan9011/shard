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
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
}));
vi.mock("@/plugins/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/plugins/api")>()), ...api }));

const bridgeMock = vi.hoisted(() => ({ sendInputToPlugin: vi.fn(() => true) }));
vi.mock("@/plugins/bridge", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/plugins/bridge")>()), ...bridgeMock }));

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import Shard from "@/app/Shard";
import { SendToMenu, SendToProvider } from "@/components/tools/SendToMenu";
import { resetPlugins } from "@/plugins/usePlugins";
import { resetPluginUpdates } from "@/plugins/usePluginUpdates";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

const uuidPlugin = {
  id: "uuid-generator",
  enabled: true,
  source: { kind: "zip" },
  manifest: { name: "UUID Generator", category: "Development Tools", keywords: [], entry: "index.html" },
} as never;

const paste = (text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  act(() => {
    document.body.dispatchEvent(event);
  });
};

/** A suggestion appears only once the installed plugins are known, so paste again until it does. */
const pasteUntilSuggested = (text: string, suggestion: RegExp) =>
  waitFor(() => {
    paste(text);
    expect(screen.getByText(suggestion)).toBeInTheDocument();
  });

beforeEach(() => {
  resetPlugins();
  resetPluginUpdates();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => typeof mock === "function" && "mockReset" in mock && mock.mockReset());
  bridgeMock.sendInputToPlugin.mockClear();
  api.listPlugins.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
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
  resetPlugins();
  resetPluginUpdates();
});

const panelField = (toolId: string) => document.querySelector<HTMLTextAreaElement>(`#panel-${toolId} textarea`);

describe("Send to… between tools", () => {
  it("sends a decoded JWT payload to the JSON Viewer", async () => {
    render(<Shard />);
    paste(JWT);
    await screen.findByText("Looks like a JWT.");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(panelField("jwt-decoder")).toHaveValue(JWT));

    fireEvent.click(await screen.findByRole("button", { name: "Send payload to…" }));
    fireEvent.click(within(screen.getByRole("list", { name: "Send payload to…" })).getByRole("button", { name: /JSON Viewer/ }));

    expect(await screen.findByRole("tab", { name: /JSON Viewer/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(panelField("json-viewer")).toHaveValue('{\n  "sub": "1234567890"\n}'));
  });

  it("never offers a tool as a target for its own output, and fills the one picked", async () => {
    render(<Shard />);
    paste('{"a": 1}');
    await screen.findByText("Looks like JSON.");
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(panelField("json-viewer")).toHaveValue('{"a": 1}'));

    fireEvent.click(await screen.findByRole("button", { name: "Send to…" }));
    const list = screen.getByRole("list", { name: "Send to…" });
    expect(within(list).queryByRole("button", { name: /JSON Viewer/ })).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: /JSON to Code/ }));

    await waitFor(() => expect(panelField("json-typescript")).not.toBeNull());
    await waitFor(() => expect(JSON.parse(panelField("json-typescript")!.value)).toEqual({ a: 1 }));
  });

  it("hands text to an installed plugin through the bridge instead of filling a field", async () => {
    api.listPlugins.mockResolvedValue([uuidPlugin]);
    render(<Shard />);
    await pasteUntilSuggested(UUID, /Looks like a UUID/);
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(bridgeMock.sendInputToPlugin).toHaveBeenCalledWith("uuid-generator", UUID));
  });

  it("keeps the pasted text through a paste-install and gives it to the plugin when it is opened", async () => {
    api.installFromRepo.mockImplementation(async () => {
      api.listPlugins.mockResolvedValue([uuidPlugin]);
    });
    render(<Shard />);
    await pasteUntilSuggested(UUID, /Looks like a UUID/);
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    // The install is done, the plugin is in the catalog, and nothing was sent while the user had not opened it.
    expect(bridgeMock.sendInputToPlugin).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listPlugins.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {});
    const open = toastMock.success.mock.calls[0][1].action as { label: string; onClick: () => void };
    expect(open.label).toBe("Open");
    act(() => open.onClick());
    expect(bridgeMock.sendInputToPlugin).toHaveBeenCalledWith("uuid-generator", UUID);
  });
});

describe("SendToMenu", () => {
  const api = (targets: { toolId: string; name: string; what: string }[]) => ({ send: vi.fn(), targets: vi.fn(() => targets) });

  it("renders nothing outside the shell", () => {
    const { container } = render(<SendToMenu text="x" from="a" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when no tool recognises the text, and closes with Escape", () => {
    render(
      <SendToProvider value={api([])}>
        <SendToMenu text="plain words" from="a" />
      </SendToProvider>,
    );
    const button = screen.getByRole("button", { name: "Send to…" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("No installed tool recognises this text.")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("No installed tool recognises this text.")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("looks for targets only when opened, sends the picked tool the text, and is off for empty text", () => {
    const provided = api([{ toolId: "b", name: "Tool B", what: "JSON" }]);
    const { rerender } = render(
      <SendToProvider value={provided}>
        <SendToMenu text="payload" from="a" />
      </SendToProvider>,
    );
    expect(provided.targets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send to…" }));
    fireEvent.click(screen.getByRole("button", { name: /Tool B/ }));
    expect(provided.send).toHaveBeenCalledWith("b", "payload");
    expect(screen.queryByRole("list")).toBeNull();

    rerender(
      <SendToProvider value={provided}>
        <SendToMenu text="   " from="a" />
      </SendToProvider>,
    );
    expect(screen.getByRole("button", { name: "Send to…" })).toBeDisabled();
  });
});
