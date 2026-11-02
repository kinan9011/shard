import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";
import { COLOR_SCHEMES, SCHEME_STORAGE_KEY, THEME_STORAGE_KEY, getStoredColorScheme, resolveColorScheme, themeCss, userThemeSchemes } from "@/utils/theme";

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
    // Only the color-scheme query follows `matches`; the phone-width query is off.
    value: vi.fn().mockImplementation((query: string) => (query.includes("prefers-color-scheme") ? mediaQueryList : { matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
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

    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("persists a manual theme override across launches", async () => {
    setupMatchMedia(false);

    const { unmount } = render(<Shard />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));

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

  it("the header button flips between light and dark only, and never opens Settings", async () => {
    setupMatchMedia(false);
    render(<Shard />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });

  it("picks a color scheme, keeps it across launches and only offers schemes that have the current mode", async () => {
    setupMatchMedia(false);
    const { unmount } = render(<Shard />);
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-scheme", "adwaita"));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
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
  it("reads a well formed scheme id and falls back to Adwaita for anything else", () => {
    expect(getStoredColorScheme(storage("kate"))).toBe("kate");
    expect(getStoredColorScheme(storage("my-theme"))).toBe("my-theme");
    expect(getStoredColorScheme(storage("No Way!"))).toBe("adwaita");
    expect(getStoredColorScheme(storage(null))).toBe("adwaita");
    expect(getStoredColorScheme(null)).toBe("adwaita");
    expect(getStoredColorScheme({ getItem: () => { throw new Error("blocked"); } })).toBe("adwaita");
  });
  it("every scheme has colors for at least one mode", () => {
    for (const scheme of COLOR_SCHEMES) expect(scheme.modes.length).toBeGreaterThan(0);
  });
});

describe("user themes", () => {
  const nord = { id: "nord", name: "Nord", version: "1", author: "", dark: { "--background": "220 16% 22%", "--surface-editor": "#2e3440" } };
  it("writes one block per mode the theme has", () => {
    expect(themeCss([nord])).toBe('[data-scheme="nord"].dark{--background:220 16% 22%;--surface-editor:#2e3440}');
  });
  it("drops what is not a token or a color, so nothing can leave the block", () => {
    const css = themeCss([
      { ...nord, light: { "--background": "0 0% 0%; } body { display:none", "--x": "url(a.png)", "background": "#fff", "--ok": "#fff" } },
      { ...nord, id: 'x"] { } [a="' },
    ]);
    expect(css).not.toMatch(/body|url|display/);
    expect(css).toContain('[data-scheme="nord"]:not(.dark){--ok:#fff}');
    expect(css).not.toContain('x"]');
  });
  it("lists a theme for the modes it has and marks it as the user's", () => {
    expect(userThemeSchemes([nord])).toEqual([{ id: "nord", name: "Nord", modes: ["dark"], user: true }]);
  });
  it("keeps a stored user theme while loading and falls back when it is gone", () => {
    const schemes = [...COLOR_SCHEMES, ...userThemeSchemes([nord])];
    expect(resolveColorScheme("nord", COLOR_SCHEMES, false)).toBe("nord");
    expect(resolveColorScheme("nord", schemes, true)).toBe("nord");
    expect(resolveColorScheme("nord", COLOR_SCHEMES, true)).toBe("adwaita");
  });
});
