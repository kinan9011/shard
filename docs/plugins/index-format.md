# Repository index (`index.json`)

A repository that lists many plugins has an `index.json` at the root of its default branch.

```json
{
  "schema": 1,
  "name": "Shard Official",
  "plugins": [
    {
      "id": "kafka-inspector",
      "name": "Kafka Inspector",
      "version": "0.3.1",
      "description": "Browse topics and decode messages from a local broker.",
      "category": "Development",
      "runtime": "web",
      "permissions": [{ "name": "files:open", "reason": "Read files you open in the tool" }],
      "minAppVersion": "1.0.0",
      "url": "https://github.com/…/releases/download/…/kafka-inspector-0.3.1.zip",
      "sha256": "<64 lowercase hex characters>",
      "size": 2516582,
      "released": "2026-10-18",
      "changelog": "Adds …",
      "icon": "https://raw…/icon.svg"
    }
  ],
  "bundles": [
    { "id": "ops-infra", "name": "Ops & infrastructure", "plugins": ["kafka-inspector"] }
  ]
}
```

## Fields

Top level: `schema` (must be `1`), `name` (non-empty), `plugins` (array). `bundles` (array) is optional.

Each plugin: `id`, `name`, `version`, `description`, `runtime`, `url` (URI), `sha256`
(64 lowercase hex characters) and `size` (bytes, integer ≥ 0) are required. `category`,
`permissions` (same shape as the manifest), `minAppVersion`, `released` (`YYYY-MM-DD`),
`changelog` and `icon` (a URL) are optional. `id` and `version` follow the manifest rules. An id may
appear only once per index. Unknown fields are ignored.

Each bundle: `id` (same rules as a plugin id, unique within the index), `name` (non-empty) and
`plugins` (at least one plugin id, each listed in this index's `plugins`). The first-run screen of
the Launcher layout offers bundles as cards ("Web & APIs", "Data & SQL", …) so a new user can pick
a set of plugins in one click. An index without `bundles` stays valid, and the screen then falls back
to the plugin-by-plugin list. A releases repository has no bundles.

## Building the index

The official repository, [`kinan9011/shard-plugins`](https://github.com/kinan9011/shard-plugins), builds its index from the plugin zips (`<id>-<version>.zip`, optionally with its `.sha256` file, as the plugin template's `npm run build` writes them) in its release workflow. `url` is `<base-url>/<zip name>`; `sha256` and `size` are computed from the zip.

## Verification

The app downloads `url`, checks the SHA-256 against `sha256` (and the length against `size`), and
only then unpacks. A mismatch aborts the install.

## Single-plugin repositories (GitHub Releases)

A repository with one plugin has no `index.json`. Its latest release carries three assets:
`plugin.json`, `plugin.zip` and `plugin.zip.sha256`.

Detection uses no GitHub API (60 requests per hour unauthenticated), in this order:

1. `GET raw.githubusercontent.com/<owner>/<repo>/HEAD/index.json`. A 200 means an index repository.
2. Otherwise `GET github.com/<owner>/<repo>/releases/latest/download/plugin.json`. A 200 means a releases repository.
3. Otherwise the error "Not a plugin repository".

## Repositories in the app

The app keeps its repository list in `repos.json` (in the app data folder) and the last good copy of
each repository's catalog in `repo-cache/<hash>.json`.

- **Adding.** Paste `github.com/<owner>/<repo>`, with or without `https://`, `www.`, `.git` or a
  trailing slash. The app detects the type (see above) and adds the repository only if that works.
  A repository can be added once. Names are case-insensitive.
- **Official repository.** `github.com/kinan9011/shard-plugins` is there from the first launch. It
  can be turned off but not removed.
- **Sync.** Fetches the index (or the release's `plugin.json` and `plugin.zip.sha256`) and validates
  it. On success the cache is replaced and `lastSync` is set. On failure the old cache stays in use and
  `lastError` holds the reason, for example `index.json not found (404)`, `HTTP 500`,
  `index.json: …` (invalid JSON or a schema error) or `Not a plugin repository`.
- **Turned off.** A disabled repository is skipped by "sync all" and left out of the catalog.
- **Settings.** `checkOnStart` (default on) and `allowOutside` (default off: installs from a zip,
  folder or URL outside these repositories are refused).

## Installing and updating

- **From a repository.** The app downloads the entry's `url` into `plugins/.downloads`, with a
  `plugin://progress` event (`{id, received, total}`) while it runs. The SHA-256 of the file must equal
  `sha256`, and the length must equal `size` when the index lists one. Only then is the package unpacked
  (same rules as a zip install). The package's own `plugin.json` must have the listed `id` and `version`
  and may not ask for a permission (or a `network` host) the index did not list. A failure at any step
  leaves nothing installed and no files behind. The record is `{kind: "repo", repo}` and `verified: true`.
- **From a URL.** A pasted `github.com/<owner>/<repo>` is looked up (`plugin_lookup_url`): name, version,
  size, runtime and whether the downloaded package matches the repository's checksum. The URL must lead to
  exactly one plugin. Installing it with "add this repository" adds the repository first (and takes it out
  again if the install fails). A repository that is already in the list and on counts as a repository install.
- **Outside the repositories.** A zip, a folder, or a URL whose repository is not in the list is a
  sideload. It is refused unless `allowOutside` is on. It is recorded as unverified (`verified: false`).
  `repo_set_settings` reads and changes `checkOnStart` and `allowOutside`.
- **Updates.** `plugin_updates` compares each repository-installed plugin with the last synced
  catalog of its repository by semver and returns `{id, name, from, to, changelog, newPermissions, repo}`.
  `newPermissions` lists the permission names the new version asks for on top of the installed one
  (`network` also when it lists a new host). An entry whose `minAppVersion` is above the app version is
  left out, and installing it fails with `Requires Shard <version>`. `plugin_update` installs it
  through the install path above. The grants stay as they were (only those the new manifest still
  declares), and a new permission is not granted until `plugin_set_grants`.
- **Check on start.** With `checkOnStart` on, the app syncs the enabled repositories in the background
  after it starts and emits `plugins://updates` with the number of updates. The window may not be
  listening yet, so the UI also asks `plugin_updates` when it opens.
