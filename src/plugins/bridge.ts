import { toast } from "sonner";
import { readClipboardText, saveFile, writeClipboardText } from "@/lib/desktop";
import { getPluginStorage, pluginFetch, pluginOpenFile, setPluginStorage } from "./api";
import { isGranted } from "./permissions";
import type { PermissionName } from "./types";

// Host side of the plugin SDK (packages/plugin-sdk/src/index.ts). A plugin frame has no other way to
// reach the app: every request is checked here. The plugin id comes from the host, never from a message.

const PROTOCOL_VERSION = 1;
/** A host call that takes longer than this is answered with a timeout. The SDK has its own, longer, timeout. */
export const CALL_TIMEOUT_MS = 10_000;
const MAX_TOAST_LENGTH = 500;
const MAX_ERROR_LENGTH = 500;
const MAX_KEY_LENGTH = 256;
const MAX_CLIPBOARD_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
/**
 * Calls that wait on something other than the host get their own limit. `null` is no limit: a file dialog
 * stays open as long as the user likes. net.fetch outlasts the 30 s that the Rust side allows.
 */
const CALL_TIMEOUTS: Record<string, number | null> = { "net.fetch": 35_000, "files.open": null, "files.save": null };
const TOAST_KINDS = ["info", "success", "warning", "error"] as const;

/** The CSS custom properties a plugin may read (see src/index.css). */
const THEME_VARS = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--primary-solid", "--primary-solid-foreground", "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
  "--accent", "--accent-foreground", "--destructive", "--destructive-foreground", "--success", "--success-foreground",
  "--warning", "--warning-foreground", "--info", "--info-foreground", "--border", "--input", "--ring",
  "--sidebar-background", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
  "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring",
  "--surface-chrome", "--surface-editor", "--surface-raised", "--surface-sidebar",
  "--surface-hover", "--surface-selected", "--shadow-dialog",
  "--chrome-input-border", "--chrome-muted-foreground",
  "--syntax-fn", "--syntax-kw", "--syntax-lit", "--syntax-num", "--syntax-str",
  "--radius", "--font-ui", "--font-code",
];

export interface ThemeSnapshot {
  isDark: boolean;
  scheme: string;
  vars: Record<string, string>;
}

/** The app theme as the plugin needs it: the computed tokens from `:root`, the dark state and the color scheme. */
export function themeSnapshot(): ThemeSnapshot {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return { isDark: root.classList.contains("dark"), scheme: root.getAttribute("data-scheme") ?? "adwaita", vars };
}

class BridgeError extends Error {
  constructor(
    public code: "bad_request" | "unknown_method" | "timeout" | "failed" | "permission_denied",
    message: string,
    /** For `permission_denied`: the permission the call needed. */
    public permission?: PermissionName,
  ) {
    super(message);
  }
}

interface Connection {
  pluginId: string;
  /** The plugin's current grants. Read on every call, so a change applies at once. */
  granted: () => readonly string[];
  /** Calls in progress, by method (see `limited`). */
  active: Map<string, number>;
  ready: boolean;
  /** Whether the plugin's tab is the one on screen. */
  visible: () => boolean;
  /** The handshake finished. */
  onReady?: () => void;
  send: (message: unknown) => void;
}

type Method = (params: Record<string, unknown>, connection: Connection) => unknown;

const badRequest = (message: string) => new BridgeError("bad_request", message);

function keyOf(params: Record<string, unknown>): string {
  const key = params.key;
  // Bytes, like the Rust side counts them.
  if (typeof key !== "string" || key.length === 0 || new TextEncoder().encode(key).length > MAX_KEY_LENGTH) {
    throw badRequest(`key must be a string of 1 to ${MAX_KEY_LENGTH} bytes`);
  }
  return key;
}

/** Runs `method` only when the plugin holds `permission`. This is the one place the grants are checked. */
const gated =
  (permission: PermissionName, method: Method): Method =>
  (params, connection) => {
    if (!isGranted(connection.granted(), permission)) {
      throw new BridgeError("permission_denied", `This plugin has not been granted ${permission}`, permission);
    }
    return method(params, connection);
  };

/** At most `max` calls of this method at once per plugin. A dialog or a big download holds real resources. */
const limited =
  (name: string, max: number, method: Method): Method =>
  async (params, connection) => {
    const running = connection.active.get(name) ?? 0;
    if (running >= max) throw new BridgeError("failed", `Too many ${name} calls at once`);
    connection.active.set(name, running + 1);
    try {
      return await method(params, connection);
    } finally {
      connection.active.set(name, (connection.active.get(name) ?? 1) - 1);
    }
  };

