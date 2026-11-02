// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@/plugins/schema";

const dir = resolve(__dirname, "../../plugins/examples/hash-wasm");

// The committed module is what the example installs. Rebuild it with `task plugin:example-wasm`.
async function load() {
  const { instance } = await WebAssembly.instantiate(readFileSync(resolve(dir, "hash.wasm")), {});
  const { memory, alloc, dealloc, sha256 } = instance.exports as { memory: WebAssembly.Memory; alloc(n: number): number; dealloc(p: number, n: number): void; sha256(i: number, n: number, o: number): void };
  return (bytes: Uint8Array) => {
    const input = alloc(bytes.length);
    const output = alloc(32);
    new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
    sha256(input, bytes.length, output);
    const hex = Buffer.from(new Uint8Array(memory.buffer, output, 32)).toString("hex");
    dealloc(input, bytes.length);
    dealloc(output, 32);
    return hex;
  };
}

describe("hash-wasm example", () => {
  it("has a valid manifest that declares the wasm runtime", () => {
    const manifest = JSON.parse(readFileSync(resolve(dir, "plugin.json"), "utf8"));
    expect(validateManifest(manifest)).toMatchObject({ ok: true });
    expect(manifest.runtime).toBe("web+wasm");
  });

  it("needs no imports and exports the linear-memory functions", async () => {
    const module = await WebAssembly.compile(readFileSync(resolve(dir, "hash.wasm")));
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    // The linker also exports __data_end and __heap_base.
    expect(WebAssembly.Module.exports(module).map((e) => e.name)).toEqual(expect.arrayContaining(["alloc", "dealloc", "memory", "sha256"]));
  });

  it("matches node's SHA-256 for empty, short, block-edge and large inputs", async () => {
    const hash = await load();
    const inputs = [new Uint8Array(), new TextEncoder().encode("abc"), ...[55, 56, 63, 64, 65, 119, 120].map((n) => randomBytes(n)), randomBytes(1_000_000)];
    for (const bytes of inputs) {
      expect(hash(bytes), `${bytes.length} bytes`).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });
});
