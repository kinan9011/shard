import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ listPlugins: vi.fn() }));
vi.mock("@/plugins/api", () => ({ listPlugins: api.listPlugins }));

import { refreshPlugins, resetPlugins, usePlugins } from "@/plugins/usePlugins";

const plugin = (id: string) => ({ id }) as never;

beforeEach(() => {
  resetPlugins();
  api.listPlugins.mockReset();
});
afterEach(() => resetPlugins());

describe("usePlugins", () => {
  it("loads once on mount and shares the list", async () => {
    api.listPlugins.mockResolvedValue([plugin("a-tool")]);
    const first = renderHook(() => usePlugins());
    const second = renderHook(() => usePlugins());
    await waitFor(() => expect(first.result.current.plugins).toHaveLength(1));
    expect(second.result.current.plugins).toHaveLength(1);
    expect(api.listPlugins).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list on failure and tries again on the next mount", async () => {
    api.listPlugins.mockResolvedValueOnce([plugin("a-tool")]);
    const first = renderHook(() => usePlugins());
    await waitFor(() => expect(first.result.current.plugins).toHaveLength(1));
    api.listPlugins.mockRejectedValueOnce(new Error("boom"));
    await first.result.current.refresh();
    await waitFor(() => expect(first.result.current.error).toBe("boom"));
    expect(first.result.current.plugins).toHaveLength(1);
    api.listPlugins.mockResolvedValueOnce([plugin("a-tool"), plugin("b-tool")]);
    renderHook(() => usePlugins());
    await waitFor(() => expect(first.result.current.plugins).toHaveLength(2));
  });

  it("lets the newest read win when an older one answers last", async () => {
    let finishOld!: (value: unknown[]) => void;
    api.listPlugins.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    const old = refreshPlugins();
    api.listPlugins.mockResolvedValueOnce([plugin("new-tool")]);
    await refreshPlugins();
    finishOld([]);
    await old;
    const { result } = renderHook(() => usePlugins());
    expect(result.current.plugins.map((p) => p.id)).toEqual(["new-tool"]);
  });
});
