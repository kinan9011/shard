# Plugin manifest (`plugin.json`)

Every plugin package has a `plugin.json` at its root. It is validated twice: by the JSON
schema in `src/plugins/schema.ts` (browsing, previews) and by `src-tauri/src/plugins/manifest.rs`
(the install gate, which can also see the files). Unknown fields are ignored, so newer
manifests still load on older apps.

```json
{
  "id": "kafka-inspector",
  "name": "Kafka Inspector",
  "version": "0.3.1",
  "description": "Browse topics and decode messages from a local broker.",
  "longDescription": "…",
  "category": "Development",
  "keywords": ["kafka", "avro"],
  "icon": "icon.svg",
  "entry": "index.html",
  "runtime": "web",
  "permissions": [
    { "name": "network", "hosts": ["localhost:9092"], "reason": "Connect to localhost:9092 and brokers you add", "optional": false },
    { "name": "files:open", "reason": "Read files you open in the tool" },
    { "name": "clipboard:write", "reason": "Copy decoded messages", "optional": true }
  ],
  "minAppVersion": "3.0.0",
  "license": "MIT",
  "source": "https://github.com/kinan9011/kafka-inspector",
  "screenshots": ["shot1.png"],
  "changelog": "CHANGELOG.md"
}
```

## Fields

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | string | yes | `^[a-z0-9][a-z0-9-]{1,63}$`. Unique. Must not equal the id of any built-in tool (core or legacy). |
| `name` | string | yes | Non-empty. Shown in the sidebar and the Plugins page. |
| `version` | string | yes | Strict semver (`1.2.3`, `1.2.3-beta.1`, `1.2.3+build.5`). No `v` prefix, no partial versions. |
| `description` | string | yes | Non-empty, one line. |
| `longDescription` | string | no | Plain text or limited markdown for the detail Overview. |
| `category` | string | no | Free string, matched to the sidebar categories. |
| `keywords` | string[] | no | Used by search. |
| `icon` | string | no | A file in the package (`icon.svg`) or `lucide:<Name>`. |
| `entry` | string | yes | Path of the HTML file to load, relative to the package root. Must exist, must stay inside the package. |
| `runtime` | `"web"` \| `"wasm"` \| `"web+wasm"` | yes | `wasm` and `web+wasm` add the informational "Runs sandboxed" row to the permission list. |
| `permissions` | object[] | no | See [permissions.md](permissions.md). |
| `minAppVersion` | string | no | Strict semver. |
| `license` | string | no | SPDX identifier. |
| `source` | string | no | `http(s)://` link to the source repository. |
| `screenshots` | string[] | no | Files in the package. |
| `changelog` | string | no | File in the package. |

## Errors

Validators return every problem at once, as `path: message` lines:

```
id: "Bad_ID" must match ^[a-z0-9][a-z0-9-]{1,63}$
version: "v1.0" is not a valid semver version
permissions[0].hosts: network needs at least one host
```

The Rust validator additionally rejects a missing or escaping `entry` and a built-in id. The TS
validator cannot see the package files, so it leaves those two checks to Rust. The built-in id
list lives in `BUILTIN_TOOL_IDS` in `manifest.rs`; `tests/plugins/schema.test.ts` fails if it
drifts from `ALL_TOOLS`.
