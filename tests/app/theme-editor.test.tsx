import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ saveTheme: vi.fn(), saveFile: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);

import { ThemeEditor } from "@/components/app/settings/ThemeEditor";

const setup = (props: Partial<Parameters<typeof ThemeEditor>[0]> = {}) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<ThemeEditor dark onClose={onClose} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
};
const pick = (token: string, hex: string) => fireEvent.change(screen.getByLabelText(token), { target: { value: hex } });

beforeEach(() => {
  desktop.saveTheme.mockReset().mockImplementation(async (theme) => theme);
  desktop.saveFile.mockReset().mockResolvedValue(true);
  document.documentElement.setAttribute("data-scheme", "adwaita");
});
afterEach(() => {
  document.documentElement.removeAttribute("data-scheme");
  document.getElementById("shard-theme-draft")?.remove();
});

describe("Theme editor", () => {
  it("makes an id from the name and saves the colors of the mode in effect", async () => {
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Tokyo Night!" } });
    expect(screen.getByLabelText("Theme id")).toHaveValue("tokyo-night");
    pick("--background", "#102030");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [theme, overwrite] = desktop.saveTheme.mock.calls[0]!;
    expect(overwrite).toBe(false);
    expect(theme).toMatchObject({ id: "tokyo-night", name: "Tokyo Night!", version: "1.0.0" });
    // A triplet for a normal token, and only the dark block: the page was dark.
    expect(theme.dark["--background"]).toMatch(/^\d+ \d+% \d+%$/);
    expect(theme.light).toBeUndefined();
  });

  it("writes hex tokens as hex", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "A" } });
    pick("--surface-editor", "#AA00FF");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(desktop.saveTheme).toHaveBeenCalled());
    expect(desktop.saveTheme.mock.calls[0]![0].dark["--surface-editor"]).toBe("#aa00ff");
  });

  it("warns, live, about text that is too faint", () => {
    setup();
    // jsdom has no computed colors, so every token starts as the same gray and the pairs are all faint. Watch one pair.
    const faint = () => screen.queryByText(/^--foreground on --background is/);
    pick("--background", "#ffffff");
    pick("--foreground", "#cccccc");
    expect(faint()).toBeInTheDocument();
    pick("--foreground", "#111111");
    expect(faint()).toBeNull();
  });

  it("shows the draft on the page while it is open and puts the scheme back after", () => {
    const { onClose } = { onClose: vi.fn() };
    const { unmount } = render(<ThemeEditor dark onClose={onClose} onSaved={vi.fn()} />);
    expect(document.documentElement.getAttribute("data-scheme")).toBe("draft-preview");
    expect(document.getElementById("shard-theme-draft")?.textContent).toContain('[data-scheme="draft-preview"].dark{');
    unmount();
    expect(document.documentElement.getAttribute("data-scheme")).toBe("adwaita");
    expect(document.getElementById("shard-theme-draft")).toBeNull();
  });

  it("edits a theme of the user's in place: the id is fixed and the save replaces the file", async () => {
    const initial = { id: "nord", name: "Nord", version: "2.0.0", author: "Me", dark: { "--background": "220 16% 22%" } };
    setup({ initial });
    expect(screen.getByLabelText("Theme id")).toBeDisabled();
    pick("--background", "#000000");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(desktop.saveTheme).toHaveBeenCalled());
    const [theme, overwrite] = desktop.saveTheme.mock.calls[0]!;
    expect(overwrite).toBe(true);
    expect(theme).toMatchObject({ id: "nord", version: "2.0.0", author: "Me" });
  });

  it("offers the other mode as a copy of this one", () => {
    setup({ initial: { id: "nord", name: "Nord", version: "1.0.0", author: "", dark: { "--background": "220 16% 22%" } } });
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Light" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add light colors" }));
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says why a save was refused and stays open", async () => {
    desktop.saveTheme.mockRejectedValue(new Error('id "adwaita" is a built-in scheme'));
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Adwaita" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("built-in scheme");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("needs a name before it saves, and exports the draft as JSON", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Tokyo Night" } });
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => expect(desktop.saveFile).toHaveBeenCalled());
    expect(desktop.saveFile.mock.calls[0]![1]).toBe("tokyo-night.json");
    const blob = desktop.saveFile.mock.calls[0]![0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toMatchObject({ id: "tokyo-night", name: "Tokyo Night" });
  });
});
