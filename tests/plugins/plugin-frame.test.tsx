import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ listPlugins: vi.fn(), getPluginStorage: vi.fn(), setPluginStorage: vi.fn(), setPluginEnabled: vi.fn() }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/plugins/api", () => api);

import { PluginFrame } from "@/components/plugins/PluginFrame";
import { ToolHost } from "@/components/app/ToolHost";
import { resetPlugins } from "@/plugins/usePlugins";
import { pluginUrl } from "@/plugins/url";
import type { CatalogTool } from "@/app/catalog";

const hello = (enabled = true) => ({ id: "hello", enabled, manifest: { name: "Hello Plugin", entry: "pages/index.html" } });

beforeEach(() => {
  resetPlugins();
  api.listPlugins.mockReset();
  api.setPluginEnabled.mockReset();
  toastMock.error.mockReset();
});
afterEach(() => {
  resetPlugins();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pluginUrl", () => {
  it("uses the custom scheme, and the localhost form on Windows", () => {
    expect(pluginUrl("hello", "pages/index.html")).toBe("shard-plugin://hello/pages/index.html");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(pluginUrl("hello", "pages/index.html")).toBe("http://shard-plugin.localhost/hello/pages/index.html");
  });

  it("encodes each path segment and drops empty and leading slashes", () => {
    expect(pluginUrl("hello", "/a b/c#d.html")).toBe("shard-plugin://hello/a%20b/c%23d.html");
    expect(pluginUrl("hello", "sub/../../other/./index.html")).toBe("shard-plugin://hello/sub/other/index.html");
  });
});

describe("PluginFrame", () => {
  it("renders a frame whose sandbox is exactly allow-scripts", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const frame = await screen.findByTitle("Hello Plugin");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe("shard-plugin://hello/pages/index.html");
  });

  const fromFrame = (frame: HTMLIFrameElement, data: unknown) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow as MessageEventSource }));
      await Promise.resolve();
    });

  const crash = (frame: HTMLElement) => fromFrame(frame as HTMLIFrameElement, { v: 1, event: "error", message: "boom" });

  it("shows a loading state until the plugin finishes the SDK handshake", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    const { container } = render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const frame = (await screen.findByTitle("Hello Plugin")) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    expect(screen.getByText("Loading Hello Plugin…")).toBeInTheDocument();
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "loading");
    fireEvent.load(frame); // the page loaded, but the SDK has not answered yet
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "loading");
    await fromFrame(frame, { v: 1, id: "1", method: "ready" });
    expect(screen.queryByText("Loading Hello Plugin…")).not.toBeInTheDocument();
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "ready");
  });

  it("shows the crash screen when there is no handshake within 10 s, and Reload mounts a fresh frame", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const first = await screen.findByTitle("Hello Plugin");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_900);
    });
    expect(screen.queryByText("This plugin stopped working")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("This plugin stopped working");
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "crashed");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    const second = await screen.findByTitle("Hello Plugin");
    expect(second).not.toBe(first);
    expect(screen.getByText("Loading Hello Plugin…")).toBeInTheDocument();
  });

  it("shows the crash screen when the frame reports an error, even after the handshake", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const frame = (await screen.findByTitle("Hello Plugin")) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    await fromFrame(frame, { v: 1, id: "1", method: "ready" });
    await fromFrame(frame, { v: 1, event: "error", message: "boom" });
    expect(screen.getByRole("alert")).toHaveTextContent("This plugin stopped working");
  });

  it("recovers when a slow plugin says ready after the timeout, but not after an error", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const frame = (await screen.findByTitle("Hello Plugin")) as HTMLIFrameElement;
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "crashed");
    await fromFrame(frame, { v: 1, id: "1", method: "ready" });
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "ready");
    await fromFrame(frame, { v: 1, event: "error", message: "boom" });
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "crashed");
    await fromFrame(frame, { v: 1, id: "2", method: "ready" });
    expect(container.querySelector("[data-state]")).toHaveAttribute("data-state", "crashed");
  });

  it("Disable turns the plugin off and reloads the list; a failure shows a toast", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    api.setPluginEnabled.mockResolvedValue({});
    render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    await crash(await screen.findByTitle("Hello Plugin"));
    api.listPlugins.mockResolvedValue([hello(false)]);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(api.setPluginEnabled).toHaveBeenCalledWith("hello", false));
    expect(await screen.findByText("Hello Plugin is not installed or is turned off.")).toBeInTheDocument();
  });

  it("keeps the crash screen and toasts when Disable fails", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    api.setPluginEnabled.mockRejectedValue(new Error("disk full"));
    render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    await crash(await screen.findByTitle("Hello Plugin"));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("tells the plugin when its tab is hidden or shown again", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    const tool: CatalogTool = { id: "hello", name: "Hello Plugin", category: "Plugins", keywords: [], icon: (() => null) as never, source: "plugin", pluginId: "hello" };
    const { rerender } = render(<ToolHost tools={[tool]} selectedId="hello" />);
    const frame = (await screen.findByTitle("Hello Plugin")) as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    await fromFrame(frame, { v: 1, id: "1", method: "ready" });
    expect(post.mock.calls[0][0]).toMatchObject({ result: { visible: true } });
    rerender(<ToolHost tools={[tool]} selectedId={null} />);
    expect(post.mock.calls.at(-1)![0]).toEqual({ v: 1, event: "visibility", data: { visible: false } });
    rerender(<ToolHost tools={[tool]} selectedId="hello" />);
    expect(post.mock.calls.at(-1)![0]).toEqual({ v: 1, event: "visibility", data: { visible: true } });
  });

  it("answers SDK calls from its own frame only, and stops when unmounted", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    const { unmount } = render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    const frame = (await screen.findByTitle("Hello Plugin")) as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    const call = (source: Window | null, id: string) =>
      window.dispatchEvent(new MessageEvent("message", { data: { v: 1, id, method: "ready" }, source: source as MessageEventSource }));

    call(window, "from-app");
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();

    call(frame.contentWindow, "from-frame");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toMatchObject({ v: 1, id: "from-frame", result: { pluginId: "hello" } });

    unmount();
    call(frame.contentWindow, "after-unmount");
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("says so when the plugin is not installed or is turned off", async () => {
    api.listPlugins.mockResolvedValue([hello(false)]);
    render(<PluginFrame pluginId="hello" name="Hello Plugin" />);
    expect(await screen.findByText("Hello Plugin is not installed or is turned off.")).toBeInTheDocument();
    expect(screen.queryByTitle("Hello Plugin")).not.toBeInTheDocument();
  });
});

