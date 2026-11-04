import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPluginStorage: vi.fn(), setPluginStorage: vi.fn(), pluginFetch: vi.fn(), pluginOpenFile: vi.fn() }));
vi.mock("@/plugins/api", () => api);
const desktop = vi.hoisted(() => ({ readClipboardText: vi.fn(), writeClipboardText: vi.fn(), saveFile: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);
const toastMock = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { setLanguage } from "@/i18n";
import { attachBridge, INPUT_TTL_MS, MAX_INPUT_CHARS, notifyLocaleChanged, notifyThemeChanged, notifyVisibilityChanged, sendInputToPlugin, themeSnapshot } from "@/plugins/bridge";

interface Reply {
  v: number;
  id?: string;
  result?: { pluginId?: string; theme?: unknown } | null;
  error?: { code: string; message: string };
}

/** A fake frame: records what the bridge posts back. */
function fakeFrame() {
  const posted: Reply[] = [];
  const contentWindow = { postMessage: (message: unknown) => posted.push(message) } as unknown as Window;
  return { frame: { contentWindow } as HTMLIFrameElement, posted, contentWindow };
}

function send(source: unknown, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource }));
}

const request = (method: string, params?: unknown, id = "1") => ({ v: 1, id, method, params });
/** The replies by request id: a call that fails at once is answered before one that awaits the host. */
const byId = (posted: Reply[]) => Object.fromEntries(posted.map((m) => [m.id, m]));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let detachers: Array<() => void> = [];
let grants: string[] = [];
function attach(frame: HTMLIFrameElement, id = "hello") {
  const detach = attachBridge(frame, { id, name: "Hello Plugin", granted: () => grants });
  detachers.push(detach);
  return detach;
}

beforeEach(() => {
  grants = [];
  Object.values(api).forEach((fn) => fn.mockReset());
  Object.values(desktop).forEach((fn) => fn.mockReset());
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  document.documentElement.className = "";
  document.documentElement.setAttribute("data-scheme", "default");
});
afterEach(() => {
  detachers.forEach((detach) => detach());
  detachers = [];
  vi.useRealTimers();
});

describe("bridge: who may talk", () => {
  it("ignores a message from a window that is not the frame", async () => {
    const { frame, posted } = fakeFrame();
    attach(frame);
    send({ postMessage: vi.fn() }, request("theme.get"));
    send(null, request("theme.get"));
    await flush();
    expect(posted).toEqual([]);
  });

  it("drops malformed messages without answering", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    for (const data of [null, "hi", 5, {}, { v: 2, id: "1", method: "theme.get" }, { v: 1, method: "theme.get" }, { v: 1, id: 7, method: "theme.get" }, { v: 1, id: "1" }, { v: 1, id: "1", method: 3 }]) {
      send(contentWindow, data);
    }
    await flush();
    expect(posted).toEqual([]);
  });

  it("answers an unknown method with unknown_method", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("files.delete"));
    await flush();
    expect(posted).toEqual([{ v: 1, id: "1", error: { code: "unknown_method", message: "Unknown method: files.delete" } }]);
  });

  it("does not run inherited object properties as methods", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("constructor"));
    send(contentWindow, request("__proto__", undefined, "2"));
    await flush();
    expect(posted.map((message) => message.error.code)).toEqual(["unknown_method", "unknown_method"]);
  });

  it("stops listening after detach", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    const detach = attach(frame);
    detach();
    send(contentWindow, request("theme.get"));
    await flush();
    expect(posted).toEqual([]);
  });
});

