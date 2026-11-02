import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";
import { COLOR_SCHEMES, SCHEME_STORAGE_KEY, THEME_STORAGE_KEY, getStoredColorScheme } from "@/utils/theme";

type MatchMediaController = {
  setMatches: (matches: boolean) => void;
};

const setupMatchMedia = (initialMatches: boolean): MatchMediaController => {
  let matches = initialMatches;
  let changeHandler: ((event: MediaQueryListEvent) => void) | undefined;

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === "change" && typeof listener === "function") {
        changeHandler = listener as (event: MediaQueryListEvent) => void;
      }
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      changeHandler = listener;
    }),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => mediaQueryList),
  });

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      changeHandler?.({ matches: nextMatches } as MediaQueryListEvent);
    },
  };
};

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-scheme");
  localStorage.clear();
});

describe("Shard theme", () => {
  it("uses the system dark theme on initial load", async () => {
    setupMatchMedia(true);

    render(<Shard />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });

    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("updates when the system theme changes", async () => {
    const matchMedia = setupMatchMedia(false);

    render(<Shard />);

    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass("dark");
    });

    act(() => {
      matchMedia.setMatches(true);
    });

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });

    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("persists a manual theme override across launches", async () => {
    setupMatchMedia(false);

    const { unmount } = render(<Shard />);

    await waitFor(() => {
      expect(screen.getByText("Light")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Theme" })).getByRole("button", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    unmount();
    document.documentElement.classList.remove("dark");

    render(<Shard />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });
  });

  it("picks a color scheme, keeps it across launches and only offers schemes that have the current mode", async () => {
    setupMatchMedia(false);
    const { unmount } = render(<Shard />);
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-scheme", "adwaita"));

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const menu = within(screen.getByRole("main"));
    const schemes = within(menu.getByRole("group", { name: "Color scheme" }));
    // Light mode: the dark-only schemes are not listed.
    expect(schemes.getByRole("button", { name: /Solarized/ })).toBeInTheDocument();
    expect(schemes.queryByRole("button", { name: /Cobalt/ })).toBeNull();
    fireEvent.click(schemes.getByRole("button", { name: /Solarized/ }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-scheme", "solarized"));
    expect(localStorage.getItem(SCHEME_STORAGE_KEY)).toBe("solarized");
    expect(schemes.getByRole("button", { name: /Solarized/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(menu.getByRole("group", { name: "Theme" })).getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(schemes.getByRole("button", { name: /Cobalt/ })).toBeInTheDocument();
    expect(schemes.queryByRole("button", { name: /Tango/ })).toBeNull();

    unmount();
    render(<Shard />);
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-scheme", "solarized"));
  });
});

describe("color scheme storage", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it("reads a known scheme and falls back to default for anything else", () => {
    expect(getStoredColorScheme(storage("kate"))).toBe("kate");
    expect(getStoredColorScheme(storage("nope"))).toBe("adwaita");
    expect(getStoredColorScheme(storage(null))).toBe("adwaita");
    expect(getStoredColorScheme(null)).toBe("adwaita");
    expect(getStoredColorScheme({ getItem: () => { throw new Error("blocked"); } })).toBe("adwaita");
  });
  it("every scheme has colors for at least one mode", () => {
    for (const scheme of COLOR_SCHEMES) expect(scheme.modes.length).toBeGreaterThan(0);
  });
});
