const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15e3;
class SdkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SdkError";
    this.code = code;
  }
}
class PermissionError extends SdkError {
  constructor(message, permission) {
    super("permission_denied", message);
    this.name = "PermissionError";
    this.permission = permission;
  }
}
let counter = 0;
function nextId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
async function loadWasm(path, imports = {}) {
  const url = new URL(path, location.href).href;
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return await WebAssembly.instantiateStreaming(fetch(url), imports);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new SdkError("failed", `Could not load ${path}: ${response.status} ${response.statusText}`.trim());
  return WebAssembly.instantiate(await response.arrayBuffer(), imports);
}
async function spawnWorker(path, options) {
  const response = await fetch(new URL(path, location.href).href);
  if (!response.ok) throw new SdkError("failed", `Could not load ${path}: ${response.status} ${response.statusText}`.trim());
  const blob = new Blob([await response.arrayBuffer()], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return new Worker(url, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}
function connect(options = {}) {
  const self = options.self ?? window;
  const target = options.target ?? window.parent;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const visibilityListeners = /* @__PURE__ */ new Set();
  self.addEventListener("error", (event) => {
    target.postMessage({ v: PROTOCOL_VERSION, event: "error", message: String(event.message || event.error || "Unknown error").slice(0, 500) }, "*");
  });
  self.addEventListener("message", (event) => {
    if (event.source !== target) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.v !== PROTOCOL_VERSION) return;
    if (data.event === "theme") {
      for (const listener of [...listeners]) {
        try {
          listener(data.data);
        } catch (error) {
          console.error(error);
        }
      }
      return;
    }
    if (data.event === "visibility") {
      for (const listener of [...visibilityListeners]) {
        try {
          listener(Boolean(data.data?.visible));
        } catch (error) {
          console.error(error);
        }
      }
      return;
    }
    if (typeof data.id !== "string") return;
    const call2 = pending.get(data.id);
    if (!call2) return;
    pending.delete(data.id);
    if (call2.timer !== void 0) clearTimeout(call2.timer);
    if (data.error) {
      const { code, message, permission } = data.error;
      call2.reject(code === "permission_denied" ? new PermissionError(String(message), String(permission)) : new SdkError(String(code), String(message)));
    } else call2.resolve(data.result);
  });
  function call(method, params, limit = timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timer = limit === null ? void 0 : setTimeout(() => {
        pending.delete(id);
        reject(new SdkError("timeout", `timeout: ${method}`));
      }, limit);
      pending.set(id, { resolve, reject, timer });
      target.postMessage({ v: PROTOCOL_VERSION, id, method, params }, "*");
    });
  }
  return {
    ready: () => call("ready"),
    theme: {
      get: () => call("theme.get"),
      onChange(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      }
    },
    onVisibilityChange(callback) {
      visibilityListeners.add(callback);
      return () => {
        visibilityListeners.delete(callback);
      };
    },
    toast: (message, kind = "info") => call("toast", { message, kind }),
    clipboard: {
      readText: () => call("clipboard.readText"),
      writeText: (text) => call("clipboard.writeText", { text })
    },
    files: {
      open: (options2 = {}) => call("files.open", { accept: options2.accept, as: options2.as ?? "text" }, null),
      save: (name, data) => call("files.save", { name, data }, null)
    },
    net: {
      async fetch(url, init) {
        const raw = await call("net.fetch", { url, init }, Math.max(timeoutMs, 4e4));
        return {
          ...raw,
          ok: raw.status >= 200 && raw.status < 300,
          text: () => new TextDecoder().decode(raw.body),
          json: () => JSON.parse(new TextDecoder().decode(raw.body))
        };
      }
    },
    storage: {
      async get(key) {
        return await call("storage.get", { key }) ?? null;
      },
      set(key, value) {
        if (value === void 0 || value === null) return Promise.reject(new TypeError("storage.set needs a value other than null. Use storage.remove to delete a key."));
        return call("storage.set", { key, value });
      },
      remove: (key) => call("storage.remove", { key })
    }
  };
}
export {
  PROTOCOL_VERSION,
  PermissionError,
  SdkError,
  connect,
  loadWasm,
  spawnWorker
};
