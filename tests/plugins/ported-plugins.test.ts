// @vitest-environment node
// The plugins ported out of the app in W27 and W28 (plugins/hash-generator, uuid-generator, cron-calculator, markdown, color-palette): their package, build, and the
// tests that the root vitest config cannot pick up (the Rust crate of the hash module).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { validateIndex, validateManifest } from "../../src/plugins/schema";

const root = path.resolve(__dirname, "..", "..");
const template = path.join(root, "packages", "plugin-sdk", "template");
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");

const PLUGINS = [
  { id: "hash-generator", runtime: "web+wasm", files: ["hash.wasm"] },
  { id: "uuid-generator", runtime: "web", files: [] as string[] },
  { id: "cron-calculator", runtime: "web", files: [] as string[] },
  { id: "markdown", runtime: "web", files: [] as string[] },
  { id: "color-palette", runtime: "web", files: [] as string[] },
];

describe.each(PLUGINS)("ported plugin $id", ({ id, runtime, files }) => {
  const dir = path.join(root, "plugins", id);

  it("has a valid manifest whose version matches package.json and the changelog", () => {
    const manifest = JSON.parse(read(dir, "public", "plugin.json"));
    const result = validateManifest(manifest);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(manifest).toMatchObject({ id, runtime });
    expect(JSON.parse(read(dir, "package.json"))).toMatchObject({ name: id, version: manifest.version });
    expect(read(dir, "public", "CHANGELOG.md")).toContain(`## ${manifest.version}`);
    // Every optional permission has a reason the user reads.
    for (const permission of manifest.permissions) expect(permission.reason, permission.name).toBeTruthy();
  });

  it("keeps the template's SDK copy and pack script", () => {
    expect(read(dir, "src", "shard-sdk.ts")).toBe(read(root, "packages", "plugin-sdk", "src", "index.ts"));
    expect(read(dir, "scripts", "pack.mjs")).toBe(read(template, "scripts", "pack.mjs"));
    expect(read(dir, "tailwind.preset.ts")).toBe(read(template, "tailwind.preset.ts"));
  });

  describe("build", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `ported-${id}-`));
    afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

    it("packs a zip with the entry, the assets and its checksum, and the index script lists it", () => {
      const copy = path.join(work, id);
      fs.cpSync(dir, copy, { recursive: true, filter: (src) => !/node_modules|[\\/](dist|release|target)([\\/]|$)/.test(src) });
      fs.symlinkSync(path.join(root, "node_modules"), path.join(copy, "node_modules"), "dir");
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      execFileSync(npm, ["run", "build"], { cwd: copy, stdio: "pipe", shell: process.platform === "win32" });

      const version = JSON.parse(read(dir, "public", "plugin.json")).version;
      const zipName = `${id}-${version}.zip`;
      const zip = fs.readFileSync(path.join(copy, "release", zipName));
      const names = Object.keys(unzipSync(new Uint8Array(zip))).sort();
      expect(names.filter((name) => !name.startsWith("assets/"))).toEqual(["CHANGELOG.md", ...files, "index.html", "plugin.json"].sort());
      expect(names.some((name) => /^assets\/.+\.js$/.test(name))).toBe(true);
      const sha = crypto.createHash("sha256").update(zip).digest("hex");
      expect(read(copy, "release", `${zipName}.sha256`)).toBe(`${sha}  ${zipName}\n`);

      const out = path.join(work, "index.json");
      execFileSync(process.execPath, [path.join(root, "scripts", "plugin-index.mjs"), "--zips", path.join(copy, "release"), "--base-url", "https://example.test/dl", "--index", out, "--name", "Test"], { stdio: "pipe" });
      const index = JSON.parse(read(out));
      expect(validateIndex(index).ok).toBe(true);
      expect(index.plugins[0]).toMatchObject({ id, version, sha256: sha, size: zip.length, runtime });
    }, 120_000);
  });
});

describe("hash-generator's WebAssembly crate", () => {
  // The Rust tests live next to the crate and are not part of src-tauri, so the gate runs them here.
  it("passes its own tests and clippy has nothing to say", () => {
    const manifest = path.join(root, "plugins", "hash-generator", "wasm", "Cargo.toml");
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "hash-wasm-target-"));
    try {
      const run = (command: string, after: string[] = []) => execFileSync("cargo", [command, "--manifest-path", manifest, "--offline", "--target-dir", target, ...after], { stdio: "pipe", encoding: "utf8" });
      // A failure throws, with cargo's output in the message.
      expect(run("test")).toMatch(/test result: ok\. [1-9]\d* passed/);
      run("clippy", ["--all-targets", "--", "-D", "warnings"]);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }, 300_000);

  it("ships a hash.wasm that needs no imports", async () => {
    const module = await WebAssembly.compile(fs.readFileSync(path.join(root, "plugins", "hash-generator", "public", "hash.wasm")));
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module).map((entry) => entry.name)).toEqual(expect.arrayContaining(["alloc", "dealloc", "digest_into", "hmac_into", "memory"]));
  });
});
