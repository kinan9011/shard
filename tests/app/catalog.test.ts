import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { buildCatalog, groupByCategory, pruneToolIds, type CatalogTool } from "@/app/catalog";

const CORE_IDS = [
  "json-viewer",
  "code-playground",
  "regex-generator",
  "json-typescript",
  "json-schema",
  "json-diff",
  "text-compare",
  "diff-merge",
  "jwt-decoder",
];

const plugin = (id: string, category = "Plugins"): CatalogTool => ({
  id,
  name: id,
  category,
  keywords: [],
  icon: Box,
  source: "plugin",
  pluginId: id,
});

describe("registry kinds", () => {
  it("marks exactly the 9 core tools as core and the rest as legacy", () => {
    const core = ALL_TOOLS.filter((tool) => tool.kind === "core").map((tool) => tool.id);
    expect([...core].sort()).toEqual([...CORE_IDS].sort());
    expect(ALL_TOOLS.filter((tool) => tool.kind === "legacy")).toHaveLength(ALL_TOOLS.length - 9);
  });
});

describe("buildCatalog", () => {
  it("maps builtin kind to source and keeps registry order", () => {
    const catalog = buildCatalog(ALL_TOOLS, [], new Set());
    expect(catalog.map((tool) => tool.id)).toEqual(ALL_TOOLS.map((tool) => tool.id));
    expect(catalog.find((tool) => tool.id === "json-viewer")?.source).toBe("core");
    expect(catalog.find((tool) => tool.id === "semver")?.source).toBe("legacy");
  });

  it("appends plugin tools and ignores one that reuses a builtin id", () => {
    const catalog = buildCatalog(ALL_TOOLS, [plugin("kafka-inspector"), plugin("json-viewer")], new Set());
    expect(catalog.at(-1)).toMatchObject({ id: "kafka-inspector", source: "plugin", pluginId: "kafka-inspector" });
    expect(catalog.filter((tool) => tool.id === "json-viewer")).toHaveLength(1);
    expect(catalog.find((tool) => tool.id === "json-viewer")?.source).toBe("core");
  });

  it("drops hidden tools, core and plugin alike", () => {
    const catalog = buildCatalog(ALL_TOOLS, [plugin("kafka-inspector")], new Set(["json-viewer", "kafka-inspector"]));
    expect(catalog.some((tool) => tool.id === "json-viewer")).toBe(false);
    expect(catalog.some((tool) => tool.id === "kafka-inspector")).toBe(false);
    expect(catalog).toHaveLength(ALL_TOOLS.length - 1);
  });
});

describe("groupByCategory", () => {
  it("groups in first-seen category order", () => {
    const groups = groupByCategory([plugin("a", "Zed"), plugin("b", "Alpha"), plugin("c", "Zed")]);
    expect(groups.map((group) => group.name)).toEqual(["Zed", "Alpha"]);
    expect(groups[0].tools.map((tool) => tool.id)).toEqual(["a", "c"]);
  });

  it("matches the categories of the registry", () => {
    const groups = groupByCategory(buildCatalog(ALL_TOOLS, [], new Set()));
    expect(groups.map((group) => group.name)).toEqual(Array.from(new Set(ALL_TOOLS.map((tool) => tool.category))));
    expect(groups.flatMap((group) => group.tools)).toHaveLength(ALL_TOOLS.length);
  });
});

describe("pruneToolIds", () => {
  const known = new Map(buildCatalog(ALL_TOOLS, [], new Set()).map((tool) => [tool.id, tool]));

  it("keeps known ids in order and drops unknown, non-string and duplicate ones", () => {
    expect(pruneToolIds(["semver", "gone", 4, "json-viewer", "semver", null], known)).toEqual(["semver", "json-viewer"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(pruneToolIds(null, known)).toEqual([]);
    expect(pruneToolIds({ 0: "semver" }, known)).toEqual([]);
    expect(pruneToolIds("semver", known)).toEqual([]);
  });
});
