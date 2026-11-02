import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Shard from "@/app/Shard";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

const TOOLS = ["JSON Diff", "JSON to Code", "JSON Schema Validator", "Regex Tester"];

const openTools = () => {
  render(<Shard />);
  const sidebarNav = screen.getAllByRole("navigation")[0];
  fireEvent.click(within(sidebarNav).getByRole("button", { name: /development tools/i }));
  for (const name of TOOLS) fireEvent.click(within(sidebarNav).getByRole("button", { name, exact: true }));
};
const tabNames = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);
const openMenu = (name: string) => {
  fireEvent.contextMenu(screen.getByRole("tab", { name }), { clientX: 40, clientY: 30 });
  return screen.getByRole("menu", { name: `${name} tab` });
};

describe("Tab context menu", () => {
  it("closes the other tabs and selects the clicked tab", () => {
    openTools();
    expect(tabNames()).toEqual(TOOLS);
    fireEvent.click(within(openMenu("JSON to Code")).getByRole("menuitem", { name: "Close other tabs" }));
    expect(tabNames()).toEqual(["JSON to Code"]);
    expect(screen.getByRole("tab", { name: "JSON to Code" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the tabs to the right and keeps the selection when it stays open", () => {
    openTools();
    fireEvent.click(screen.getByRole("tab", { name: "JSON Diff" }));
    fireEvent.click(within(openMenu("JSON to Code")).getByRole("menuitem", { name: "Close tabs to the right" }));
    expect(tabNames()).toEqual(["JSON Diff", "JSON to Code"]);
    expect(screen.getByRole("tab", { name: "JSON Diff" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes all tabs and returns to the home screen", () => {
    openTools();
    fireEvent.click(within(openMenu("JSON Schema Validator")).getByRole("menuitem", { name: "Close all tabs" }));
    expect(tabNames()).toEqual([]);
    expect(within(screen.getByRole("main")).getByText("Quick Access")).toBeInTheDocument();
  });

  it("closes one tab and disables actions that have no tabs to close", () => {
    openTools();
    const menu = openMenu("Regex Tester");
    expect(within(menu).getByRole("menuitem", { name: "Close tabs to the right" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close", exact: true }));
    expect(tabNames()).toEqual(TOOLS.slice(0, 3));
  });

  it("dismisses the menu with Escape without closing tabs", () => {
    openTools();
    const menu = openMenu("JSON Diff");
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(within(menu).getByRole("menuitem", { name: "Close other tabs" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(tabNames()).toEqual(TOOLS);
  });

  it("hides a built-in tool from its tab, closes the tab, and remembers it", () => {
    openTools();
    expect(tabNames()).toContain("Regex Tester");
    fireEvent.click(within(openMenu("Regex Tester")).getByRole("menuitem", { name: "Hide this tool" }));
    expect(tabNames()).not.toContain("Regex Tester");
    expect(JSON.parse(localStorage.getItem("shard-hidden-tools") ?? "[]")).toContain("regex-generator");
  });
});
