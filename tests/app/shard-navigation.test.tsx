import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

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

describe("Shard navigation", () => {
  it("shows only quick access on a fresh home screen", () => {
    setupMatchMedia();

    render(<Shard />);

    const main = screen.getByRole("main");

    expect(within(main).getByText("Quick Access")).toBeInTheDocument();
    expect(within(main).queryByText("Recently Used")).not.toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Pin tools to Home" })).toBeInTheDocument();
  });

  it("opens a tool from quick access after lazy loading", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.click(screen.getAllByRole("button", { name: /json viewer/i })[0]);

    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });
  });

  it("shows recently used tools on the home page in most-recent-first order", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.click(screen.getAllByRole("button", { name: /json viewer/i })[0]);

    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^home$/i }));
    const sidebarNav = screen.getAllByRole("navigation")[0];
    fireEvent.click(within(sidebarNav).getByRole("button", { name: /generators/i }));
    fireEvent.click(within(sidebarNav).getByRole("button", { name: /^bcrypt generator$/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Bcrypt Generator" })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: /^home$/i }));

    const main = screen.getByRole("main");

    expect(within(main).getByText("Recently Used")).toBeInTheDocument();
    expect(within(main).getByText("Quick Access")).toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Pin tools to Home" })).toBeInTheDocument();

    const recentSection = within(main).getByText("Recently Used").parentElement;

    if (!recentSection) {
      throw new Error("Recently Used section not found");
    }

    const recentButtons = within(recentSection).getAllByRole("button", {
      name: /json viewer|bcrypt generator/i,
    });
    expect(recentButtons[0]).toHaveTextContent("Bcrypt Generator");
    expect(recentButtons[1]).toHaveTextContent("JSON Viewer");
  });

  it("shows pinned tools on the home page when a tool is pinned", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.click(screen.getAllByRole("button", { name: /json viewer/i })[0]);

    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pin to Home" }));
    fireEvent.click(screen.getByRole("button", { name: /^home$/i }));

    const main = screen.getByRole("main");

    expect(within(main).getByText("Pinned tools")).toBeInTheDocument();
    expect(within(main).getByText("Recently Used")).toBeInTheDocument();
    expect(within(main).getByText("Quick Access")).toBeInTheDocument();

    // The heading sits in a header row with the Edit button.
    const pinnedSection = within(main).getByText("Pinned tools").parentElement?.parentElement;

    if (!pinnedSection) {
      throw new Error("Pinned tools section not found");
    }

    expect(
      within(pinnedSection).getByRole("button", { name: /json viewer/i })
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "null")).toEqual(["json-viewer"]);
  });

  it("migrates favorites and drops stored pins and recents that are not in the catalog", () => {
    setupMatchMedia();
    localStorage.setItem("shard-favorites", JSON.stringify(["removed-plugin"]));
    localStorage.setItem("shard-recent-tools", JSON.stringify(["removed-plugin", "json-viewer"]));

    render(<Shard />);

    const main = screen.getByRole("main");
    expect(within(main).queryByText("Favorites")).not.toBeInTheDocument();
    expect(within(main).getByText("Recently Used")).toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: "removed-plugin" })).not.toBeInTheDocument();
    expect(localStorage.getItem("shard-favorites")).toBeNull();
    expect(JSON.parse(localStorage.getItem("shard-pinned") ?? "null")).toEqual([]);
  });

  it("leaves hidden tools out of the shell", () => {
    setupMatchMedia();
    localStorage.setItem("shard-hidden-tools", JSON.stringify(["json-viewer"]));

    render(<Shard />);

    expect(within(screen.getByRole("main")).queryByRole("button", { name: /json viewer/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("button", { name: /code playground/i })).toBeInTheDocument();
  });

  it("filters quick access to avoid tools already shown in recent or pinned", () => {
    setupMatchMedia();

    localStorage.setItem("shard-recent-tools", JSON.stringify(["json-viewer"]));
    localStorage.setItem("shard-pinned", JSON.stringify(["json-typescript"]));

    render(<Shard />);

    const main = screen.getByRole("main");
    const quickAccessSection = within(main).getByText("Quick Access").parentElement;

    if (!quickAccessSection) {
      throw new Error("Quick Access section not found");
    }

    expect(
      within(quickAccessSection).queryByRole("button", { name: /json viewer/i })
    ).not.toBeInTheDocument();
    expect(
      within(quickAccessSection).queryByRole("button", { name: /json to typescript/i })
    ).not.toBeInTheDocument();
    expect(
      within(quickAccessSection).getByRole("button", { name: /code playground/i })
    ).toBeInTheDocument();
    expect(
      within(quickAccessSection).getByRole("button", { name: /regex tester/i })
    ).toBeInTheDocument();
  });

  it("persists recent tools across launches and caps the list at six unique entries", async () => {
    setupMatchMedia();

    localStorage.setItem(
      "shard-recent-tools",
      JSON.stringify([
        "password-generator",
        "bcrypt-generator",
        "json-diff",
        "json-typescript",
        "regex-generator",
        "code-playground",
      ])
    );

    const { unmount } = render(<Shard />);

    const firstMain = screen.getByRole("main");

    expect(within(firstMain).getByText("Recently Used")).toBeInTheDocument();
    expect(within(firstMain).getByText("Quick Access")).toBeInTheDocument();

    unmount();
    render(<Shard />);

    const main = screen.getByRole("main");

    expect(within(main).getByText("Recently Used")).toBeInTheDocument();
    expect(within(main).getByText("Quick Access")).toBeInTheDocument();

    const recentSection = within(main).getByText("Recently Used").parentElement;

    if (!recentSection) {
      throw new Error("Recently Used section not found");
    }

    const recentButtons = within(recentSection).getAllByRole("button", {
      name: /code playground|regex tester|json to code|json diff|bcrypt generator|password generator/i,
    });

    expect(recentButtons).toHaveLength(6);
    expect(recentButtons[0]).toHaveTextContent("Password Generator");
    expect(recentButtons[5]).toHaveTextContent("Code Playground");
    expect(
      within(recentSection).queryByRole("button", { name: /json viewer/i })
    ).not.toBeInTheDocument();
  });
});

it('keeps a tool open while another tool is selected, and closes it from its tab', async () => {
  setupMatchMedia();
  render(<Shard />);
  fireEvent.change(screen.getByPlaceholderText('Search...'), {target:{value:'jwt decoder'}});
  fireEvent.click(screen.getByRole('button',{name:'JWT Decoder'}));
  await screen.findByRole('tab',{name:'JWT Decoder'});
  fireEvent.change(screen.getByPlaceholderText('Search...'), {target:{value:'json viewer'}});
  fireEvent.click(screen.getByRole('button',{name:'JSON Viewer'}));
  await screen.findByText('JSON Input');
  fireEvent.click(screen.getByRole('tab',{name:'JWT Decoder'}));
  expect(screen.getByRole('tab',{name:'JWT Decoder'})).toHaveAttribute('aria-selected','true');
  fireEvent.click(screen.getByRole('button',{name:'Close JWT Decoder'}));
  expect(screen.queryByRole('tab',{name:'JWT Decoder'})).not.toBeInTheDocument();
});
