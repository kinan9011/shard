import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWasm, SdkError, spawnWorker } from "../../packages/plugin-sdk/src/index";

// The smallest valid module: magic and version, nothing else.
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const original = { instantiateStreaming: WebAssembly.instantiateStreaming, Worker: globalThis.Worker, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  WebAssembly.instantiateStreaming = original.instantiateStreaming;
  globalThis.Worker = original.Worker;
  URL.createObjectURL = original.createObjectURL;
  URL.revokeObjectURL = original.revokeObjectURL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bytesResponse(status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 404 ? "Not Found" : "OK", arrayBuffer: async () => EMPTY_MODULE.buffer.slice(0) };
}

describe("loadWasm", () => {
  it("streams the module and resolves the path against the page", async () => {
    const result = { module: {}, instance: {} } as WebAssembly.WebAssemblyInstantiatedSource;
    const streaming = vi.fn().mockResolvedValue(result);
    WebAssembly.instantiateStreaming = streaming;
    fetchMock.mockReturnValue("response");
    const imports = { env: {} };
    expect(await loadWasm("hash.wasm", imports)).toBe(result);
    expect(fetchMock).toHaveBeenCalledWith(new URL("hash.wasm", location.href).href);
    expect(streaming).toHaveBeenCalledWith("response", imports);
  });

  it("reads the bytes when streaming fails or does not exist", async () => {
    WebAssembly.instantiateStreaming = vi.fn().mockRejectedValue(new TypeError("Incorrect response MIME type"));
    fetchMock.mockResolvedValue(bytesResponse());
    expect((await loadWasm("m.wasm")).instance).toBeInstanceOf(WebAssembly.Instance);
    WebAssembly.instantiateStreaming = undefined as never;
    expect((await loadWasm("m.wasm")).instance).toBeInstanceOf(WebAssembly.Instance);
  });

  it("does not retry a bad module", async () => {
    WebAssembly.instantiateStreaming = vi.fn().mockRejectedValue(new WebAssembly.LinkError("import missing"));
    await expect(loadWasm("m.wasm")).rejects.toThrow("import missing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with the status for a missing file", async () => {
    WebAssembly.instantiateStreaming = vi.fn().mockRejectedValue(new TypeError("bad"));
    fetchMock.mockResolvedValue(bytesResponse(404));
    const error = await loadWasm("missing.wasm").catch((e) => e);
    expect(error).toBeInstanceOf(SdkError);
    expect(error.message).toBe("Could not load missing.wasm: 404 Not Found");
  });
});

describe("spawnWorker", () => {
  class FakeWorker {
    static last: FakeWorker;
    constructor(public url: string, public options?: WorkerOptions) {
      FakeWorker.last = this;
    }
  }
  beforeEach(() => {
    globalThis.Worker = FakeWorker as never;
  });

  it("starts the worker from a Blob URL, passing the options on", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", arrayBuffer: async () => new TextEncoder().encode("postMessage(1)").buffer });
    const createObjectURL = vi.fn().mockReturnValue("blob:null/abc");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await spawnWorker("w.js", { type: "module" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:null/abc");
    expect(fetchMock).toHaveBeenCalledWith(new URL("w.js", location.href).href);
    expect(FakeWorker.last.url).toBe("blob:null/abc");
    expect(FakeWorker.last.options).toEqual({ type: "module" });
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/javascript");
    const reader = new FileReader();
    const read = new Promise<string>((resolve) => (reader.onload = () => resolve(String(reader.result))));
    reader.readAsText(blob);
    expect(await read).toBe("postMessage(1)");
  });

  it("rejects when the script cannot be read", async () => {
    fetchMock.mockResolvedValue(bytesResponse(404));
    await expect(spawnWorker("gone.js")).rejects.toThrow("Could not load gone.js: 404 Not Found");
  });
});
