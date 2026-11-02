import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { searchTools } from "@/utils/tool-search";

const ids = (query: string) => searchTools([...ALL_TOOLS], query).map((tool) => tool.id);

describe("searchTools keywords", () => {
  it("finds tools by keyword", () => {
    expect(ids("bearer")[0]).toBe("jwt-decoder");
    expect(ids("tilde")[0]).toBe("semver");
    expect(ids("mermaid")[0]).toBe("mermaid-renderer");
    expect(ids("diff")[0]).toBe("diff-merge");
    expect(ids("diff")).toContain("text-compare");
  });

  it("still ranks an exact name above a keyword match", () => {
    expect(ids("semver")[0]).toBe("semver");
    expect(ids("JSON Viewer")[0]).toBe("json-viewer");
  });

  it("does not match keywords fuzzily", () => {
    // "uid" is not a keyword prefix, so only name matches can find tools.
    expect(searchTools([{ id: "a", name: "Alpha", category: "X", keywords: ["unique id"] }], "qq")).toEqual([]);
  });

  it("gives every tool at least one keyword", () => {
    for (const tool of ALL_TOOLS) expect(tool.keywords.length, tool.id).toBeGreaterThan(0);
  });
});