describe("bridge: methods", () => {
  it("ready and theme.get return the theme snapshot, and ready adds the plugin id", async () => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-scheme", "solarized");
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "kafka-inspector");
    send(contentWindow, request("ready", undefined, "a"));
    send(contentWindow, request("theme.get", undefined, "b"));
    await flush();
    const [ready, theme] = posted;
    expect(ready.id).toBe("a");
    expect(ready.result.pluginId).toBe("kafka-inspector");
    expect(ready.result.theme).toMatchObject({ isDark: true, scheme: "solarized" });
    expect(theme.result).toMatchObject({ isDark: true, scheme: "solarized" });
  });

  it("shows a toast with the plugin name, for the four kinds", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    for (const kind of ["info", "success", "warning", "error"]) {
      send(contentWindow, request("toast", { message: `m-${kind}`, kind }, kind));
    }
    await flush();
    for (const kind of ["info", "success", "warning", "error"]) {
      expect(toastMock[kind as "info"]).toHaveBeenCalledWith(`m-${kind}`, { description: "Hello Plugin" });
    }
    expect(posted.every((message) => message.result === null)).toBe(true);
  });

  it("rejects a toast with a bad kind, an empty or a very long message", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("toast", { message: "x", kind: "loud" }, "1"));
    send(contentWindow, request("toast", { message: "", kind: "info" }, "2"));
    send(contentWindow, request("toast", { message: "x".repeat(501), kind: "info" }, "3"));
    send(contentWindow, request("toast", undefined, "4"));
    await flush();
    expect(posted.map((message) => message.error.code)).toEqual(["bad_request", "bad_request", "bad_request", "bad_request"]);
    expect(Object.values(toastMock).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("storage calls go to the host api with the id the host bound, not one from the message", async () => {
    api.getPluginStorage.mockResolvedValue({ n: 1 });
    api.setPluginStorage.mockResolvedValue(undefined);
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "hello");
    send(contentWindow, request("storage.get", { key: "k", id: "other" }, "1"));
    send(contentWindow, request("storage.set", { key: "k", value: [1] }, "2"));
    send(contentWindow, request("storage.remove", { key: "k" }, "3"));
    await flush();
    expect(api.getPluginStorage).toHaveBeenCalledWith("hello", "k");
    expect(api.setPluginStorage).toHaveBeenNthCalledWith(1, "hello", "k", [1]);
    expect(api.setPluginStorage).toHaveBeenNthCalledWith(2, "hello", "k", null);
    expect(posted.map((message) => message.result)).toEqual([{ n: 1 }, null, null]);
  });

  it("rejects bad storage params", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("storage.get", {}, "1"));
    send(contentWindow, request("storage.get", { key: "" }, "2"));
    send(contentWindow, request("storage.get", { key: "k".repeat(257) }, "3"));
    send(contentWindow, request("storage.get", { key: "é".repeat(129) }, "3b")); // 258 bytes
    send(contentWindow, request("storage.set", { key: "k" }, "4"));
    send(contentWindow, request("storage.set", { key: "k", value: null }, "5"));
    send(contentWindow, request("storage.remove", { key: 5 }, "6"));
    await flush();
    expect(posted.map((message) => message.error.code)).toEqual(Array(7).fill("bad_request"));
    expect(api.getPluginStorage).not.toHaveBeenCalled();
    expect(api.setPluginStorage).not.toHaveBeenCalled();
  });

  it("reports a failing host call as failed, with its message", async () => {
    api.setPluginStorage.mockRejectedValue("Plugin storage is full (1 MB limit)");
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("storage.set", { key: "k", value: 1 }));
    await flush();
    expect(posted).toEqual([{ v: 1, id: "1", error: { code: "failed", message: "Plugin storage is full (1 MB limit)" } }]);
  });

  it("times out a call that never finishes", async () => {
    vi.useFakeTimers();
    api.getPluginStorage.mockReturnValue(new Promise(() => {}));
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("storage.get", { key: "k" }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(posted).toEqual([{ v: 1, id: "1", error: { code: "timeout", message: "Timed out: storage.get" } }]);
  });

  it("does not answer twice when a late result arrives after the timeout", async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    api.getPluginStorage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("storage.get", { key: "k" }));
    await vi.advanceTimersByTimeAsync(10_001);
    finish("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toHaveLength(1);
  });
});

