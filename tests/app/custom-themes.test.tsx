import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ importTheme: vi.fn(), removeTheme: vi.fn(), openThemesFolder: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);

import { CustomThemesRow } from "@/components/app/settings/CustomThemes";

const nord = { id: "nord", name: "Nord", modes: ["dark" as const], user: true };
const nordFile = (extra = {}) => ({ id: "nord", name: "Nord", version: "1.0.0", author: "", dark: {}, ...extra });
const setup = (errors: string[] = [], themes = [nordFile()]) => {
  const reload = vi.fn().mockResolvedValue(undefined);
  render(<CustomThemesRow themes={{ themes, schemes: [nord], errors, reload }} onBrowse={vi.fn()} />);
  return reload;
};

beforeEach(() => {
  Object.values(desktop).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
});

describe("Custom themes row", () => {
  it("imports a theme and reloads the list", async () => {
    const reload = setup();
    fireEvent.click(screen.getByRole("button", { name: "Import…" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.importTheme).toHaveBeenCalledOnce();
  });

  it("shows why a file was refused, and the unusable files of the folder", async () => {
    desktop.importTheme.mockRejectedValue(new Error("dark: bad value for --background: red"));
    setup(["broken.json: Not a theme file"]);
    fireEvent.click(screen.getByRole("button", { name: "Import…" }));
    expect(await screen.findByText("dark: bad value for --background: red")).toBeInTheDocument();
    expect(screen.getByText("broken.json: Not a theme file")).toBeInTheDocument();
  });

  it("removes a theme by id", async () => {
    const reload = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove Nord" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.removeTheme).toHaveBeenCalledWith("nord");
  });

  it("sends the user to the Themes tab of Plugins", () => {
    const onBrowse = vi.fn();
    render(<CustomThemesRow themes={{ themes: [], schemes: [], errors: [], reload: vi.fn() }} onBrowse={onBrowse} />);
    fireEvent.click(screen.getByRole("button", { name: "Get themes…" }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });
});
