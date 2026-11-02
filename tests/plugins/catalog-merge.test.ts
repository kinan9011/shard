import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { buildCatalog } from "@/app/catalog";
import { pluginCatalogTools } from "@/app/useToolCatalog";
import type { InstalledPlugin } from "@/plugins/api";

const installed = (id: string, extra: Partial<InstalledPlugin> = {}, manifest: Partial<InstalledPlugin["manifest"]> = {}): InstalledPlugin => ({
  id,
  version: "1.0.0",
  manifest: { id, name: `Name of ${id}`, version: "1.0.0", description: "d", entry: "index.html", runtime: "web", ...manifest },
  source: { kind: "folder" },
  sha256: "0".repeat(64),
  verified: false,
  enabled: true,
  granted: [],
  installedAt: 0,
  ...extra,
});

describe("pluginCatalogTools", () => {
  it("maps an enabled plugin to a plugin tool", () => {
    const [tool] = pluginCatalogTools([installed("kafka-inspector", {}, { category: "Development", keywords: ["kafka"] })]);
    expect(tool).toMatchObject({
      id: "kafka-inspector",
      name: "Name of kafka-inspector",
      category: "Development",
      keywords: ["kafka"],
      source: "plugin",
      pluginId: "kafka-inspector",
    });
  });

  it("falls back to the Plugins category and no keywords", () => {
    expect(pluginCatalogTools([installed("hello-tool")])[0]).toMatchObject({ category: "Plugins", keywords: [] });
  });

  it("drops disabled plugins", () => {
    expect(pluginCatalogTools([installed("a-tool", { enabled: false }), installed("b-tool")]).map((t) => t.id)).toEqual(["b-tool"]);
  });
});

describe("catalog with plugins", () => {
  it("appends enabled plugins after the builtins and keeps a builtin when ids collide", () => {
    const tools = pluginCatalogTools([installed("kafka-inspector"), installed("json-viewer")]);
    const catalog = buildCatalog(ALL_TOOLS, tools, new Set());
    expect(catalog).toHaveLength(ALL_TOOLS.length + 1);
    expect(catalog.at(-1)).toMatchObject({ id: "kafka-inspector", source: "plugin" });
    expect(catalog.find((t) => t.id === "json-viewer")?.source).toBe("core");
  });

  it("hides a plugin the user hid", () => {
    const catalog = buildCatalog(ALL_TOOLS, pluginCatalogTools([installed("kafka-inspector")]), new Set(["kafka-inspector"]));
    expect(catalog.some((t) => t.id === "kafka-inspector")).toBe(false);
  });
});
