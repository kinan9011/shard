const SCHEME = "shard-plugin";

/** WebView2 serves a custom scheme as http://<scheme>.localhost/, with the plugin id as the first path segment. */
function isWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

/** The address of a file (`.` and `..` segments are dropped, so a path cannot name another plugin) in an installed plugin, as served by src-tauri/src/plugins/protocol.rs. */
export function pluginUrl(id: string, path = ""): string {
  const rest = path
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map(encodeURIComponent)
    .join("/");
  return isWindows() ? `http://${SCHEME}.localhost/${id}/${rest}` : `${SCHEME}://${id}/${rest}`;
}