/** One gated call: how to ask for it, what the host should then have been called with. */
const GATED = [
  { method: "clipboard.readText", permission: "clipboard:read", params: undefined, spy: () => desktop.readClipboardText, arrange: () => desktop.readClipboardText.mockResolvedValue("clip") },
  { method: "clipboard.writeText", permission: "clipboard:write", params: { text: "hi" }, spy: () => desktop.writeClipboardText, arrange: () => desktop.writeClipboardText.mockResolvedValue(undefined) },
  { method: "files.open", permission: "files:open", params: { accept: ["json"] }, spy: () => api.pluginOpenFile, arrange: () => api.pluginOpenFile.mockResolvedValue(null) },
  { method: "files.save", permission: "files:save", params: { name: "a.txt", data: "x" }, spy: () => desktop.saveFile, arrange: () => desktop.saveFile.mockResolvedValue(true) },
  { method: "net.fetch", permission: "network", params: { url: "http://localhost:9092/" }, spy: () => api.pluginFetch, arrange: () => api.pluginFetch.mockResolvedValue({ status: 200 }) },
] as const;

describe("bridge: permissions (deny / allow matrix)", () => {
  it.each(GATED)("$method is denied without $permission, and the host is not touched", async ({ method, permission, params, spy }) => {
    grants = Object.values(GATED).map((g) => g.permission).filter((p) => p !== permission);
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request(method, params));
    await flush();
    expect(posted).toEqual([{ v: 1, id: "1", error: { code: "permission_denied", message: `This plugin has not been granted ${permission}`, permission } }]);
    expect(spy()).not.toHaveBeenCalled();
  });

  it.each(GATED)("$method runs once $permission is granted", async ({ method, permission, params, spy, arrange }) => {
    arrange();
    grants = [permission];
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request(method, params));
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0].error).toBeUndefined();
    expect(spy()).toHaveBeenCalledTimes(1);
  });

  it("a grant does not carry over to a sibling permission (clipboard:write is not clipboard:read)", async () => {
    grants = ["clipboard:write", "files:open", "network:other.example"];
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("clipboard.readText", undefined, "a"));
    send(contentWindow, request("files.save", { name: "a", data: "x" }, "b"));
    send(contentWindow, request("net.fetch", { url: "http://x/" }, "c"));
    await flush();
    expect(posted.map((m) => m.error?.permission)).toEqual(["clipboard:read", "files:save", "network"]);
  });

  it("storage, toast and theme need no grant", async () => {
    api.getPluginStorage.mockResolvedValue(1);
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("storage.get", { key: "k" }, "a"));
    send(contentWindow, request("toast", { message: "m", kind: "info" }, "b"));
    send(contentWindow, request("theme.get", undefined, "c"));
    await flush();
    expect(posted.every((m) => !m.error)).toBe(true);
  });

  it("reads the grants on every call, so a revoke applies to a frame that is already attached", async () => {
    desktop.writeClipboardText.mockResolvedValue(undefined);
    grants = ["clipboard:write"];
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("clipboard.writeText", { text: "a" }, "1"));
    await flush();
    grants = [];
    send(contentWindow, request("clipboard.writeText", { text: "b" }, "2"));
    await flush();
    expect(posted[0].error).toBeUndefined();
    expect(posted[1].error?.code).toBe("permission_denied");
    expect(desktop.writeClipboardText).toHaveBeenCalledTimes(1);
  });

  it("checks the grant before it looks at the parameters", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("clipboard.writeText", { text: 5 }));
    await flush();
    expect(posted[0].error.code).toBe("permission_denied");
  });
});

