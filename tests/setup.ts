/**
 * Vitest setup file for Shard Desktop
 * This file runs before each test file
 */

import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { resetLanguageForTests } from '../src/i18n';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Lazy-loaded tools can take well over the 1s default under full-suite load
configure({ asyncUtilTimeout: 5000 });

// Cleanup after each test
afterEach(() => {
  cleanup();
  // A test that switched the language must not leave the next one in it.
  resetLanguageForTests();
  // Remembered tool inputs and open tabs must not leak from one test into the next.
  try {
    localStorage.clear();
  } catch {
    // No storage in this environment.
  }
});

// Mock navigator.clipboard
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  },
  writable: true,
});

Object.defineProperty(global.URL, 'createObjectURL', {
  value: vi.fn(() => 'blob:mock-url'),
  writable: true,
});

Object.defineProperty(global.URL, 'revokeObjectURL', {
  value: vi.fn(),
  writable: true,
});

// Node 26+ defines an inert global localStorage that shadows the jsdom one,
// so fall back to an in-memory Storage when the environment has none.
if (!globalThis.localStorage) {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(String(key)) ?? null;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
}

// CodeMirror measures text through Range geometry and observes size changes; jsdom has neither.
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
