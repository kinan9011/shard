import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

/** Settings → Shortcuts, the only place shortcuts are edited. */
const openShortcutSettings = () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name: "Shortcuts" }));
};

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

describe("Shard shortcuts", () => {
  it("records a shortcut in Settings and cancels the recording with Escape", async () => {
    setupMatchMedia();
    render(<Shard />);
    openShortcutSettings();
    expect(screen.queryByRole("dialog", { name: "Shortcut Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shortcuts" })).toBeInTheDocument();
    for (const group of ["General", "Pinned tools", "Tabs"]) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }
    expect(screen.getByText("Ctrl+Tab")).toBeInTheDocument();

    const record = screen.getByRole("button", { name: "Record Open Command Palette" });
    fireEvent.click(record);
    expect(record).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    // Ctrl+K is the current binding: while recording it must not open the palette.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(record).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument();
    // The page stays open: Escape only ends the recording.
    expect(screen.getByRole("heading", { name: "Shortcuts" })).toBeInTheDocument();
  });

  it("drops a recording when the command palette opens on top of it", async () => {
    setupMatchMedia();
    render(<Shard />);
    openShortcutSettings();
    const record = screen.getByRole("button", { name: "Record Go Home" });
    fireEvent.click(record);
    fireEvent.click(screen.getByRole("button", { name: "Open a tool" }));
    const input = await screen.findByPlaceholderText("Search tools...");
    expect(screen.getByRole("button", { name: "Record Go Home" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument());
  });

  it("refuses a shortcut that another action already uses", async () => {
    setupMatchMedia();
    render(<Shard />);
    openShortcutSettings();
    fireEvent.click(screen.getByRole("button", { name: "Record Go Home" }));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("That shortcut is already assigned to Open Command Palette.");
  });

  it("goes back to the defaults from Settings", async () => {
    setupMatchMedia();
    render(<Shard />);
    openShortcutSettings();
    fireEvent.click(screen.getByRole("button", { name: "Clear Open Command Palette" }));
    expect(screen.getByRole("button", { name: "Clear Open Command Palette" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset All Defaults" }));
    expect(screen.getByRole("button", { name: "Clear Open Command Palette" })).toBeEnabled();
  });

  it("opens the command palette with Ctrl+K and launches a tool with Enter", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Command Palette" });
    expect(dialog).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Search tools...");
    fireEvent.change(input, { target: { value: "json viewer" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });
  });

  it("closes the command palette with Escape", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search tools...");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument();
    });
  });

  it("does not trigger global shortcuts while typing in a tool input", async () => {
    setupMatchMedia();

    render(<Shard />);

    fireEvent.click(screen.getAllByRole("button", { name: /json viewer/i })[0]);

    const textarea = await screen.findByRole("textbox", { name: "JSON Input" });
    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "k", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument();
  });

  it("persists customized shortcuts across remounts", async () => {
    setupMatchMedia();

    const { unmount } = render(<Shard />);

    openShortcutSettings();

    fireEvent.click(screen.getByRole("button", { name: "Record Go Home" }));
    fireEvent.keyDown(window, { key: "H", ctrlKey: true, shiftKey: true });

    expect(screen.getByText("Ctrl+Shift+H")).toBeInTheDocument();

    // From Settings, so through the sidebar filter rather than Home's quick access.
    fireEvent.change(screen.getByLabelText("Filter tools"), { target: { value: "json viewer" } });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Tools" })).getByRole("button", { name: "JSON Viewer" }));
    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "H", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText("Quick Access")).toBeInTheDocument();
    });

    unmount();
    render(<Shard />);

    // The restart reopens the JSON Viewer tab, so its "Close JSON Viewer" button also matches /json viewer/i. Use the exact name.
    fireEvent.click(screen.getAllByRole("button", { name: "JSON Viewer" })[0]);
    await waitFor(() => {
      expect(screen.getByText("JSON Input")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "H", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText("Quick Access")).toBeInTheDocument();
    });
  });
});