describe("bridge: gated methods", () => {
  const granted = (...names: string[]) => {
    grants = names;
    const f = fakeFrame();
    attach(f.frame, "kafka-inspector");
    return f;
  };

  it("clipboard.readText returns the text, and writeText rejects text over 1 MB", async () => {
    desktop.readClipboardText.mockResolvedValue("clip");
    const { posted, contentWindow } = granted("clipboard:read", "clipboard:write");
    send(contentWindow, request("clipboard.readText", undefined, "1"));
    send(contentWindow, request("clipboard.writeText", { text: "x".repeat(1024 * 1024 + 1) }, "2"));
    send(contentWindow, request("clipboard.writeText", {}, "3"));
    await flush();
    expect(posted[0].result).toBe("clip");
    expect(posted.slice(1).map((m) => m.error?.code)).toEqual(["bad_request", "bad_request"]);
    expect(desktop.writeClipboardText).not.toHaveBeenCalled();
  });

  it("files.open returns text by default, bytes on request, and null when cancelled", async () => {
    const bytes = new TextEncoder().encode("héllo");
    api.pluginOpenFile.mockResolvedValueOnce({ name: "a.txt", size: bytes.length, bytes });
    api.pluginOpenFile.mockResolvedValueOnce({ name: "a.bin", size: bytes.length, bytes });
    api.pluginOpenFile.mockResolvedValueOnce(null);
    const { posted, contentWindow } = granted("files:open");
    send(contentWindow, request("files.open", { accept: ["txt"] }, "1"));
    await flush();
    send(contentWindow, request("files.open", { as: "bytes" }, "2"));
    await flush();
    send(contentWindow, request("files.open", undefined, "3"));
    await flush();
    expect(posted[0].result).toEqual({ name: "a.txt", size: bytes.length, text: "héllo" });
    expect(posted[1].result).toEqual({ name: "a.bin", size: bytes.length, bytes });
    expect(posted[2].result).toBeNull();
    expect(api.pluginOpenFile).toHaveBeenNthCalledWith(1, "kafka-inspector", ["txt"]);
    expect(api.pluginOpenFile).toHaveBeenNthCalledWith(3, "kafka-inspector", []);
  });

  it("files.open rejects a bad accept or as", async () => {
    const { posted, contentWindow } = granted("files:open");
    send(contentWindow, request("files.open", { accept: "json" }, "1"));
    await flush();
    send(contentWindow, request("files.open", { accept: [1] }, "2"));
    await flush();
    send(contentWindow, request("files.open", { as: "stream" }, "3"));
    await flush();
    await flush();
    expect(posted.map((m) => m.error?.code)).toEqual(["bad_request", "bad_request", "bad_request"]);
    expect(api.pluginOpenFile).not.toHaveBeenCalled();
  });

  it("files.save takes a string or bytes, returns whether it was saved, and rejects a bad name or data", async () => {
    desktop.saveFile.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    const { posted, contentWindow } = granted("files:save");
    send(contentWindow, request("files.save", { name: "a.txt", data: "text" }, "1"));
    await flush();
    send(contentWindow, request("files.save", { name: "b.bin", data: new Uint8Array([1, 2, 3]) }, "2"));
    await flush();
    send(contentWindow, request("files.save", { name: "../x", data: "t" }, "3"));
    await flush();
    send(contentWindow, request("files.save", { name: "", data: "t" }, "4"));
    await flush();
    send(contentWindow, request("files.save", { name: "a", data: 5 }, "5"));
    await flush();
    send(contentWindow, request("files.save", { name: "c.bin", data: new ArrayBuffer(2) }, "6"));
    await flush();
    await flush();
    const replies = byId(posted);
    expect(["1", "2", "3", "4", "5", "6"].map((id) => replies[id].result ?? replies[id].error?.code)).toEqual([true, false, "bad_request", "bad_request", "bad_request", true]);
    expect(desktop.saveFile).toHaveBeenCalledTimes(3);
    const [blob, name] = desktop.saveFile.mock.calls[0];
    expect(name).toBe("a.txt");
    expect((blob as Blob).size).toBe(4);
  });

  it("net.fetch passes the plugin id the host bound, and rejects bad arguments", async () => {
    const result = { status: 200, statusText: "OK", headers: {}, url: "http://localhost:9092/x", body: new Uint8Array([104]) };
    api.pluginFetch.mockResolvedValue(result);
    const { posted, contentWindow } = granted("network");
    send(contentWindow, request("net.fetch", { url: "http://localhost:9092/x", id: "other", init: { method: "POST", headers: { a: "b" }, body: "{}" } }, "1"));
    send(contentWindow, request("net.fetch", { url: 5 }, "2"));
    send(contentWindow, request("net.fetch", { url: "http://a/", init: { headers: { a: 1 } } }, "3"));
    send(contentWindow, request("net.fetch", { url: "http://a/", init: { body: 5 } }, "4"));
    send(contentWindow, request("net.fetch", { url: "http://a/", init: { method: 5 } }, "5"));
    send(contentWindow, request("net.fetch", { url: "http://a/", init: [] }, "6"));
    await flush();
    const replies = byId(posted);
    expect(replies["1"].result).toEqual(result);
    expect(["2", "3", "4", "5", "6"].map((id) => replies[id].error?.code)).toEqual(Array(5).fill("bad_request"));
    expect(api.pluginFetch).toHaveBeenCalledTimes(1);
    expect(api.pluginFetch).toHaveBeenCalledWith("kafka-inspector", "http://localhost:9092/x", { method: "POST", headers: { a: "b" }, body: "{}" });
  });

  it("a failing fetch is reported as failed with the Rust message", async () => {
    api.pluginFetch.mockRejectedValue("The plugin may not reach evil.example");
    const { posted, contentWindow } = granted("network");
    send(contentWindow, request("net.fetch", { url: "http://evil.example/" }));
    await flush();
    expect(posted[0].error).toEqual({ code: "failed", message: "The plugin may not reach evil.example" });
  });

  it("a permission refusal from the Rust side becomes the same permission_denied error", async () => {
    api.pluginFetch.mockRejectedValue("permission_denied: network");
    const { posted, contentWindow } = granted("network");
    send(contentWindow, request("net.fetch", { url: "http://localhost/" }));
    await flush();
    expect(posted[0].error).toEqual({ code: "permission_denied", message: "This plugin has not been granted network", permission: "network" });
  });

  it("allows one file dialog at a time and six fetches at a time, and frees the slot afterwards", async () => {
    let finish: (value: unknown) => void = () => {};
    api.pluginOpenFile.mockReturnValueOnce(new Promise((resolve) => (finish = resolve))).mockResolvedValue(null);
    const { posted, contentWindow } = granted("files:open");
    send(contentWindow, request("files.open", undefined, "1"));
    send(contentWindow, request("files.open", undefined, "2"));
    await flush();
    expect(byId(posted)["2"].error).toMatchObject({ code: "failed", message: "Too many files.open calls at once" });
    finish(null);
    await flush();
    send(contentWindow, request("files.open", undefined, "3"));
    await flush();
    expect(byId(posted)["1"].result).toBeNull();
    expect(byId(posted)["3"].result).toBeNull();

    const releases: Array<(v: unknown) => void> = [];
    api.pluginFetch.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const net = granted("network");
    for (let i = 0; i < 7; i++) send(net.contentWindow, request("net.fetch", { url: "http://localhost/" }, `f${i}`));
    await flush();
    expect(net.posted.map((m) => m.error?.message)).toEqual(["Too many net.fetch calls at once"]);
    expect(releases).toHaveLength(6);
  });

  it("files.save refuses '.' and '..' as names and a string over 50 MB before encoding it", async () => {
    const { posted, contentWindow } = granted("files:save");
    send(contentWindow, request("files.save", { name: "..", data: "x" }, "1"));
    await flush();
    send(contentWindow, request("files.save", { name: ".", data: "x" }, "2"));
    await flush();
    send(contentWindow, request("files.save", { name: "a", data: "x".repeat(50 * 1024 * 1024 + 1) }, "3"));
    await flush();
    await flush();
    expect(posted.map((m) => m.error?.code)).toEqual(["bad_request", "bad_request", "bad_request"]);
    expect(desktop.saveFile).not.toHaveBeenCalled();
  });

  it("net.fetch has a longer limit than the default, and file dialogs have none", async () => {
    vi.useFakeTimers();
    api.pluginFetch.mockReturnValue(new Promise(() => {}));
    api.pluginOpenFile.mockReturnValue(new Promise(() => {}));
    const { posted, contentWindow } = granted("network", "files:open");
    send(contentWindow, request("net.fetch", { url: "http://localhost/" }, "f"));
    send(contentWindow, request("files.open", undefined, "o"));
    await vi.advanceTimersByTimeAsync(34_999);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(posted).toEqual([{ v: 1, id: "f", error: { code: "timeout", message: "Timed out: net.fetch" } }]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(posted).toHaveLength(1);
  });
});

describe("bridge: theme events", () => {
  it("pushes the theme only to frames that finished the handshake, and not after detach", async () => {
    const a = fakeFrame();
    const b = fakeFrame();
    const c = fakeFrame();
    attach(a.frame, "plug-a");
    attach(b.frame, "plug-b");
    const detachC = attach(c.frame, "plug-c");
    send(a.contentWindow, request("ready"));
    send(c.contentWindow, request("ready"));
    await flush();
    detachC();
    a.posted.length = 0;
    document.documentElement.classList.add("dark");
    notifyThemeChanged();
    expect(a.posted).toEqual([{ v: 1, event: "theme", data: expect.objectContaining({ isDark: true }) }]);
    expect(b.posted).toEqual([]);
    expect(c.posted).toHaveLength(1); // only the ready answer from before the detach
  });
});

describe("bridge: locale", () => {
  it("ready and locale.get carry the app language and direction, with no permission", async () => {
    await setLanguage("ar");
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame);
    send(contentWindow, request("ready", undefined, "a"));
    send(contentWindow, request("locale.get", undefined, "b"));
    await flush();
    const [ready, locale] = posted;
    expect(ready.result).toMatchObject({ locale: { lang: "ar", dir: "rtl" } });
    expect(locale.result).toEqual({ lang: "ar", dir: "rtl" });
  });

  it("pushes the language only to frames that finished the handshake", async () => {
    const a = fakeFrame();
    const b = fakeFrame();
    attach(a.frame, "plug-a");
    attach(b.frame, "plug-b");
    send(a.contentWindow, request("ready"));
    await flush();
    a.posted.length = 0;
    await setLanguage("zh");
    notifyLocaleChanged();
    expect(a.posted).toEqual([{ v: 1, event: "locale", data: { lang: "zh-CN", dir: "ltr" } }]);
    expect(b.posted).toEqual([]);
  });
});

