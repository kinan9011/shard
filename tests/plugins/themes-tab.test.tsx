import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ installTheme: vi.fn(), themeCatalog: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);

import { ThemesTab } from "@/components/plugins/ThemesTab";

const REPO = "https://github.com/acme/themes";
const listed = (id: string, version: string) => ({ id, name: id === "nord" ? "Nord" : "Dracula", version, description: "", repo: REPO, repoName: "Acme" });
const nordFile = (extra = {}) => ({ id: "nord", name: "Nord", version: "1.0.0", author: "", dark: {}, ...extra });
const setup = (themes = [nordFile()]) => {
  const reload = vi.fn().mockResolvedValue(undefined);
  render(<ThemesTab themes={{ themes, schemes: [], errors: [], reload }} />);
  return reload;
};

beforeEach(() => {
  Object.values(desktop).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  desktop.themeCatalog.mockResolvedValue([]);
});

describe("Themes tab", () => {
  it("says so when no repository lists themes", async () => {
    setup();
    expect(await screen.findByText("No repository lists themes yet.")).toBeInTheDocument();
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
    setup([nordFile({ repo: REPO })]);
    fireEvent.click(await screen.findByRole("button", { name: "Update Nord" }));
    await waitFor(() => expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "nord"));
  });

  it("shows why an install failed", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0")]);
    desktop.installTheme.mockRejectedValue(new Error("checksum mismatch"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Install Dracula" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("checksum mismatch");
  });
});
