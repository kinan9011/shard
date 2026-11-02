import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri, invoke: tauri.invoke }));

import { decodeFrame, installPluginFolder, listPlugins, pickPluginFolder, pluginFetch, pluginOpenFile, setPluginEnabled, setPluginGrants, uninstallPlugin } from "@/plugins/api";

/** What the Rust side sends: [u32 LE length][JSON metadata][body]. */
function frame(meta: unknown, body: number[] = []): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length + body.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(body, 4 + json.length);
  return out.buffer;
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.isTauri.mockReturnValue(false);
});

describe("in the browser build", () => {
  it("lists nothing and picks nothing, without calling the backend", async () => {
    expect(await listPlugins()).toEqual([]);
    expect(await pickPluginFolder()).toBeNull();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("refuses to change anything", async () => {
    await expect(installPluginFolder("/p")).rejects.toThrow("desktop app");
    await expect(uninstallPlugin("a-tool")).rejects.toThrow("desktop app");
    await expect(setPluginEnabled("a-tool", true)).rejects.toThrow("desktop app");
    await expect(setPluginGrants("a-tool", [])).rejects.toThrow("desktop app");
    await expect(pluginFetch("a-tool", "http://localhost/")).rejects.toThrow("desktop app");
    await expect(pluginOpenFile("a-tool")).rejects.toThrow("desktop app");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});

describe("in the desktop app", () => {
  beforeEach(() => tauri.isTauri.mockReturnValue(true));

  it("calls each command with its arguments", async () => {
    tauri.invoke.mockResolvedValue([]);
    await listPlugins();
    await pickPluginFolder();
    await installPluginFolder("/some/folder");
    await uninstallPlugin("a-tool");
    await setPluginEnabled("a-tool", false);
    expect(tauri.invoke.mock.calls).toEqual([
      ["plugins_list"],
      ["plugin_pick_folder"],
      ["plugin_install_folder", { path: "/some/folder" }],
      ["plugin_uninstall", { id: "a-tool" }],
      ["plugin_set_enabled", { id: "a-tool", enabled: false }],
    ]);
  });

  it("passes backend errors through", async () => {
    tauri.invoke.mockRejectedValue("id: bad");
    await expect(installPluginFolder("/p")).rejects.toBe("id: bad");
  });

  it("sets grants with the plugin id and the list", async () => {
    tauri.invoke.mockResolvedValue({ id: "a-tool", granted: ["network"] });
    await setPluginGrants("a-tool", ["network", "network:b.com"]);
    expect(tauri.invoke).toHaveBeenCalledWith("plugin_set_grants", { id: "a-tool", grants: ["network", "network:b.com"] });
  });

  it("fetches through plugin_fetch and decodes the reply", async () => {
    tauri.invoke.mockResolvedValue(frame({ status: 200, statusText: "OK", url: "http://a/", headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"], ["x", "y"]] }, [104, 105]));
    const result = await pluginFetch("a-tool", "http://a/", { method: "POST", headers: { h: "v" }, body: "b" });
    expect(tauri.invoke).toHaveBeenCalledWith("plugin_fetch", { id: "a-tool", request: { url: "http://a/", method: "POST", headers: { h: "v" }, body: "b" } });
    expect(result).toMatchObject({ status: 200, statusText: "OK", url: "http://a/", headers: { "set-cookie": "a=1, b=2", x: "y" } });
    expect(new TextDecoder().decode(result.body)).toBe("hi");
  });

  it("keeps header names like constructor and __proto__ as plain names", async () => {
    tauri.invoke.mockResolvedValue(frame({ status: 200, statusText: "OK", url: "http://a/", headers: [["constructor", "c"], ["__proto__", "p"], ["tostring", "t"]] }));
    const { headers } = await pluginFetch("a-tool", "http://a/");
    expect(Object.keys(headers)).toEqual(["constructor", "__proto__", "tostring"]);
    expect(headers.constructor).toBe("c");
    expect(Object.getOwnPropertyDescriptor(headers, "__proto__")?.value).toBe("p");
  });

  it("opens a file through plugin_open_file, and a cancel is null", async () => {
    tauri.invoke.mockResolvedValueOnce(frame({ name: "a.txt", size: 2 }, [104, 105]));
    const file = await pluginOpenFile("a-tool", ["txt"]);
    expect(tauri.invoke).toHaveBeenCalledWith("plugin_open_file", { id: "a-tool", accept: ["txt"] });
    expect(file).toMatchObject({ name: "a.txt", size: 2 });
    expect(Array.from(file!.bytes)).toEqual([104, 105]);
    tauri.invoke.mockResolvedValueOnce(new ArrayBuffer(0));
    expect(await pluginOpenFile("a-tool")).toBeNull();
  });
});

describe("decodeFrame", () => {
  it("splits metadata from the body, including an empty body", () => {
    const { meta, body } = decodeFrame(frame({ a: 1 }));
    expect(meta).toEqual({ a: 1 });
    expect(body.length).toBe(0);
  });

  it("rejects a reply that is too short or whose length points past the end", () => {
    expect(() => decodeFrame(new ArrayBuffer(2))).toThrow("Bad reply");
    const bad = new Uint8Array(6);
    new DataView(bad.buffer).setUint32(0, 99, true);
    expect(() => decodeFrame(bad.buffer)).toThrow("Bad reply");
  });
});
