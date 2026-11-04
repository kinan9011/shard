import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";
import {
  clearRememberedInputs,
  MAX_REMEMBERED_INPUT,
  OPEN_TABS_STORAGE_KEY,
  REMEMBER_INPUTS_KEY,
  usePersistedInput,
} from "@/hooks/usePersistedInput";

const setupMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("usePersistedInput", () => {
  it("comes back after a remount", () => {
    const first = renderHook(() => usePersistedInput("t1"));
    act(() => first.result.current[1]("hello"));
    first.unmount();
    expect(renderHook(() => usePersistedInput("t1")).result.current[0]).toBe("hello");
  });

  it("forgets an input that was cleared", () => {
    const first = renderHook(() => usePersistedInput("t2"));
    act(() => first.result.current[1]("x"));
    expect(localStorage.getItem("shard-input:t2")).toBe("x");
    act(() => first.result.current[1](""));
    expect(localStorage.getItem("shard-input:t2")).toBeNull();
  });

  it("stores nothing when remembering is off", () => {
    localStorage.setItem(REMEMBER_INPUTS_KEY, "false");
    const first = renderHook(() => usePersistedInput("t3"));
    act(() => first.result.current[1]("secret"));
    expect(localStorage.getItem("shard-input:t3")).toBeNull();
  });

  it("does not read a stored input back when remembering is off", () => {
    localStorage.setItem("shard-input:t4", "old");
    localStorage.setItem(REMEMBER_INPUTS_KEY, "false");
    expect(renderHook(() => usePersistedInput("t4")).result.current[0]).toBe("");
  });

  it("does not store an input over the size cap", () => {
    const first = renderHook(() => usePersistedInput("t5"));
    act(() => first.result.current[1]("a".repeat(MAX_REMEMBERED_INPUT + 1)));
    expect(localStorage.getItem("shard-input:t5")).toBeNull();
  });

  it("clearRememberedInputs erases inputs and saved tabs but keeps other settings", () => {
    localStorage.setItem("shard-input:a", "1");
    localStorage.setItem("shard-input:b", "2");
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, "{}");
    localStorage.setItem("shard-layout", "launcher");
    clearRememberedInputs();
    expect(localStorage.getItem("shard-input:a")).toBeNull();
    expect(localStorage.getItem("shard-input:b")).toBeNull();
    expect(localStorage.getItem(OPEN_TABS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("shard-layout")).toBe("launcher");
  });
});

describe("open tabs", () => {
  it("reopens last session's tabs and skips ids that no longer exist", async () => {
    setupMatchMedia();
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify({ open: ["json-viewer", "no-such-tool"], active: "json-viewer" }));
    render(<Shard />);
    await waitFor(() => expect(screen.getByText("JSON Input")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Close JSON Viewer" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(OPEN_TABS_STORAGE_KEY) ?? "{}")).toEqual({ open: ["json-viewer"], active: "json-viewer" });
  });

  it("restores nothing from a damaged value", async () => {
    setupMatchMedia();
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, "{not json");
    render(<Shard />);
    // The saved value is replaced once the restore step has run.
    await waitFor(() => expect(localStorage.getItem(OPEN_TABS_STORAGE_KEY)).toBeNull());
    // Not a role query: "Close sidebar" is also a button named "Close …".
    expect(document.querySelectorAll(".tab-close")).toHaveLength(0);
  });

  it("restores nothing when remembering is off, and forgets the saved tabs", async () => {
    setupMatchMedia();
    localStorage.setItem(REMEMBER_INPUTS_KEY, "false");
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify({ open: ["json-viewer"], active: "json-viewer" }));
    render(<Shard />);
    await waitFor(() => expect(localStorage.getItem(OPEN_TABS_STORAGE_KEY)).toBeNull());
    expect(screen.queryByRole("button", { name: "Close JSON Viewer" })).not.toBeInTheDocument();
    expect(screen.queryByText("JSON Input")).not.toBeInTheDocument();
  });
});
