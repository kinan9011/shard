import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

// Library build: an ES module (`shard-sdk.js`) and an IIFE (`shard-sdk.iife.js`, global `ShardSDK`).
// The ES module is also copied into the examples, which vendor it (the plugin CSP allows only its own files),
// and the source into the plugin template.
export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    minify: false,
    target: "es2020",
    lib: {
      entry: resolve(root, "src/index.ts"),
      name: "ShardSDK",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "shard-sdk.js" : "shard-sdk.iife.js"),
    },
  },
  plugins: [
    {
      name: "vendor-sdk-into-examples",
      writeBundle() {
        for (const example of ["hello", "hash-wasm"]) {
          copyFileSync(resolve(root, "dist/shard-sdk.js"), resolve(root, `../../plugins/examples/${example}/shard-sdk.js`));
        }
        // The template bundles the SDK source with its own build.
        copyFileSync(resolve(root, "src/index.ts"), resolve(root, "template/src/shard-sdk.ts"));
      },
    },
  ],
});