/** A Uint8Array view of the bytes in `value`, or null. Checks by tag: a message from the frame is cloned into this realm, but a test's is not. */
function bytesOf(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
  return null;
}

function stringRecord(value: unknown, what: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((v) => typeof v !== "string")) {
    throw badRequest(`${what} must be an object of strings`);
  }
  return value as Record<string, string>;
}

const METHODS: Record<string, Method> = {
  ready(_params, connection) {
    connection.ready = true;
    connection.onReady?.();
    return { pluginId: connection.pluginId, theme: themeSnapshot(), visible: connection.visible() };
  },
  "theme.get": () => themeSnapshot(),
  "storage.get": (params, connection) => getPluginStorage(connection.pluginId, keyOf(params)),
  "storage.set"(params, connection) {
    const key = keyOf(params);
    if (params.value === undefined || params.value === null) throw badRequest("value is required. Use storage.remove to delete a key");
    return setPluginStorage(connection.pluginId, key, params.value);
  },
  "storage.remove": (params, connection) => setPluginStorage(connection.pluginId, keyOf(params), null),

  "clipboard.readText": gated("clipboard:read", () => readClipboardText()),
  "clipboard.writeText": gated("clipboard:write", async (params) => {
    const { text } = params;
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_CLIPBOARD_BYTES) throw badRequest("text must be a string of at most 1 MB");
    await writeClipboardText(text);
  }),

  "files.open": gated("files:open", limited("files.open", 1, async (params, connection) => {
    const { accept, as = "text" } = params;
    if (accept !== undefined && (!Array.isArray(accept) || accept.length > 32 || accept.some((a) => typeof a !== "string"))) {
      throw badRequest("accept must be a list of up to 32 file extensions");
    }
    if (as !== "text" && as !== "bytes") throw badRequest('as must be "text" or "bytes"');
    const file = await pluginOpenFile(connection.pluginId, (accept as string[] | undefined) ?? []);
    if (!file) return null;
    return as === "bytes" ? { name: file.name, size: file.size, bytes: file.bytes } : { name: file.name, size: file.size, text: new TextDecoder().decode(file.bytes) };
  })),
  "files.save": gated("files:save", limited("files.save", 1, async (params) => {
    const { name, data } = params;
    if (typeof name !== "string" || name.length === 0 || name.length > 255 || name === "." || name === ".." || /[\\/\0]/.test(name)) throw badRequest("name must be a file name of 1 to 255 characters, without / or \\");
    // A string is at least as many bytes as it has characters, so refuse a huge one before encoding it.
    if (typeof data === "string" && data.length > MAX_FILE_BYTES) throw badRequest("data is larger than 50 MB");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : bytesOf(data);
    if (!bytes) throw badRequest("data must be a string, a Uint8Array or an ArrayBuffer");
    if (bytes.byteLength > MAX_FILE_BYTES) throw badRequest("data is larger than 50 MB");
    return saveFile(new Blob([bytes as BlobPart]), name);
  })),

  "net.fetch": gated("network", limited("net.fetch", 6, async (params, connection) => {
    const { url, init } = params;
    if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) throw badRequest(`url must be a string of 1 to ${MAX_URL_LENGTH} characters`);
    if (init !== undefined && (!init || typeof init !== "object" || Array.isArray(init))) throw badRequest("init must be an object");
    const { method, headers, body } = (init ?? {}) as Record<string, unknown>;
    if (method !== undefined && typeof method !== "string") throw badRequest("method must be a string");
    if (body !== undefined && typeof body !== "string") throw badRequest("body must be a string");
    // The host list is enforced in Rust (plugin_fetch), which also repeats the grant check.
    return pluginFetch(connection.pluginId, url, { method: method as string | undefined, headers: stringRecord(headers, "headers"), body: body as string | undefined });
  })),
};

const connections = new Set<Connection>();

/**
 * Answers the SDK calls from `frame`. Only messages whose `source` is the frame's own window count.
 * Returns a function that stops listening.
 */
