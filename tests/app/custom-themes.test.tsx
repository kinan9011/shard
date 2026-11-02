import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ importTheme: vi.fn(), removeTheme: vi.fn(), openThemesFolder: vi.fn(), installTheme: vi.fn(), themeCatalog: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);

import { CustomThemesRow } from "@/components/app/settings/CustomThemes";

const nord = { id: "nord", name: "Nord", modes: ["dark" as const], user: true };
const REPO = "https://github.com/acme/themes";
const listed = (id: string, version: string) => ({ id, name: id === "nord" ? "Nord" : "Dracula", version, description: "", repo: REPO, repoName: "Acme" });
const nordFile = (extra = {}) => ({ id: "nord", name: "Nord", version: "1.0.0", author: "", dark: {}, ...extra });
const setup = (errors: string[] = [], themes = [nordFile()]) => {
  const reload = vi.fn().mockResolvedValue(undefined);
  render(<CustomThemesRow themes={{ themes, schemes: [nord], errors, reload }} />);
  return reload;
};

beforeEach(() => {
  Object.values(desktop).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  desktop.themeCatalog.mockResolvedValue([]);
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

  it("installs a listed theme, and offers an update only for a theme that came from that repository", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0"), listed("nord", "2.0.0")]);
    // Nord was made by the user (no repo): its listed namesake cannot replace it.
    const reload = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Install Dracula" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "dracula");
    expect(screen.getByRole("button", { name: "Installed Nord" })).toBeDisabled();
  });

  it("updates an installed theme when the repository lists another version", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "2.0.0")]);
    setup([], [nordFile({ repo: REPO })]);
    fireEvent.click(await screen.findByRole("button", { name: "Update Nord" }));
    await waitFor(() => expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "nord"));
  });
});