describe("themeSnapshot", () => {
  it("reads the computed custom properties and the dark and scheme state", () => {
    document.documentElement.style.setProperty("--background", "220 23% 98%");
    document.documentElement.classList.add("dark");
    const theme = themeSnapshot();
    expect(theme.vars["--background"]).toBe("220 23% 98%");
    expect(theme.isDark).toBe(true);
    expect(theme.scheme).toBe("default");
    document.documentElement.style.removeProperty("--background");
    // A token that is not set is left out, not sent as an empty string.
    expect(themeSnapshot().vars).not.toHaveProperty("--background");
  });
});

describe("bridge: frame lifecycle (W29)", () => {
  it("calls onReady on the handshake, and onCrash for an error event from the frame only", async () => {
    const { frame, contentWindow } = fakeFrame();
    const onReady = vi.fn();
    const onCrash = vi.fn();
    detachers.push(attachBridge(frame, { id: "hello", name: "Hello Plugin", granted: () => grants, onReady, onCrash }));
    send(window, { v: 1, event: "error", message: "from the app" });
    send(contentWindow, { v: 2, event: "error", message: "wrong version" });
    expect(onCrash).not.toHaveBeenCalled();
    send(contentWindow, request("ready"));
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
    send(contentWindow, { v: 1, event: "error", message: "x".repeat(900) });
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash.mock.calls[0][0]).toHaveLength(500);
    send(contentWindow, { v: 1, event: "error", message: 42 });
    expect(onCrash.mock.calls[1][0]).toBe("Unknown error");
  });

  it("answers ready with the current visibility and pushes changes only after the handshake", async () => {
    const a = fakeFrame();
    const b = fakeFrame();
    let visible = false;
    detachers.push(attachBridge(a.frame, { id: "plug-a", name: "A", granted: () => grants, visible: () => visible }));
    attach(b.frame, "plug-b");
    notifyVisibilityChanged("plug-a", true);
    expect(a.posted).toEqual([]); // not ready yet
    send(a.contentWindow, request("ready"));
    await flush();
    expect(a.posted[0].result).toMatchObject({ pluginId: "plug-a", visible: false });
    visible = true;
    notifyVisibilityChanged("plug-a", true);
    expect(a.posted[1]).toEqual({ v: 1, event: "visibility", data: { visible: true } });
    expect(b.posted).toEqual([]);
  });
});

