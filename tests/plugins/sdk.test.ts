import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPluginStorage: vi.fn(), setPluginStorage: vi.fn(), pluginFetch: vi.fn(), pluginOpenFile: vi.fn() }));
vi.mock("@/plugins/api", () => api);
const desktop = vi.hoisted(() => ({ readClipboardText: vi.fn(), writeClipboardText: vi.fn(), saveFile: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);
const toastMock = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { connect, PermissionError, SdkError } from "../../packages/plugin-sdk/src/index";
import { setLanguage } from "@/i18n";
import { attachBridge, notifyLocaleChanged, notifyThemeChanged, notifyVisibilityChanged, sendInputToPlugin } from "@/plugins/bridge";

// Two real jsdom windows: the app (`window`) and a plugin frame. jsdom's postMessage does not set
// `event.source`, so each side's postMessage is replaced by one that does. Both ends run their real code.
let frame: HTMLIFrameElement;
let pluginWindow: Window;
const originalPostMessage = window.postMessage;

function deliver(to: Window, from: Window, data: unknown) {
  queueMicrotask(() => to.dispatchEvent(new MessageEvent("message", { data, source: from as MessageEventSource })));
}

let detach: () => void;
let grants: string[] = [];
beforeEach(() => {
  grants = [];
  Object.values(api).forEach((fn) => fn.mockReset());
  Object.values(desktop).forEach((fn) => fn.mockReset());
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  document.documentElement.className = "";
  document.documentElement.setAttribute("data-scheme", "default");
  frame = document.createElement("iframe");
  document.body.appendChild(frame);
  pluginWindow = frame.contentWindow!;
  const post = (target: Window, send: (data: unknown) => void) => {
    (target as { postMessage: unknown }).postMessage = send;
  };
  post(window, (data) => deliver(window, pluginWindow, data));
  post(pluginWindow, (data) => deliver(pluginWindow, window, data));
  detach = attachBridge(frame, { id: "hello", name: "Hello Plugin", granted: () => grants });
});
afterEach(() => {
  detach();
  frame.remove();
  window.postMessage = originalPostMessage;
  vi.useRealTimers();
});

const sdk = (options = {}) => connect({ self: pluginWindow, target: window, ...options });

describe("plugin SDK against the host bridge", () => {
  it("ready resolves with the plugin id and the theme", async () => {
    document.documentElement.classList.add("dark");
    const info = await sdk().ready();
    expect(info.pluginId).toBe("hello");
    expect(info.theme).toMatchObject({ isDark: true, scheme: "default" });
  });

  it("stores, reads and removes values", async () => {
    const db = new Map<string, unknown>();
    api.setPluginStorage.mockImplementation(async (_id, key, value) => void (value === null ? db.delete(key) : db.set(key, value)));
    api.getPluginStorage.mockImplementation(async (_id, key) => db.get(key) ?? null);
    const client = sdk();
    expect(await client.storage.get("n")).toBeNull();
    await client.storage.set("n", { count: 3 });
    expect(await client.storage.get("n")).toEqual({ count: 3 });
    await client.storage.remove("n");
    expect(await client.storage.get("n")).toBeNull();
  });

  it("shows a toast", async () => {
    await sdk().toast("Saved", "success");
    expect(toastMock.success).toHaveBeenCalledWith("Saved", { description: "Hello Plugin" });
  });

  it("rejects with an SdkError when the host refuses", async () => {
    const error = await sdk().toast("x", "loud" as never).catch((e) => e);
    expect(error).toBeInstanceOf(SdkError);
    expect(error.code).toBe("bad_request");
  });

  it("a call without the grant rejects with a PermissionError that names the permission", async () => {
    const error = await sdk().clipboard.writeText("x").catch((e) => e);
    expect(error).toBeInstanceOf(PermissionError);
    expect(error).toBeInstanceOf(SdkError);
    expect(error.code).toBe("permission_denied");
    expect(error.permission).toBe("clipboard:write");
    expect(desktop.writeClipboardText).not.toHaveBeenCalled();
  });

  it("clipboard, files and net work once granted", async () => {
    grants = ["clipboard:read", "clipboard:write", "files:open", "files:save", "network"];
    desktop.readClipboardText.mockResolvedValue("clip");
    desktop.writeClipboardText.mockResolvedValue(undefined);
    desktop.saveFile.mockResolvedValue(true);
    api.pluginOpenFile.mockResolvedValue({ name: "a.json", size: 7, bytes: new TextEncoder().encode('{"a":1}') });
    api.pluginFetch.mockResolvedValue({ status: 201, statusText: "Created", headers: { "x-a": "b" }, url: "http://localhost:9092/", body: new TextEncoder().encode('{"ok":true}') });
    const client = sdk();
    expect(await client.clipboard.readText()).toBe("clip");
    await client.clipboard.writeText("copied");
    expect(desktop.writeClipboardText).toHaveBeenCalledWith("copied");
    expect(await client.files.open({ accept: ["json"] })).toEqual({ name: "a.json", size: 7, text: '{"a":1}' });
    expect(await client.files.save("out.txt", "data")).toBe(true);
    const response = await client.net.fetch("http://localhost:9092/", { method: "POST", body: "{}" });
    expect(response).toMatchObject({ status: 201, ok: true, statusText: "Created", headers: { "x-a": "b" } });
    expect(response.text()).toBe('{"ok":true}');
    expect(response.json()).toEqual({ ok: true });
  });

  it("net.fetch reports ok false for an error status", async () => {
    grants = ["network"];
    api.pluginFetch.mockResolvedValue({ status: 404, statusText: "Not Found", headers: {}, url: "http://localhost/", body: new Uint8Array() });
    expect((await sdk().net.fetch("http://localhost/")).ok).toBe(false);
  });

  it("rejects storage.set(undefined) and storage.set(null) before sending anything", async () => {
    await expect(sdk().storage.set("k", undefined)).rejects.toThrow(TypeError);
    await expect(sdk().storage.set("k", null)).rejects.toThrow(TypeError);
    expect(api.setPluginStorage).not.toHaveBeenCalled();
  });

  it("delivers theme changes to onChange until unsubscribed", async () => {
    const client = sdk();
    const seen: boolean[] = [];
    const stop = client.theme.onChange((theme) => seen.push(theme.isDark));
    await client.ready();
    document.documentElement.classList.add("dark");
    notifyThemeChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    document.documentElement.classList.remove("dark");
    notifyThemeChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([true]);
  });

  it("gives the language at the handshake, on request, and on change until unsubscribed", async () => {
    await setLanguage("he");
    const client = sdk();
    const seen: string[] = [];
    const stop = client.locale.onChange((locale) => seen.push(`${locale.lang}:${locale.dir}`));
    const info = await client.ready();
    expect(info.locale).toEqual({ lang: "he", dir: "rtl" });
    await setLanguage("fr");
    notifyLocaleChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await client.locale.get()).toEqual({ lang: "fr", dir: "ltr" });
    stop();
    await setLanguage("de");
    notifyLocaleChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["fr:ltr"]);
  });

  it("keeps calling the other onChange callbacks when one throws", async () => {
    const client = sdk();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: boolean[] = [];
    client.theme.onChange(() => {
      throw new Error("boom");
    });
    client.theme.onChange((theme) => seen.push(theme.isDark));
    await client.ready();
    notifyThemeChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([false]);
    error.mockRestore();
  });

  it("times out when the host never answers", async () => {
    detach(); // no bridge: nobody replies
    vi.useFakeTimers();
    const pending = sdk({ timeoutMs: 500 }).ready();
    const outcome = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(501);
    const error = await outcome;
    expect(error).toBeInstanceOf(SdkError);
    expect(error.code).toBe("timeout");
    detach = () => {};
  });

  it("ignores a response from a window that is not the host", async () => {
    detach();
    detach = () => {};
    let requestId = "";
    (window as { postMessage: unknown }).postMessage = (data: { id: string }) => void (requestId = data.id); // capture the request, answer by hand
    const call = sdk().theme.get();
    const other = document.createElement("iframe");
    document.body.appendChild(other);
    const answer = (source: Window | null) =>
      pluginWindow.dispatchEvent(new MessageEvent("message", { data: { v: 1, id: requestId, result: { isDark: true } }, source: source as MessageEventSource }));
    answer(other.contentWindow);
    answer(null);
    let settled = false;
    call.then(() => (settled = true), () => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    answer(window);
    await expect(call).resolves.toMatchObject({ isDark: true });
    other.remove();
  });

  it("reports visibility in ready and delivers changes to onVisibilityChange until unsubscribed", async () => {
    const client = sdk();
    const seen: boolean[] = [];
    const stop = client.onVisibilityChange((visible) => seen.push(visible));
    expect((await client.ready()).visible).toBe(true);
    notifyVisibilityChanged("hello", false);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([false]);
    stop();
    notifyVisibilityChanged("hello", true);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([false]);
  });

  it("delivers text sent from the app to onInput until unsubscribed", async () => {
    const client = sdk();
    const seen: string[] = [];
    const stop = client.onInput((text) => seen.push(text));
    await client.ready();
    sendInputToPlugin("hello", "one");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["one"]);
    stop();
    sendInputToPlugin("hello", "two");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["one"]);
  });

  it("holds text that arrives before onInput is registered and gives it to the first listener once", async () => {
    const client = sdk();
    // Sent before the frame is ready: the app hands it over at the handshake, before the plugin can register.
    sendInputToPlugin("hello", "waiting");
    await client.ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first: string[] = [];
    const second: string[] = [];
    client.onInput((text) => first.push(text));
    client.onInput((text) => second.push(text));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first).toEqual(["waiting"]);
    expect(second).toEqual([]);
  });

  it("ignores an input event whose text is not a string, and one from another window", async () => {
    const client = sdk();
    const seen: string[] = [];
    client.onInput((text) => seen.push(text));
    pluginWindow.dispatchEvent(new MessageEvent("message", { data: { v: 1, event: "input", data: { text: 5 } }, source: window as MessageEventSource }));
    pluginWindow.dispatchEvent(new MessageEvent("message", { data: { v: 1, event: "input", data: { text: "spoof" } }, source: pluginWindow as MessageEventSource }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
  });

  it("tells the host about an uncaught error in the plugin", () => {
    const postMessage = vi.fn();
    connect({ self: pluginWindow, target: { postMessage } as unknown as Window });
    pluginWindow.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(postMessage).toHaveBeenCalledWith({ v: 1, event: "error", message: "boom" }, "*");
  });
});
