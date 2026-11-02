// @vitest-environment node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import rootConfig from "../../tailwind.config";
import preset from "../../packages/plugin-sdk/template/tailwind.preset";
import { validateManifest } from "../../src/plugins/schema";

const root = path.resolve(__dirname, "..", "..");
const template = path.join(root, "packages", "plugin-sdk", "template");
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");

describe("plugin template", () => {
  it("ships the current SDK source", () => {
    // `npm run sdk:build` copies it. This fails when someone changes the SDK and forgets to.
    expect(read(template, "src", "shard-sdk.ts")).toBe(read(root, "packages", "plugin-sdk", "src", "index.ts"));
  });

  it("has a valid manifest whose version matches package.json", () => {
    const manifest = JSON.parse(read(template, "public", "plugin.json"));
    const result = validateManifest(manifest);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(JSON.parse(read(template, "package.json")).version).toBe(manifest.version);
    expect(read(template, "public", "CHANGELOG.md")).toContain(`## ${manifest.version}`);
  });

  it("uses the same Tailwind tokens as the app", () => {
    const { colors, fontSize, fontFamily, borderRadius } = rootConfig.theme.extend;
    const { sidebar: _sidebar, ...appColors } = colors;
    expect(preset.darkMode).toEqual(rootConfig.darkMode);
    expect(preset.theme.extend).toEqual({ colors: appColors, fontSize, fontFamily, borderRadius });
  });

  describe("build", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-template-"));
    afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

    it("writes dist, a zip and its checksum", () => {
      const dir = path.join(work, "my-plugin");
      fs.cpSync(template, dir, { recursive: true, filter: (src) => !/node_modules|[\\/](dist|release)([\\/]|$)/.test(src) });
      // The template's own dependencies are the app's own: reuse them instead of installing.
      fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");

      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      execFileSync(npm, ["run", "build"], { cwd: dir, stdio: "pipe", shell: process.platform === "win32" });

      const html = read(dir, "dist", "index.html");
      expect(html).toMatch(/src="\.\/assets\/index-[\w-]+\.js"/);
      expect(html).not.toMatch(/(src|href)="\//);
      expect(fs.readdirSync(path.join(dir, "dist")).sort()).toEqual(["CHANGELOG.md", "assets", "index.html", "plugin.json"]);

      const zipName = "my-plugin-0.1.0.zip";
      const zip = fs.readFileSync(path.join(dir, "release", zipName));
      const files = unzipSync(new Uint8Array(zip));
      const names = Object.keys(files).sort();
      expect(names.filter((n) => !n.startsWith("assets/"))).toEqual(["CHANGELOG.md", "index.html", "plugin.json"]);
      expect(names.some((n) => /^assets\/.+\.js$/.test(n))).toBe(true);
      expect(names.some((n) => /^assets\/.+\.css$/.test(n))).toBe(true);
      const sha = crypto.createHash("sha256").update(zip).digest("hex");
      expect(read(dir, "release", `${zipName}.sha256`)).toBe(`${sha}  ${zipName}\n`);

      // Packing the same files again gives the same bytes.
      execFileSync(npm, ["run", "build"], { cwd: dir, stdio: "pipe", shell: process.platform === "win32" });
      expect(fs.readFileSync(path.join(dir, "release", zipName)).equals(zip)).toBe(true);
    }, 120_000);
  });
});
