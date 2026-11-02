# Plugin permissions (v1)

A plugin lists what it needs in `permissions` in `plugin.json`. The user approves them at install
time. The host checks every SDK call against the approved set; a plugin has no other way to reach
the system (it runs in a sandboxed iframe with no Tauri IPC).

```json
{ "name": "network", "hosts": ["localhost:9092"], "reason": "Connect to brokers", "optional": false }
```

| Field | Rule |
| --- | --- |
| `name` | One of the names below. Unknown names are rejected. |
| `reason` | Required, non-empty. Shown to the user next to the permission. |
| `hosts` | Required (at least one) for `network`. Not allowed on any other permission. |
| `optional` | Default `false`. Optional permissions may be declined; the plugin must cope without them. |

## Names

| Name | Grants |
| --- | --- |
| `clipboard:read` | Read text from the clipboard. |
| `clipboard:write` | Write text to the clipboard. |
| `files:open` | Show the open dialog and read the files the user picks. |
| `files:save` | Show the save dialog and write to the file the user picks. |
| `network` | HTTP(S) requests to the listed `hosts` only, made by the host on the plugin's behalf. |
| `storage` | A per-plugin key-value store, 1 MB. Implicit: always granted, listing it is optional. |

`wasm` is not a permission. It is implied by `runtime` (`wasm` or `web+wasm`) and shown as an
informational row: "Runs sandboxed, with no direct access to your system".

## `network.hosts`

Each entry is `host[:port]` or `*.host[:port]`, with no scheme, path or whitespace. `*.` matches any
subdomain, not the bare domain. Without a port, the default port for the scheme is meant. Only
`http` and `https` are ever used.

Valid: `localhost:9092`, `api.example.com`, `*.example.com`.
Invalid: `https://example.com`, `example.com/path`, `example.com:`.

## Grants

What the user approved is stored per plugin in `plugins.json` as `granted`, a list of strings:

- a permission name the manifest declares: `clipboard:read`, `clipboard:write`, `files:open`, `files:save`, `network`;
- `network:<host>` for a host the user added on top of the manifest's `hosts` (`network:broker.example.com:9093`). It
  only counts while `network` itself is granted.

`storage` is never stored, it is always on. The app changes grants with `plugin_set_grants(id, grants)`, which
rejects a name the manifest does not declare, and stores the list sorted without duplicates. Updating a plugin keeps
its grants, except the ones the new manifest no longer declares. If the new version lists a `network` host that the
approved one did not, the plain `network` grant is dropped too and the user has to approve again. Hosts the user added
themselves (`network:<host>`) stay. A grant never carries over to another name:
`clipboard:write` does not allow reading.

## Enforcement

Every SDK call that needs a permission goes through one check in the host bridge (`src/plugins/bridge.ts`). The
bridge reads the plugin's current grants on each call, so a revoke applies to a frame that is already open. A call
without the grant is not run, and is answered with

```json
{ "v": 1, "id": "k3-1", "error": { "code": "permission_denied", "message": "This plugin has not been granted clipboard:write", "permission": "clipboard:write" } }
```

The SDK turns it into a `PermissionError` with `.permission`. The grant check comes before the arguments are looked at.
The commands that do the work in Rust (`plugin_fetch`, `plugin_open_file`) check the grant again.

| SDK call | Needs | Notes |
| --- | --- | --- |
| `clipboard.readText()` | `clipboard:read` | |
| `clipboard.writeText(text)` | `clipboard:write` | Up to 1 MB. |
| `files.open({ accept, as })` | `files:open` | One at a time. The app shows the dialog. `null` when cancelled. Over 50 MB rejects. |
| `files.save(name, data)` | `files:save` | The app shows the dialog. `false` when cancelled. Up to 50 MB. |
| `net.fetch(url, init)` | `network` | See below. |
| `storage.*`, `toast`, `theme.*` | nothing | |

### `net.fetch` limits

The app makes the request (Rust, `reqwest`), never the plugin's frame.

- Only `http` and `https`, and only to the `hosts` in the manifest plus the hosts the user added. Host and port must
  match. A host without a port means 80 for `http` and 443 for `https`. `*.example.com` does not match `example.com`.
- Methods: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`. The body is text. These headers are ignored: `host`, `content-length`, `cookie`, `origin`, `connection`,
  `transfer-encoding`, `proxy-*` and `sec-*`. At most 6 requests run at once per plugin.
- Redirects are followed up to 5 times, and each hop must be an allowed host. A redirect to any other host fails the request.
- 30 second timeout for the whole request. A response over 20 MB fails, whether the size is declared or only
  found out while reading.
- Known limit: the check is on the host name in the URL, not on the address it resolves to. A name the plugin
  controls can point at a local address. Allow only hosts you trust.

