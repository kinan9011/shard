# Signed repository indexes

Shard's two built-in repositories, [`shard-plugins`](https://github.com/kinan9011/shard-plugins) and
[`shard-themes`](https://github.com/kinan9011/shard-themes), can sign their `index.json`. Shard then refuses an index that was
changed after it was signed, so a stolen GitHub token or a bad commit cannot swap in other download links. Repositories a user
adds are not signed and are not checked.

The signature is `index.json.sig`, next to the index. The format is the one the Tauri updater uses (minisign, wrapped once in base64).

Until the public key is set in `src-tauri/src/plugins/signing.rs`, Shard checks nothing and an unsigned index keeps working.
**Turn it on in this order**, or every sync of the built-in repositories fails:

1. Generate a key pair (use a password): `npx tauri signer generate -w shard-index.key`.
   Keep `shard-index.key` secret. The `.pub` file is public.
2. In **both** repositories add the secrets `INDEX_SIGNING_KEY` (the content of `shard-index.key`) and `INDEX_SIGNING_PASSWORD`.
3. Add the signing step of [`docs/ci/sign-index.yml`](ci/sign-index.yml) to each repository's workflow (it explains where the
   step goes and how the signature is committed in each repository), then release `shard-plugins` once and push to `main`
   of `shard-themes`, so `index.json.sig` is committed next to `index.json`. Check that `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/index.json.sig` answers.
4. Paste the content of `shard-index.key.pub` into `INDEX_PUBLIC_KEY` in `src-tauri/src/plugins/signing.rs` and ship that version.

Older Shard versions ignore the `.sig` file, so signing first and shipping the key later is safe.

Every later change to `index.json` must be signed. In `shard-plugins` the release commits the signature with the index.
In `shard-themes` the `sign` job commits `index.json.sig` right after a push to `main`, so for about a minute the index and its
signature do not match and a sync of that repository fails until the next one.
If the private key is lost or leaked, make a new pair, update both repositories' secrets and ship a version with the new public key.
