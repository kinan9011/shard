// A classic worker. The page starts it with spawnWorker() and first sends { module }, a compiled
// WebAssembly.Module (a Blob worker has a blob: location, so it cannot resolve "hash.wasm" itself).
let wasm;

function sha256(bytes) {
  const { memory, alloc, dealloc, sha256: run } = wasm.exports;
  const input = alloc(bytes.length);
  const output = alloc(32);
  // Read memory.buffer after alloc: growing memory replaces the buffer.
  new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
  run(input, bytes.length, output);
  const digest = new Uint8Array(memory.buffer, output, 32).slice();
  dealloc(input, bytes.length);
  dealloc(output, 32);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async ({ data }) => {
  try {
    if (data.module) {
      wasm = await WebAssembly.instantiate(data.module, {});
      self.postMessage({ ready: true });
    } else {
      self.postMessage({ id: data.id, hex: sha256(data.bytes) });
    }
  } catch (error) {
    self.postMessage({ id: data.id, ready: false, error: String(error) });
  }
};
