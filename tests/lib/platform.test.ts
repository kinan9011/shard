import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isMobileApp, isMobilePlatform } from "@/lib/platform";
import { setViewport } from "../helpers/viewport";

afterEach(() => setViewport(1200));

describe("platform", () => {
  it("knows the phone platforms", () => {
    expect(isMobilePlatform("android")).toBe(true);
    expect(isMobilePlatform("ios")).toBe(true);
    for (const other of ["darwin", "win32", "linux", undefined]) expect(isMobilePlatform(other)).toBe(false);
  });

  it("is not the phone app in a browser or on a desktop", () => {
    expect(isMobileApp()).toBe(false);
  });
});

describe("useIsMobile", () => {
  it("follows the width", () => {
    setViewport(390);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    setViewport(1200);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("is true for a phone platform in any width, and false for a desktop platform", () => {
    setViewport(1200);
    expect(renderHook(() => useIsMobile("android")).result.current).toBe(true);
    expect(renderHook(() => useIsMobile("darwin")).result.current).toBe(false);
  });

  it("changes when the window crosses 640 px", () => {
    let listener: () => void = () => {};
    let matches = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ get matches() { return matches; }, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: vi.fn() })),
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    matches = true;
    act(() => listener());
    expect(result.current).toBe(true);
  });

  it("does not break without matchMedia", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: undefined });
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });
});
