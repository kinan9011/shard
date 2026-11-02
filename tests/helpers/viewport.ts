import { vi } from "vitest";

/**
 * Makes `window.matchMedia` answer `(max-width: Npx)` and `(min-width: Npx)` for a viewport of `width`, and nothing else
 * (dark mode off). Returns the function that restores a desktop width.
 */
export function setViewport(width: number): () => void {
  const answer = (query: string): boolean => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (max) return width <= Number(max[1]);
    if (min) return width >= Number(min[1]);
    return false;
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: answer(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
  return () => setViewport(1200);
}
