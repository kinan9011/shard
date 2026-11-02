// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "vite";

// The examples vendor the built SDK (the plugin CSP allows only its own files). This fails when
// someone changes packages/plugin-sdk/src and forgets `npm run sdk:build`.
describe("plugin SDK build", () => {
  it("produces an ES module and an IIFE, and the examples' copies are current", async () => {
    type Chunk = { fileName: string; code: string };
    const result = (await build({
      configFile: resolve(__dirname, "../../packages/plugin-sdk/vite.config.ts"),
      logLevel: "silent",
      build: { write: false },
      plugins: [], // the config's own plugin copies files, which a check must not do
    })) as unknown as Array<{ output: Chunk[] }>;
    const files = Object.fromEntries(result.flatMap((r) => r.output).map((o) => [o.fileName, o.code]));
    expect(Object.keys(files).sort()).toEqual(["shard-sdk.iife.js", "shard-sdk.js"]);
    expect(files["shard-sdk.iife.js"]).toContain("ShardSDK");
    expect(files["shard-sdk.js"]).toMatch(/export \{/);
    for (const example of ["hello", "hash-wasm"]) {
      const vendored = readFileSync(resolve(__dirname, `../../plugins/examples/${example}/shard-sdk.js`), "utf8");
      expect(vendored, example).toBe(files["shard-sdk.js"]);
    }
  });
});
