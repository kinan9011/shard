import { describe, expect, it } from "vitest";
import { pruneToolIds, type CatalogTool } from "@/app/catalog";
import { OFFICIAL_REPO_URL, PORTED_PLUGIN_IDS, PORTED_TOOLS, migrateToolIds, portedToOffer } from "@/app/legacyMigration";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { validateManifest } from "@/plugins/schema";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ported tools", () => {
  it("are no longer built in", () => {
    for (const tool of PORTED_TOOLS) expect(ALL_TOOLS.map((item) => item.id)).not.toContain(tool.oldId);
  });

  it("come from the official repository the app seeds", () => {
    const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/plugins/repos.rs"), "utf8");
    expect(rust).toContain(`OFFICIAL_URL: &str = "${OFFICIAL_REPO_URL}"`);
  });
});

describe("migrateToolIds", () => {
  it("maps old ids to plugin ids, keeps other ids and order, and drops duplicates", () => {
    expect(migrateToolIds(["json-viewer", "hash-generator", "uuid-generator", "json-viewer"])).toEqual(["json-viewer", "hash-generator", "uuid-generator"]);
    expect(migrateToolIds([])).toEqual([]);
    // W28 ports keep their ids too.
    expect(migrateToolIds(["markdown", "color-palette", "cron-calculator", "markdown"])).toEqual(["markdown", "color-palette", "cron-calculator"]);
  });
});

describe("portedToOffer", () => {
  it("offers a ported tool that was pinned or used and is not installed", () => {
    expect(portedToOffer(new Set(["json-viewer", "hash-generator"]), new Set()).map((tool) => tool.pluginId)).toEqual(["hash-generator"]);
    expect(portedToOffer(new Set(["uuid-generator", "hash-generator"]), new Set()).map((tool) => tool.pluginId)).toEqual(["hash-generator", "uuid-generator"]);
    expect(portedToOffer(new Set(["color-palette", "markdown", "cron-calculator"]), new Set(["markdown"])).map((tool) => tool.pluginId)).toEqual(["cron-calculator", "color-palette"]);
  });

  it("offers nothing for a tool that was never used or is installed already (enabled or not)", () => {
    expect(portedToOffer(new Set(["json-viewer"]), new Set())).toEqual([]);
    expect(portedToOffer(new Set(["hash-generator"]), new Set(["hash-generator"]))).toEqual([]);
  });
});

describe("pruneToolIds with kept ids", () => {
  const known = new Map<string, CatalogTool>([["json-viewer", {} as CatalogTool]]);

  it("keeps the ported ids that are not installed, and still drops unknown ones", () => {
    expect(pruneToolIds(["json-viewer", "hash-generator", "gone-tool"], known, PORTED_PLUGIN_IDS)).toEqual(["json-viewer", "hash-generator"]);
    expect(pruneToolIds(["json-viewer", "hash-generator", "gone-tool"], known)).toEqual(["json-viewer"]);
  });
});
