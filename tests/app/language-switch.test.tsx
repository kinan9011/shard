import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  syncRepos: vi.fn(),
  onInstallProgress: vi.fn(),
  onPluginUpdates: vi.fn(),
  repoSettings: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);

import Shard from "@/app/Shard";
import { resetPlugins } from "@/plugins/usePlugins";

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listPlugins.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
  api.syncRepos.mockResolvedValue([]);
  api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
  api.onInstallProgress.mockResolvedValue(() => {});
  api.onPluginUpdates.mockResolvedValue(() => {});
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })),
  });
  // Radix Select measures and scrolls, which jsdom does not do.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("language switch in Settings", () => {
  it("picks Arabic: the app turns right to left and the text changes, then back to English", async () => {
    render(<Shard />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name: "General" }));

    const trigger = await screen.findByRole("combobox", { name: "Language" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "العربية" }));

    await waitFor(() => expect(document.documentElement).toHaveAttribute("dir", "rtl"));
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    // The settings navigation is now named in Arabic, and "Settings" is gone.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Settings" })).toBeNull());
    expect(localStorage.getItem("shard-language")).toBe("ar");

    // The option names stay native, so the person can find their way back.
    fireEvent.keyDown(screen.getByRole("combobox", { name: /.+/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "English" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("dir", "ltr"));
    expect(await screen.findByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
