// @vitest-environment node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { validateIndex } from "../../src/plugins/schema";

const script = path.resolve(__dirname, "..", "..", "scripts", "plugin-index.mjs");
const BASE = "https://github.com/kinan9011/shard-plugins/releases/download/v1";

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-index-"));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const manifest = (over: Record<string, unknown> = {}) => ({
  id: "hash-tool",
  name: "Hash Tool",
  version: "1.0.0",
  description: "Hashes things.",
  category: "Security",
  entry: "index.html",
  runtime: "web",
  icon: "lucide:Hash",
  permissions: [{ name: "clipboard:write", reason: "Copy hashes", optional: true }],
  ...over,
});

/** Writes `<id>-<version>.zip` (files at the top level, or inside `top/`) and returns its path. */
function writeZip(dir: string, m: Record<string, unknown>, opts: { top?: string; extra?: Record<string, string>; sidecar?: boolean | string } = {}) {
  const prefix = opts.top ? `${opts.top}/` : "";
  const files: Record<string, Uint8Array> = {
    [`${prefix}plugin.json`]: strToU8(JSON.stringify(m)),
    [`${prefix}index.html`]: strToU8("<html></html>"),
  };
  for (const [name, text] of Object.entries(opts.extra ?? {})) files[`${prefix}${name}`] = strToU8(text);
  const file = path.join(dir, `${m.id}-${m.version}.zip`);
  const bytes = zipSync(files, { mtime: new Date(2026, 0, 1) });
  fs.writeFileSync(file, bytes);
  if (opts.sidecar) {
    const sha = typeof opts.sidecar === "string" ? opts.sidecar : crypto.createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`);
  }
  return { file, bytes };
}

const run = (args: string[]) => {
  try {
    return { status: 0, output: execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
};

const readIndex = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

describe("plugin-index", () => {
  it("creates an index entry from a zip, with checksum, size, url and changelog", () => {
    const zips = makeTempDir();
    const out = path.join(makeTempDir(), "index.json");
    const m = manifest({ changelog: "CHANGELOG.md" });
    const { bytes } = writeZip(zips, m, {
      sidecar: true,
      extra: { "CHANGELOG.md": "# Changelog\n\n## 1.0.0\n\nFirst release.\nIt hashes.\n\n## 0.9.0\n\nOlder.\n" },
    });

    const result = run(["--zips", zips, "--base-url", `${BASE}/`, "--index", out, "--name", "Shard Official", "--date", "2026-11-01"]);

    expect(result.status, result.output).toBe(0);
    const index = readIndex(out);
    expect(index.schema).toBe(1);
    expect(index.name).toBe("Shard Official");
    expect(index.plugins).toEqual([
      {
        id: "hash-tool",
        name: "Hash Tool",
        version: "1.0.0",
        description: "Hashes things.",
        category: "Security",
        runtime: "web",
        permissions: [{ name: "clipboard:write", reason: "Copy hashes", optional: true }],
        url: `${BASE}/hash-tool-1.0.0.zip`,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        released: "2026-11-01",
        changelog: "First release.\nIt hashes.",
        icon: "lucide:Hash",
      },
    ]);
    expect(validateIndex(index).ok).toBe(true);
  });

  it("finds the package root inside a single top folder", () => {
    const zips = makeTempDir();
    const out = path.join(makeTempDir(), "index.json");
    writeZip(zips, manifest(), { top: "hash-tool" });

    const result = run(["--zips", zips, "--base-url", BASE, "--index", out, "--name", "Official"]);

    expect(result.status, result.output).toBe(0);
    expect(readIndex(out).plugins[0].id).toBe("hash-tool");
  });

  it("updates one plugin and keeps the other entries, the name and the bundles", () => {
    const out = path.join(makeTempDir(), "index.json");
    const other = { id: "zeta", name: "Zeta", version: "2.0.0", description: "z", runtime: "web", url: "https://x.test/zeta.zip", sha256: "a".repeat(64), size: 5 };
    const bundles = [{ id: "starter", name: "Starter", plugins: ["zeta", "hash-tool"] }];
    fs.writeFileSync(out, JSON.stringify({ schema: 1, name: "Mine", bundles, plugins: [other, { ...other, id: "hash-tool", version: "0.9.0" }] }));
    const zips = makeTempDir();
    writeZip(zips, manifest({ version: "1.0.0" }));

    const result = run(["--zips", zips, "--base-url", BASE, "--index", out]);

    expect(result.status, result.output).toBe(0);
    const index = readIndex(out);
    expect(index.name).toBe("Mine");
    expect(index.bundles).toEqual(bundles);
    expect(index.plugins.map((p: { id: string; version: string }) => `${p.id}@${p.version}`)).toEqual(["hash-tool@1.0.0", "zeta@2.0.0"]);
    expect(index.plugins[1]).toEqual(other);
    expect(validateIndex(index).ok).toBe(true);
  });

  it("refuses a version that is not newer, and leaves the index as it was", () => {
    const out = path.join(makeTempDir(), "index.json");
    const before = JSON.stringify({ schema: 1, name: "Mine", plugins: [{ id: "hash-tool", name: "Hash Tool", version: "1.0.0", description: "d", runtime: "web", url: "https://x.test/a.zip", sha256: "b".repeat(64), size: 1 }] });
    fs.writeFileSync(out, before);
    const zips = makeTempDir();
    writeZip(zips, manifest({ version: "1.0.0" }));

    const result = run(["--zips", zips, "--base-url", BASE, "--index", out]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('hash-tool 1.0.0 is not newer than the listed 1.0.0');
    expect(fs.readFileSync(out, "utf8")).toBe(before);
  });

  it("accepts the same zip again and accepts a release after a prerelease", () => {
    const out = path.join(makeTempDir(), "index.json");
    const zips = makeTempDir();
    writeZip(zips, manifest({ version: "1.1.0-beta.2" }));
    expect(run(["--zips", zips, "--base-url", BASE, "--index", out, "--name", "Official"]).status).toBe(0);
    expect(run(["--zips", zips, "--base-url", BASE, "--index", out]).status).toBe(0);
    expect(readIndex(out).plugins).toHaveLength(1);

    const next = makeTempDir();
    writeZip(next, manifest({ version: "1.1.0" }));
    expect(run(["--zips", next, "--base-url", BASE, "--index", out]).status).toBe(0);
    expect(readIndex(out).plugins[0].version).toBe("1.1.0");
  });

  it("uses the changelog section of the manifest's version, whatever the path spelling", () => {
    const zips = makeTempDir();
    const out = path.join(makeTempDir(), "index.json");
    writeZip(zips, manifest({ version: "1.2.0", changelog: "./docs/../CHANGELOG.md" }), {
      extra: { "CHANGELOG.md": "# Changelog\n\n## Unreleased\n\nNot yet.\n\n## [1.2.0] - 2026-11-01\n\nNew things.\n" },
    });
    expect(run(["--zips", zips, "--base-url", BASE, "--index", out, "--name", "N"]).status).toBe(0);
    expect(readIndex(out).plugins[0].changelog).toBe("New things.");
  });

  it("refreshes an entry for the same zip under a new base url and keeps its release date", () => {
    const zips = makeTempDir();
    const out = path.join(makeTempDir(), "index.json");
    writeZip(zips, manifest());
    run(["--zips", zips, "--base-url", BASE, "--index", out, "--name", "N", "--date", "2026-01-01"]);
    run(["--zips", zips, "--base-url", "https://moved.test/dl", "--index", out, "--date", "2026-11-01"]);
    expect(readIndex(out).plugins[0]).toMatchObject({ url: "https://moved.test/dl/hash-tool-1.0.0.zip", released: "2026-01-01" });
  });

  it("rejects a zip whose name is not <id>-<version>.zip", () => {
    const zips = makeTempDir();
    const { file } = writeZip(zips, manifest());
    fs.renameSync(file, path.join(zips, "copy.zip"));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("copy.zip: the file must be named hash-tool-1.0.0.zip");
  });

  it("reports a truncated zip as that file's error", () => {
    const zips = makeTempDir();
    const { bytes } = writeZip(makeTempDir(), manifest());
    fs.writeFileSync(path.join(zips, "hash-tool-1.0.0.zip"), bytes.subarray(0, bytes.length - 30));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("hash-tool-1.0.0.zip:");
    expect(result.output).not.toContain("    at ");
  });

  it("reports a listed version that is not semver instead of crashing", () => {
    const out = path.join(makeTempDir(), "index.json");
    fs.writeFileSync(out, JSON.stringify({ schema: 1, name: "N", plugins: [{ id: "hash-tool", name: "H", version: "1.0", description: "d", runtime: "web", url: "https://x.test/a.zip", sha256: "c".repeat(64), size: 1 }] }));
    const zips = makeTempDir();
    writeZip(zips, manifest({ version: "1.1.0" }));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", out]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('version "1.0", which is not a semver version');
  });

  it("needs --name for a new index", () => {
    const zips = makeTempDir();
    writeZip(zips, manifest());
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "index.json")]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("--name");
  });

  it("rejects a zip without plugin.json", () => {
    const zips = makeTempDir();
    fs.writeFileSync(path.join(zips, "broken-1.0.0.zip"), zipSync({ "index.html": strToU8("x") }));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("broken-1.0.0.zip: no plugin.json");
  });

  it("rejects an invalid manifest", () => {
    const zips = makeTempDir();
    writeZip(zips, manifest({ id: "Bad_ID" }));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('id "Bad_ID"');
  });

  it("rejects a checksum that does not match the .sha256 file", () => {
    const zips = makeTempDir();
    writeZip(zips, manifest(), { sidecar: "0".repeat(64) });
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("checksum mismatch");
  });

  it("rejects two zips for the same plugin", () => {
    const zips = makeTempDir();
    writeZip(zips, manifest({ version: "1.0.0" }));
    writeZip(zips, manifest({ version: "1.0.1" }));
    const result = run(["--zips", zips, "--base-url", BASE, "--index", path.join(makeTempDir(), "i.json"), "--name", "N"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("hash-tool is in more than one zip");
  });

  it("rejects a missing zip folder, a non-http base url and a folder without zips", () => {
    const out = path.join(makeTempDir(), "i.json");
    expect(run(["--zips", path.join(makeTempDir(), "nope"), "--base-url", BASE, "--index", out, "--name", "N"]).status).toBe(1);
    const zips = makeTempDir();
    writeZip(zips, manifest());
    expect(run(["--zips", zips, "--base-url", "ftp://x", "--index", out, "--name", "N"]).output).toContain("--base-url");
    expect(run(["--zips", makeTempDir(), "--base-url", BASE, "--index", out, "--name", "N"]).output).toContain("no .zip files");
  });
});

describe("official repository sources (plugins/)", () => {
  const plugins = path.resolve(__dirname, "..", "..", "plugins");

  it("ships a copy of this script, which the release workflow runs", () => {
    expect(fs.readFileSync(path.join(plugins, "scripts", "plugin-index.mjs"), "utf8")).toBe(fs.readFileSync(script, "utf8"));
    expect(fs.readFileSync(path.join(plugins, ".github", "workflows", "release.yml"), "utf8")).toContain("node scripts/plugin-index.mjs");
  });

  it("starts with a valid, empty index named like the official repository", () => {
    const index = JSON.parse(fs.readFileSync(path.join(plugins, "index.json"), "utf8"));
    expect(validateIndex(index).ok).toBe(true);
    expect(index).toMatchObject({ schema: 1, name: "Shard Official", plugins: [] });
  });
});
