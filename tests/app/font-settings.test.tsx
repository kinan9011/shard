import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FontSettings } from "@/components/app/settings/FontSettings";
import type { FontsApi } from "@/hooks/useFonts";
import { DEFAULT_FONT_PREFS } from "@/utils/fonts";

const setup = (custom: string[] = []) => {
  const fonts: FontsApi = {
    prefs: DEFAULT_FONT_PREFS,
    custom,
    setPrefs: vi.fn(),
    addFont: vi.fn().mockResolvedValue("Mine"),
    removeFont: vi.fn().mockResolvedValue(undefined),
  };
  render(<FontSettings fonts={fonts} />);
  return fonts;
};

describe("FontSettings", () => {
  it("picks a bundled font, a zoom and a field size", () => {
    const fonts = setup();
    fireEvent.change(screen.getByLabelText("Interface font"), { target: { value: "JetBrains Mono" } });
    expect(fonts.setPrefs).toHaveBeenCalledWith({ ui: "JetBrains Mono" });
    fireEvent.click(screen.getByRole("button", { name: "125%" }));
    expect(fonts.setPrefs).toHaveBeenCalledWith({ zoom: 1.25 });
    fireEvent.change(screen.getByLabelText("Field text size"), { target: { value: "16" } });
    expect(fonts.setPrefs).toHaveBeenCalledWith({ fieldSize: 16 });
  });

  it("takes the name of an installed font and refuses a bad one", () => {
    const fonts = setup();
    fireEvent.change(screen.getByLabelText("Field font"), { target: { value: "\u0000installed" } });
    const name = screen.getByLabelText("Field font: name of an installed font");
    fireEvent.change(name, { target: { value: 'a"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fonts.setPrefs).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Fira Code" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(fonts.setPrefs).toHaveBeenCalledWith({ field: "Fira Code" });
  });

  it("lists added fonts and removes one", () => {
    const fonts = setup(["Mine"]);
    expect(screen.getAllByText("Mine").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove Mine" }));
    expect(fonts.removeFont).toHaveBeenCalledWith("Mine");
  });
});
