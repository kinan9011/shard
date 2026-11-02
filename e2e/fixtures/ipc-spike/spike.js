// Runs inside a plugin frame (sandbox="allow-scripts"). It checks that the frame cannot reach Tauri IPC
// and reports the result to the host page, which the e2e self-test reads.
// Every check is true when the frame is isolated, except the "info" entries.
const results = {};
// The host shows its crash screen for a plugin that has not said "ready" within 10 s. This page does not load the SDK, so say it by hand.
parent.postMessage({ v: 1, id: "spike-ready", method: "ready" }, "*");
const report = (type) => parent.postMessage({ type, results }, "*");
const attempt = async (name, run) => {
  try {
    results[name] = await run();
  } catch (error) {
    results[name] = `error: ${error && error.message}`;
  }
  report("e2e-ipc-spike-progress");
};
window.addEventListener("error", (event) => {
  results.scriptError = String(event.message);
  report("e2e-ipc-spike-progress");
});

await attempt("noTauriInternals", () => typeof window.__TAURI_INTERNALS__ === "undefined");
await attempt("noTauriGlobal", () => typeof window.__TAURI__ === "undefined");
await attempt("noIpcObject", () => typeof window.ipc === "undefined");
await attempt("parentDocumentThrows", () => {
  try {
    void parent.document;
    return false;
  } catch {
    return true;
  }
});
await attempt("parentTauriThrows", () => {
  try {
    void parent.__TAURI_INTERNALS__;
    return false;
  } catch {
    return true;
  }
});
for (const url of ["ipc://localhost/plugin_set_enabled", "http://ipc.localhost/plugin_set_enabled"]) {
  await attempt(`fetch ${url} fails`, async () => {
    try {
      await fetch(url, { method: "POST", body: JSON.stringify({ id: "e2e-ipc-spike", enabled: false }) });
      return false;
    } catch {
      return true;
    }
  });
}

// The CSP allows the plugin's own files and nothing else.
await attempt("ownFileFetchAllowed", async () => (await fetch("plugin.json")).ok);
await attempt("otherOriginFetchBlocked", async () => {
  try {
    await fetch("https://example.com/");
    return false;
  } catch {
    return true;
  }
});
await attempt("ownStylesheetLoads", () =>
  new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "style.css";
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  }),
);
// The CSP in the protocol response forbids inline scripts.
await attempt("inlineScriptBlockedByCsp", () => {
  window.__inline = false;
  const script = document.createElement("script");
  script.textContent = "window.__inline = true";
  document.head.append(script);
  return window.__inline === false;
});

// The WebKit message handler can exist in every frame. Without the per-run invoke key, which only the
// app's top frame has, a message must be refused. The command would disable this very plugin.
const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc;
results["info: webkit ipc handler reachable"] = Boolean(handler);
if (handler) {
  const message = { cmd: "plugin_set_enabled", callback: 1, error: 2, payload: { id: "e2e-ipc-spike", enabled: false } };
  await attempt("keyless ipc message sent", () => {
    handler.postMessage(JSON.stringify(message));
    return true;
  });
  await attempt("guessed-key ipc message sent", () => {
    handler.postMessage(JSON.stringify({ ...message, __TAURI_INVOKE_KEY__: "guess" }));
    return true;
  });
}

report("e2e-ipc-spike");
