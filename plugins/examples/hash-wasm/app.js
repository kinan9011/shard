// Hashes with hash.wasm, a Rust module without wasm-bindgen (see src/lib.rs, built by `task plugin:example-wasm`).
// It runs in a worker when the webview lets the frame start one, and on the main thread otherwise.
import { connect, loadWasm, PermissionError, spawnWorker } from "./shard-sdk.js";

const $ = (id) => document.getElementById(id);
const status = $("status");
const encoder = new TextEncoder();

function applyTheme(theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

// The module, called directly.
function hashOnMainThread(wasm, bytes) {
  const { memory, alloc, dealloc, sha256 } = wasm.instance.exports;
  const input = alloc(bytes.length);
  const output = alloc(32);
  new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
  sha256(input, bytes.length, output);
  const digest = new Uint8Array(memory.buffer, output, 32).slice();
  dealloc(input, bytes.length);
  dealloc(output, 32);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Why there is no worker, for the self-test log.
let workerProblem = "";

// The module in a worker, or null when the frame cannot start one.
async function startWorker(module) {
  try {
    const worker = await spawnWorker("worker.js");
    const calls = new Map();
    let nextId = 0;
    await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.ready ? resolve() : reject(new Error(data.error)));
      worker.onerror = (event) => reject(new Error(event.message || "worker failed"));
      worker.postMessage({ module });
    });
    worker.onmessage = ({ data }) => {
      const call = calls.get(data.id);
      calls.delete(data.id);
      if (data.error) call?.reject(new Error(data.error));
      else call?.resolve(data.hex);
    };
    // A worker that dies (out of memory, a trap in the module) answers nothing more: fail what is waiting.
    worker.onerror = (event) => {
      for (const call of calls.values()) call.reject(new Error(event.message || "The worker stopped"));
      calls.clear();
    };
    return (bytes) =>
      new Promise((resolve, reject) => {
        const id = (nextId += 1);
        calls.set(id, { resolve, reject });
        // Hand the buffer over instead of copying it (it can be tens of MB).
        worker.postMessage({ id, bytes }, [bytes.buffer]);
      });
  } catch (error) {
    workerProblem = String(error?.message ?? error);
    console.warn("No worker:", error);
    return null;
  }
}

const sdk = connect();
try {
  applyTheme((await sdk.ready()).theme);
  sdk.theme.onChange(applyTheme);
} catch (error) {
  // Outside the app (opened as a plain page) there is no host to answer.
  status.textContent = `Not connected to Shard: ${error.message}`;
}

let hash;
let backend;
try {
  const wasm = await loadWasm("hash.wasm");
  const inWorker = await startWorker(wasm.module);
  hash = inWorker ?? (async (bytes) => hashOnMainThread(wasm, bytes));
  backend = inWorker ? "worker" : "main thread";
  $("source").textContent = `(WASM, ${backend})`;
  // Both paths on a known input. The app's self-test reads this from the plugin's storage, and `at` tells it the value is from this run.
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const selfCheck = { main: hashOnMainThread(wasm, encoder.encode("abc")) === abc, worker: false, workerProblem, at: Date.now() };
  if (inWorker) {
    try {
      selfCheck.worker = (await inWorker(encoder.encode("abc"))) === abc;
    } catch (error) {
      selfCheck.workerProblem = String(error?.message ?? error);
    }
  }
  await sdk.storage.set("selfCheck", selfCheck).catch(() => {});
} catch (error) {
  status.textContent = `Could not start the WASM module: ${error.message}`;
}

async function show(bytes) {
  $("digest").textContent = await hash(bytes);
}

$("text").addEventListener("input", () => hash && show(encoder.encode($("text").value)));
$("open-file").addEventListener("click", async () => {
  if (!hash) return;
  try {
    const file = await sdk.files.open({ as: "bytes" });
    if (!file) return;
    await show(file.bytes);
    status.textContent = `${file.name}: ${file.size.toLocaleString()} bytes`;
  } catch (error) {
    status.textContent = error instanceof PermissionError ? "Opening files is not allowed for this plugin. Grant “Files” in its permissions." : error.message;
  }
});
if (hash) await show(new Uint8Array());