describe("bridge: send to a plugin", () => {
  const inputEvent = (text: string) => ({ v: 1, event: "input", data: { text } });

  it("delivers to the ready frame of that plugin only", async () => {
    const a = fakeFrame();
    const b = fakeFrame();
    attach(a.frame, "in-1a");
    attach(b.frame, "in-1b");
    send(a.contentWindow, request("ready", undefined, "a"));
    send(b.contentWindow, request("ready", undefined, "b"));
    await flush();
    expect(sendInputToPlugin("in-1a", "hello")).toBe(true);
    expect(a.posted.at(-1)).toEqual(inputEvent("hello"));
    expect(b.posted.some((m) => (m as { event?: string }).event === "input")).toBe(false);
  });

  it("holds text for a frame that is not ready and hands it over once, at the handshake", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-2");
    expect(sendInputToPlugin("in-2", "later")).toBe(true);
    expect(posted).toEqual([]);
    send(contentWindow, request("ready", undefined, "r1"));
    await flush();
    expect(posted.filter((m) => (m as { event?: string }).event === "input")).toEqual([inputEvent("later")]);
    // A second handshake (the frame was reloaded) does not replay it.
    send(contentWindow, request("ready", undefined, "r2"));
    await flush();
    expect(posted.filter((m) => (m as { event?: string }).event === "input")).toHaveLength(1);
  });

  it("holds text sent before the plugin has a frame at all", async () => {
    sendInputToPlugin("in-3", "early");
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-3");
    send(contentWindow, request("ready"));
    await flush();
    expect(posted.filter((m) => (m as { event?: string }).event === "input")).toEqual([inputEvent("early")]);
  });

  it("does not hand over held text that is older than the limit", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    sendInputToPlugin("in-4", "stale");
    now.mockReturnValue(1_000_000 + INPUT_TTL_MS + 1);
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-4");
    send(contentWindow, request("ready"));
    await flush();
    now.mockRestore();
    expect(posted.some((m) => (m as { event?: string }).event === "input")).toBe(false);
  });

  it("frees held text when its time is up, even if no frame ever says ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      sendInputToPlugin("in-6", "forgotten");
      vi.advanceTimersByTime(INPUT_TTL_MS);
    } finally {
      vi.useRealTimers();
    }
    // The clock was not moved, so only the timer can have dropped it.
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-6");
    send(contentWindow, request("ready"));
    await flush();
    expect(posted.some((m) => (m as { event?: string }).event === "input")).toBe(false);
  });

  it("refuses text over the size limit and holds nothing", async () => {
    expect(sendInputToPlugin("in-5", "x".repeat(MAX_INPUT_CHARS + 1))).toBe(false);
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-5");
    send(contentWindow, request("ready"));
    await flush();
    expect(posted.some((m) => (m as { event?: string }).event === "input")).toBe(false);
  });

  it("needs no permission", async () => {
    const { frame, posted, contentWindow } = fakeFrame();
    attach(frame, "in-6");
    send(contentWindow, request("ready"));
    await flush();
    expect(grants).toEqual([]);
    sendInputToPlugin("in-6", "ok");
    expect(posted.at(-1)).toEqual(inputEvent("ok"));
  });
});