export function attachBridge(
  frame: HTMLIFrameElement,
  plugin: {
    id: string;
    name: string;
    granted: () => readonly string[];
    /** Whether the plugin's tab is on screen. Default: always. */
    visible?: () => boolean;
    /** The plugin finished the `ready` handshake. */
    onReady?: () => void;
    /** The plugin reported an uncaught error (the SDK sends it). */
    onCrash?: (message: string) => void;
  },
  host: Window = window,
): () => void {
  const connection: Connection = {
    pluginId: plugin.id,
    granted: plugin.granted,
    active: new Map(),
    ready: false,
    visible: plugin.visible ?? (() => true),
    onReady: plugin.onReady,
    // "*" because the frame's origin is opaque. The target is the frame's own window, so nobody else receives it.
    send: (message) => frame.contentWindow?.postMessage(message, "*"),
  };

  // Methods that need the plugin's name (the toast) are bound here.
  const methods: Record<string, Method> = {
    ...METHODS,
    toast(params) {
      const { message, kind } = params;
      if (typeof message !== "string" || message.length === 0 || message.length > MAX_TOAST_LENGTH) {
        throw badRequest(`message must be a string of 1 to ${MAX_TOAST_LENGTH} characters`);
      }
      if (!TOAST_KINDS.includes(kind as (typeof TOAST_KINDS)[number])) throw badRequest(`kind must be one of ${TOAST_KINDS.join(", ")}`);
      // The plugin's name is shown with its text, so a plugin cannot pass a message off as the app's.
      toast[kind as (typeof TOAST_KINDS)[number]](message, { description: plugin.name });
    },
  };

  const reply = (id: string, outcome: { result: unknown } | { error: { code: string; message: string; permission?: string } }) =>
    connection.send({ v: PROTOCOL_VERSION, id, ...outcome });

  const onMessage = (event: MessageEvent) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.v !== PROTOCOL_VERSION) return;
    if (data.event === "error") {
      // Fire and forget: there is no id, so nothing is answered.
      plugin.onCrash?.(typeof data.message === "string" ? data.message.slice(0, MAX_ERROR_LENGTH) : "Unknown error");
      return;
    }
    if (typeof data.id !== "string" || typeof data.method !== "string") return;
    const { id, method } = data as { id: string; method: string };
    const params = data.params && typeof data.params === "object" && !Array.isArray(data.params) ? (data.params as Record<string, unknown>) : {};

    let answered = false;
    const answer = (outcome: Parameters<typeof reply>[1]) => {
      if (answered) return;
      answered = true;
      if (timer !== undefined) clearTimeout(timer);
      reply(id, outcome);
    };
    const fail = (error: unknown) => {
      // The Rust commands check the grant too. Their refusal is the same error, whichever side noticed.
      const denied = typeof error === "string" ? /^permission_denied: (clipboard:read|clipboard:write|files:open|files:save|network)$/.exec(error) : null;
      if (denied) error = new BridgeError("permission_denied", `This plugin has not been granted ${denied[1]}`, denied[1] as PermissionName);
      if (error instanceof BridgeError) answer({ error: { code: error.code, message: error.message, ...(error.permission && { permission: error.permission }) } });
      else answer({ error: { code: "failed", message: error instanceof Error ? error.message : String(error) } });
    };
    const limit = Object.prototype.hasOwnProperty.call(CALL_TIMEOUTS, method) ? CALL_TIMEOUTS[method] : CALL_TIMEOUT_MS;
    const timer = limit === null ? undefined : setTimeout(() => fail(new BridgeError("timeout", `Timed out: ${method}`)), limit);

    const handler = Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : undefined;
    if (!handler) {
      fail(new BridgeError("unknown_method", `Unknown method: ${method}`));
      return;
    }
    try {
      Promise.resolve(handler(params, connection)).then((result) => answer({ result: result ?? null }), fail);
    } catch (error) {
      fail(error);
    }
  };

  host.addEventListener("message", onMessage);
  connections.add(connection);
  return () => {
    host.removeEventListener("message", onMessage);
    connections.delete(connection);
  };
}

/** Tells every plugin that finished the handshake about the new app theme. Call it after the theme or color scheme changed. */
export function notifyThemeChanged(): void {
  if (connections.size === 0) return;
  const message = { v: PROTOCOL_VERSION, event: "theme", data: themeSnapshot() };
  for (const connection of connections) {
    if (connection.ready) connection.send(message);
  }
}

/** Tells the plugin with this id (once its handshake is done) that its tab was shown or hidden. */
export function notifyVisibilityChanged(pluginId: string, visible: boolean): void {
  const message = { v: PROTOCOL_VERSION, event: "visibility", data: { visible } };
  for (const connection of connections) {
    if (connection.ready && connection.pluginId === pluginId) connection.send(message);
  }
}
