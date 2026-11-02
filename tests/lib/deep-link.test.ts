import { describe, expect, it } from "vitest";
import { parseDeepLink } from "@/utils/deep-link";

const known = new Set(["json-viewer", "hash-generator"]);

describe("parseDeepLink", () => {
  it("opens a known tool", () => {
    expect(parseDeepLink("shard://open/json-viewer", known)).toEqual({ type: "tool", toolId: "json-viewer" });
    expect(parseDeepLink("shard://tool/hash-generator", known)).toEqual({ type: "tool", toolId: "hash-generator" });
    expect(parseDeepLink("shard://open/JSON-Viewer/", known)).toEqual({ type: "tool", toolId: "json-viewer" });
  });

  it("rejects unknown tools, other schemes, and malformed links", () => {
    expect(parseDeepLink("shard://open/not-a-tool", known)).toBeNull();
    expect(parseDeepLink("shard://open", known)).toBeNull();
    expect(parseDeepLink("https://open/json-viewer", known)).toBeNull();
    expect(parseDeepLink("shard://delete/everything", known)).toBeNull();
    expect(parseDeepLink("not a url", known)).toBeNull();
  });

  it("opens the command palette with a query", () => {
    expect(parseDeepLink("shard://search?q=yaml%20json", known)).toEqual({ type: "search", query: "yaml json" });
    expect(parseDeepLink("shard://search/hash", known)).toEqual({ type: "search", query: "hash" });
    expect(parseDeepLink("shard://search", known)).toEqual({ type: "search", query: "" });
  });

  it("shows the home page", () => {
    expect(parseDeepLink("shard://", known)).toEqual({ type: "home" });
    expect(parseDeepLink("shard://home", known)).toEqual({ type: "home" });
  });
});
