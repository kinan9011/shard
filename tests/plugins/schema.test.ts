import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { validateIndex, validateManifest } from "@/plugins/schema";

const manifest = (extra: object = {}) => ({
  id: "kafka-inspector",
  name: "Kafka Inspector",
  version: "0.3.1",
  description: "Browse topics.",
  entry: "index.html",
  runtime: "web",
  ...extra,
});

const entry = (extra: object = {}) => ({
  id: "kafka-inspector",
  name: "Kafka Inspector",
  version: "0.3.1",
  description: "Browse topics.",
  runtime: "web",
  url: "https://github.com/o/r/releases/download/v1/kafka-inspector-0.3.1.zip",
  sha256: "a".repeat(64),
  size: 2516582,
  ...extra,
});

const index = (plugins: object[] = [entry()], extra: object = {}) => ({ schema: 1, name: "Shard Official", plugins, ...extra });

const errorsOf = (result: { ok: boolean; errors?: string[] }) => (result.ok ? [] : result.errors!);

describe("validateManifest", () => {
  it("accepts a minimal and a full manifest", () => {
    expect(validateManifest(manifest()).ok).toBe(true);
    const full = manifest({
      longDescription: "More.",
      category: "Development",
      keywords: ["kafka"],
      icon: "lucide:Activity",
      runtime: "web+wasm",
      permissions: [
        { name: "network", hosts: ["localhost:9092", "*.example.com"], reason: "Connect" },
        { name: "files:open", reason: "Read files" },
        { name: "clipboard:write", reason: "Copy", optional: true },
        { name: "storage", reason: "Remember settings" },
      ],
      minAppVersion: "1.0.0",
      license: "MIT",
      source: "https://github.com/kinan9011/kafka-inspector",
      screenshots: ["shot1.png"],
      changelog: "CHANGELOG.md",
    });
    expect(validateManifest(full)).toEqual({ ok: true, value: full });
  });

  it("ignores unknown fields", () => {
    expect(validateManifest(manifest({ futureField: 1 })).ok).toBe(true);
  });

  it.each([
    ["Bad_ID", /^id: "Bad_ID" does not match/],
    ["a", /^id: "a" does not match/],
  ])("rejects id %s", (id, message) => {
    expect(errorsOf(validateManifest(manifest({ id })))[0]).toMatch(message);
  });

  it("rejects a version with a v prefix and a bad minAppVersion", () => {
    expect(errorsOf(validateManifest(manifest({ version: "v1.0.0" })))).toEqual([expect.stringMatching(/^version: "v1\.0\.0" does not match/)]);
    expect(errorsOf(validateManifest(manifest({ minAppVersion: "3" })))).toEqual([expect.stringMatching(/^minAppVersion: "3" does not match/)]);
  });

  it("accepts build metadata and prerelease, rejects a non-http source", () => {
    expect(validateManifest(manifest({ version: "1.0.0+build.5", minAppVersion: "1.0.0-beta.1" })).ok).toBe(true);
    expect(errorsOf(validateManifest(manifest({ source: "javascript:alert(1)" })))[0]).toMatch(/^source: "javascript:alert\(1\)" does not match/);
  });

  it("names missing required fields", () => {
    expect(errorsOf(validateManifest({ id: "abc" }))).toEqual(
      expect.arrayContaining(["name: is required", "version: is required", "entry: is required", "runtime: is required"]),
    );
  });

  it("rejects an unknown runtime and lists the choices", () => {
    expect(errorsOf(validateManifest(manifest({ runtime: "native" })))).toEqual(["runtime: must be one of web, wasm, web+wasm"]);
  });

  it("rejects an unknown permission", () => {
    const errors = errorsOf(validateManifest(manifest({ permissions: [{ name: "camera", reason: "r" }] })));
    expect(errors).toEqual(["permissions[0].name: must be one of clipboard:read, clipboard:write, files:open, files:save, network, storage"]);
  });

  it("requires a reason", () => {
    expect(errorsOf(validateManifest(manifest({ permissions: [{ name: "files:open" }] })))).toEqual(["permissions[0].reason: is required"]);
  });

  it("requires hosts for network, and rejects hosts elsewhere", () => {
    expect(errorsOf(validateManifest(manifest({ permissions: [{ name: "network", reason: "r" }] })))).toEqual(["permissions[0].hosts: is required"]);
    expect(errorsOf(validateManifest(manifest({ permissions: [{ name: "network", hosts: [], reason: "r" }] })))).toEqual([
      "permissions[0].hosts: needs at least 1 item",
    ]);
    expect(errorsOf(validateManifest(manifest({ permissions: [{ name: "files:open", hosts: ["a.com"], reason: "r" }] })))).toEqual([
      "permissions[0]: is not allowed here (only the network permission takes hosts)",
    ]);
  });

  it("rejects hosts with a scheme or path", () => {
    const errors = errorsOf(validateManifest(manifest({ permissions: [{ name: "network", hosts: ["https://a.com/x"], reason: "r" }] })));
    expect(errors[0]).toMatch(/^permissions\[0\]\.hosts\[0\]: "https:\/\/a\.com\/x" does not match/);
  });

  it("rejects non-objects", () => {
    expect(errorsOf(validateManifest("nope"))).toEqual(["must be an object"]);
  });
});

