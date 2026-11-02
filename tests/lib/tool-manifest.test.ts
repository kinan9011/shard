import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { buildToolManifest } from "@/utils/tool-manifest";

describe("buildToolManifest", () => {
  it("lists every registered tool with its link scheme and app version", () => {
    const manifest = buildToolManifest(ALL_TOOLS, "2.1.0");
    expect(manifest).toMatchObject({ version: 1, appVersion: "2.1.0", scheme: "shard" });
    expect(manifest.tools).toHaveLength(ALL_TOOLS.length);
    expect(manifest.tools.find((tool) => tool.id === "jwt-decoder")).toEqual({
      id: "jwt-decoder",
      name: "JWT Decoder",
      category: "Text Tools",
      keywords: expect.arrayContaining(["jwt"]),
    });
  });

  it("uses tool ids that the Rust validator accepts", () => {
    for (const tool of buildToolManifest(ALL_TOOLS, "2.1.0").tools) {
      expect(tool.id).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(tool.keywords.length).toBeLessThanOrEqual(32);
    }
  });
});
