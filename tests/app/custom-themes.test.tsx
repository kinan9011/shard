import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ importTheme: vi.fn(), removeTheme: vi.fn(), openThemesFolder: vi.fn(), saveTheme: vi.fn(), saveFile: vi.fn() }));
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

  it("removes a theme by id, only after a second step", async () => {
    const reload = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove Nord" }));
    expect(desktop.removeTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Nord" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.removeTheme).toHaveBeenCalledWith("nord");
  });

  it("keeps the file when the removal is cancelled", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove Nord" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(desktop.removeTheme).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Nord" })).toBeInTheDocument();
  });

  it("opens the editor to create a theme, and applies the one it saved", async () => {
    desktop.saveTheme.mockImplementation(async (theme) => theme);
    const reload = vi.fn().mockResolvedValue(undefined);
    const onApply = vi.fn();
    render(<CustomThemesRow themes={{ themes: [], schemes: [], errors: [], reload }} onBrowse={vi.fn()} dark onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Create…" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("mine"));
    expect(reload).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edits the user's own themes but not ones a repository installed", () => {
    render(
      <CustomThemesRow
        themes={{ themes: [nordFile(), nordFile({ id: "dracula", name: "Dracula", repo: "https://github.com/acme/themes" })], schemes: [nord, { ...nord, id: "dracula", name: "Dracula" }], errors: [], reload: vi.fn() }}
        onBrowse={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit Nord" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Dracula" })).toBeNull();
  });

  it("sends the user to the Themes tab of Plugins", () => {
    const onBrowse = vi.fn();
    render(<CustomThemesRow themes={{ themes: [], schemes: [], errors: [], reload: vi.fn() }} onBrowse={onBrowse} />);
    fireEvent.click(screen.getByRole("button", { name: "Get themes…" }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });
});
