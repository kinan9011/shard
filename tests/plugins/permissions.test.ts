import { describe, expect, it } from "vitest";
import { isGranted, permissionRows } from "@/plugins/permissions";
import type { PluginManifest } from "@/plugins/types";

const manifest = (permissions: PluginManifest["permissions"], runtime: PluginManifest["runtime"] = "web") => ({ permissions, runtime });

describe("permissionRows", () => {
  it("builds the design's rows in its order, with the manifest's reasons and required/optional", () => {
    const rows = permissionRows(
      manifest(
        [
          { name: "clipboard:write", reason: "Copy decoded messages", optional: true },
          { name: "files:open", reason: "Read files you open in the tool" },
          { name: "network", hosts: ["localhost:9092"], reason: "Connect to localhost:9092 and brokers you add" },
        ],
        "wasm",
      ),
    );
    expect(rows.map((r) => [r.label, r.reason, r.required])).toEqual([
      ["Network", "Connect to localhost:9092 and brokers you add", true],
      ["Files", "Read files you open in the tool", true],
      ["Clipboard", "Copy decoded messages", false],
      ["WASM backend", "Runs sandboxed, with no direct access to your system", true],
    ]);
    expect(rows[0]).toMatchObject({ key: "network", names: ["network"], hosts: ["localhost:9092"] });
  });

  it("merges the names of a group into one row: required when any is, reasons joined without repeats", () => {
    const [files, clipboard] = permissionRows(
      manifest([
        { name: "files:open", reason: "Open", optional: true },
        { name: "files:save", reason: "Save" },
        { name: "clipboard:read", reason: "Same", optional: true },
        { name: "clipboard:write", reason: "Same", optional: true },
      ]),
    );
    expect(files).toMatchObject({ names: ["files:open", "files:save"], required: true, reason: "Open Save" });
    expect(clipboard).toMatchObject({ names: ["clipboard:read", "clipboard:write"], required: false, reason: "Same" });
  });

  it("has no row for storage, none for a plain web plugin without permissions, and a WASM row for web+wasm", () => {
    expect(permissionRows(manifest([{ name: "storage", reason: "Keep settings" }]))).toEqual([]);
    expect(permissionRows(manifest(undefined))).toEqual([]);
    expect(permissionRows(manifest(undefined, "web+wasm")).map((r) => r.key)).toEqual(["wasm"]);
  });
});

describe("isGranted", () => {
  it("is true for storage always, and for the others only when listed", () => {
    expect(isGranted([], "storage")).toBe(true);
    expect(isGranted([], "network")).toBe(false);
    expect(isGranted(["network:a.com"], "network")).toBe(false);
    expect(isGranted(["clipboard:write"], "clipboard:write")).toBe(true);
    expect(isGranted(["clipboard:write"], "clipboard:read")).toBe(false);
  });
});