describe("validateIndex", () => {
  it("accepts an index and extra fields", () => {
    expect(validateIndex(index([entry({ released: "2026-10-18", changelog: "x", icon: "https://x/i.svg", permissions: [{ name: "storage", reason: "r" }] })])).ok).toBe(true);
    expect(validateIndex(index([], { extra: true })).ok).toBe(true);
  });

  it("accepts a themes-only index and rejects a duplicate or oversized theme", () => {
    const theme = (extra = {}) => ({ id: "nord", name: "Nord", version: "1.0.0", url: "https://x.test/nord.json", sha256: "a".repeat(64), size: 900, ...extra });
    expect(validateIndex(index([], { themes: [theme()] })).ok).toBe(true);
    expect(errorsOf(validateIndex(index([], { themes: [theme(), theme()] })))).toEqual(['themes[1].id: "nord" is listed more than once']);
    expect(validateIndex(index([], { themes: [theme({ size: 70000 })] })).ok).toBe(false);
    expect(validateIndex(index([], { themes: [theme({ id: "Bad Id" })] })).ok).toBe(false);
  });

  it("rejects a schema other than 1", () => {
    expect(errorsOf(validateIndex(index([], { schema: 2 })))).toEqual(["schema: must be 1"]);
  });

  it("rejects a bad sha256, size, url and date", () => {
    const errors = errorsOf(validateIndex(index([entry({ sha256: "XYZ", size: -1, url: "not a url", released: "yesterday" })])));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^plugins\[0\]\.sha256: "XYZ" does not match/),
        "plugins[0].size: must be >= 0",
        'plugins[0].url: "not a url" is not a valid uri',
        'plugins[0].released: "yesterday" is not a valid date',
      ]),
    );
  });

  it("flags duplicate ids", () => {
    expect(errorsOf(validateIndex(index([entry(), entry({ version: "0.4.0" })])))).toEqual(['plugins[1].id: "kafka-inspector" is listed more than once']);
  });

  it("checks permissions inside entries", () => {
    const errors = errorsOf(validateIndex(index([entry({ permissions: [{ name: "network", reason: "r" }] })])));
    expect(errors).toEqual(["plugins[0].permissions[0].hosts: is required"]);
  });

  describe("bundles", () => {
    const bundle = (extra: object = {}) => ({ id: "web-apis", name: "Web & APIs", plugins: ["kafka-inspector"], ...extra });

    it("are optional: an index without them stays valid", () => {
      expect(validateIndex(index()).ok).toBe(true);
      expect(validateIndex(index([entry()], { bundles: [] })).ok).toBe(true);
    });

    it("accepts bundles that list plugins of the index", () => {
      const other = entry({ id: "sql-formatter", name: "SQL Formatter" });
      expect(validateIndex(index([entry(), other], { bundles: [bundle(), bundle({ id: "data-sql", name: "Data & SQL", plugins: ["sql-formatter", "kafka-inspector"] })] })).ok).toBe(true);
    });

    it("rejects a plugin that the index does not list", () => {
      expect(errorsOf(validateIndex(index([entry()], { bundles: [bundle({ plugins: ["kafka-inspector", "ghost"] })] })))).toEqual(['bundles[0].plugins[1]: "ghost" is not listed in plugins']);
    });

    it("rejects the same plugin twice in one bundle", () => {
      expect(errorsOf(validateIndex(index([entry()], { bundles: [bundle({ plugins: ["kafka-inspector", "kafka-inspector"] })] })))).toEqual(['bundles[0].plugins[1]: "kafka-inspector" is listed more than once']);
    });

    it("rejects a repeated bundle id", () => {
      expect(errorsOf(validateIndex(index([entry()], { bundles: [bundle(), bundle({ name: "Again" })] })))).toEqual(['bundles[1].id: "web-apis" is listed more than once']);
    });

    it("rejects a bad id, an empty name and no plugins", () => {
      const errors = errorsOf(validateIndex(index([entry()], { bundles: [bundle({ id: "Web APIs", name: "", plugins: [] })] })));
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/^bundles\[0\]\.id: "Web APIs" does not match/), "bundles[0].name: must NOT have fewer than 1 characters", "bundles[0].plugins: needs at least 1 item"]),
      );
    });

    it("rejects bundles that are not a list", () => {
      expect(errorsOf(validateIndex(index([entry()], { bundles: "all" })))).toEqual(["bundles: must be an array"]);
    });
  });
});

describe("builtin id list", () => {
  it("matches ALL_TOOLS in the Rust validator", () => {
    const source = readFileSync("src-tauri/src/plugins/manifest.rs", "utf8");
    const block = source.slice(source.indexOf("BUILTIN_TOOL_IDS"), source.indexOf("];", source.indexOf("BUILTIN_TOOL_IDS")));
    const rustIds = [...block.matchAll(/"([^"]+)",/g)].map((m) => m[1]);
    expect(rustIds.sort()).toEqual(ALL_TOOLS.map((tool) => tool.id).sort());
  });
});
