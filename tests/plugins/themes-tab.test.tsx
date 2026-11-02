import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ installTheme: vi.fn(), previewTheme: vi.fn(), removeTheme: vi.fn(), themeCatalog: vi.fn() }));
vi.mock("@/lib/desktop", () => desktop);
const api = vi.hoisted(() => ({ syncRepos: vi.fn() }));
vi.mock("@/plugins/api", () => api);

import { ThemesTab, type ThemeApply } from "@/components/plugins/ThemesTab";

const REPO = "https://github.com/acme/themes";
const listed = (id: string, version: string) => ({ id, name: id === "nord" ? "Nord" : "Dracula", version, description: "", repo: REPO, repoName: "Acme" });
const nordFile = (extra = {}) => ({ id: "nord", name: "Nord", version: "1.0.0", author: "", dark: {}, ...extra });
const setup = (themes = [nordFile()], extra: { apply?: ThemeApply; onAddRepository?: () => void } = {}) => {
  const reload = vi.fn().mockResolvedValue(undefined);
  render(<ThemesTab themes={{ themes, schemes: [], errors: [], reload }} {...extra} />);
  return reload;
};
const PREVIEW = { id: "nord", name: "Nord", version: "1.0.0", author: "", dark: { "--background": "220 16% 22%", "--foreground": "220 16% 90%", "--primary": "213 77% 60%" }, light: { "--background": "0 0% 100%", "--foreground": "0 0% 80%" } };

beforeEach(() => {
  Object.values(desktop).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  desktop.themeCatalog.mockResolvedValue([]);
  api.syncRepos.mockReset().mockResolvedValue([]);
  desktop.previewTheme.mockResolvedValue(PREVIEW);
});

describe("Themes tab", () => {
  it("says so when no repository lists themes", async () => {
    setup();
    expect(await screen.findByText(/No repository lists themes yet/)).toBeInTheDocument();
  });

  it("offers to add a repository when nothing lists themes", async () => {
    const onAddRepository = vi.fn();
    setup([], { onAddRepository });
    fireEvent.click(await screen.findByRole("button", { name: "Add a repository" }));
    expect(onAddRepository).toHaveBeenCalledOnce();
  });

  it("shows the colors of each listed theme in the mode in effect, and warns about faint text", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    setup([], { apply: { scheme: "adwaita", onScheme: vi.fn(), dark: true } });
    const swatches = await screen.findByTestId("swatches-nord");
    expect(swatches.children).toHaveLength(3);
    expect(desktop.previewTheme).toHaveBeenCalledWith(REPO, "nord");
    // The light block of the fixture has gray text on white.
    expect(screen.queryByText("Low contrast")).toBeNull();
  });

  it("flags a light theme whose text is too faint", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    setup([], { apply: { scheme: "adwaita", onScheme: vi.fn(), dark: false } });
    expect(await screen.findByText("Low contrast")).toBeInTheDocument();
  });

  it("applies an installed theme, and not one that has no colors for the current mode", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    const onScheme = vi.fn();
    const { unmount } = render(<ThemesTab themes={{ themes: [nordFile({ repo: REPO })], schemes: [], errors: [], reload: vi.fn() }} apply={{ scheme: "adwaita", onScheme, dark: true }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply Nord" }));
    expect(onScheme).toHaveBeenCalledWith("nord");
    unmount();

    render(<ThemesTab themes={{ themes: [nordFile({ repo: REPO, dark: undefined, light: {} })], schemes: [], errors: [], reload: vi.fn() }} apply={{ scheme: "adwaita", onScheme, dark: true }} />);
    expect(await screen.findByRole("button", { name: "Apply Nord" })).toBeDisabled();
  });

  it("says which theme is in use", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    setup([nordFile({ repo: REPO })], { apply: { scheme: "nord", onScheme: vi.fn(), dark: true } });
    expect(await screen.findByRole("button", { name: "Apply Nord" })).toHaveTextContent("In use");
  });

  it("syncs the repositories and lists what the sync found", async () => {
    setup();
    await screen.findByText(/No repository lists themes yet/);
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0")]);
    fireEvent.click(screen.getByRole("button", { name: "Sync repositories" }));
    expect(await screen.findByRole("button", { name: "Install Dracula" })).toBeInTheDocument();
    expect(api.syncRepos).toHaveBeenCalledOnce();
  });

  it("installs once however often the button is clicked", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0")]);
    desktop.installTheme.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const reload = setup();
    const button = await screen.findByRole("button", { name: "Install Dracula" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.installTheme).toHaveBeenCalledOnce();
  });

  it("installs a listed theme, and offers an update only for a theme that came from that repository", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0"), listed("nord", "2.0.0")]);
    // Nord was made by the user (no repo): its listed namesake cannot replace it.
    const reload = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Install Dracula" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "dracula");
    expect(screen.getByRole("button", { name: "Id in use Nord" })).toBeDisabled();
  });

  it("updates an installed theme when the repository lists another version", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "2.0.0")]);
    setup([nordFile({ repo: REPO })]);
    fireEvent.click(await screen.findByRole("button", { name: "Update Nord" }));
    await waitFor(() => expect(desktop.installTheme).toHaveBeenCalledWith(REPO, "nord"));
  });

  it("removes an installed repository theme, only after a second step", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    const reload = setup([nordFile({ repo: REPO })]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Nord" }));
    expect(desktop.removeTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Nord" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(desktop.removeTheme).toHaveBeenCalledWith("nord");
  });

  it("keeps the theme when the removal is cancelled, and offers no Remove for a file the repository did not install", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("nord", "1.0.0")]);
    const { unmount } = render(<ThemesTab themes={{ themes: [nordFile({ repo: REPO })], schemes: [], errors: [], reload: vi.fn() }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Nord" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(desktop.removeTheme).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Nord" })).toBeInTheDocument();
    unmount();
    setup();
    await screen.findByRole("button", { name: "Id in use Nord" });
    expect(screen.queryByRole("button", { name: "Remove Nord" })).toBeNull();
  });

  it("shows why an install failed", async () => {
    desktop.themeCatalog.mockResolvedValue([listed("dracula", "1.0.0")]);
    desktop.installTheme.mockRejectedValue(new Error("checksum mismatch"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Install Dracula" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("checksum mismatch");
  });
});