describe("ToolHost", () => {
  it("renders a plugin tool as a sandboxed frame that fills the panel", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    const tool: CatalogTool = { id: "hello", name: "Hello Plugin", category: "Plugins", keywords: [], icon: (() => null) as never, source: "plugin", pluginId: "hello" };
    const { container } = render(<ToolHost tools={[tool]} selectedId="hello" />);
    await waitFor(() => expect(screen.getByTitle("Hello Plugin")).toHaveAttribute("sandbox", "allow-scripts"));
    expect(container.querySelector("section.tool-panel")).toHaveClass("tool-panel-editor");
  });

  it("marks a hidden plugin panel inert, and leaves a hidden built-in tool alone", async () => {
    api.listPlugins.mockResolvedValue([hello()]);
    const plugin: CatalogTool = { id: "hello", name: "Hello Plugin", category: "Plugins", keywords: [], icon: (() => null) as never, source: "plugin", pluginId: "hello" };
    const builtin: CatalogTool = { id: "nothing", name: "Nothing", category: "Other", keywords: [], icon: (() => null) as never, source: "builtin" } as CatalogTool;
    const { container, rerender } = render(<ToolHost tools={[plugin, builtin]} selectedId="nothing" />);
    expect(container.querySelector("#panel-hello")).toHaveAttribute("inert");
    expect(container.querySelector("#panel-nothing")).not.toHaveAttribute("inert");
    rerender(<ToolHost tools={[plugin, builtin]} selectedId="hello" />);
    expect(container.querySelector("#panel-hello")).not.toHaveAttribute("inert");
  });
});
