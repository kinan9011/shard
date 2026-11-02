import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JsonViewer } from "@/components/tools/JsonViewer";

const setup = (value: string) => {
  render(<JsonViewer />);
  const input = screen.getByRole("textbox", { name: "JSON Input" });
  fireEvent.change(input, { target: { value } });
  return input as HTMLTextAreaElement;
};
const text = () => [...screen.getByRole("region", { name: "Output" }).querySelectorAll("code")].map((el) => el.textContent).join("\n");

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

describe("JSON Viewer", () => {
  it("renders only the rows near the viewport of a very long output, with the full line count and numbering", () => {
    setup(JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i }))));
    const rows = screen.getByRole("region", { name: "Output" }).querySelectorAll(".code-line");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(400);
    expect(rows[0].querySelector(".output-line-number")?.textContent).toBe("1");
    expect(screen.getByText(/^6002 lines/)).toBeInTheDocument();
    // The rows that are not rendered still take their space, so the scrollbar is the size of the whole output.
    expect(screen.getByRole("region", { name: "Output" }).querySelector("pre")?.style.paddingBottom).toMatch(/^\d{5,}px$/);
  });

  it("formats as the user types", () => {
    setup('{"a":1}');
    expect(text()).toBe('{\n  "a": 1\n}');
    expect(screen.getByText("Valid JSON")).toBeInTheDocument();
  });

  it("converts a Python literal and says what it repaired", () => {
    setup("{'a': True, 'b': None,}");
    expect(text()).toBe('{\n  "a": true,\n  "b": null\n}');
    expect(screen.getByText("Repaired: converted from a Python literal; removed 1 trailing comma.")).toBeInTheDocument();
    expect(screen.getByText("Converted to JSON")).toBeInTheDocument();
  });

  it("keeps large numbers exact and warns", () => {
    setup('{"id": 12345678901234567890}');
    expect(text()).toBe('{\n  "id": 12345678901234567890\n}');
    expect(screen.getByText(/1 number is larger than 2\^53/)).toBeInTheDocument();
  });

  it("indents with tabs", () => {
    setup('{"a":1}');
    fireEvent.change(screen.getByRole("combobox", { name: "Indentation" }), { target: { value: "tab" } });
    expect(text()).toBe('{\n\t"a": 1\n}');
  });

  it("reads NDJSON as an array", () => {
    setup('{"a":1}\n{"a":2}');
    fireEvent.click(screen.getByRole("button", { name: "Minify" }));
    expect(text()).toBe('[{"a":1},{"a":2}]');
    expect(screen.getByText("Read 2 NDJSON lines as an array.")).toBeInTheDocument();
  });

  it("shows the error position and selects it in the input", () => {
    const input = setup('{\n  "a": 1,\n  "b": ]\n}');
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Line 3, column 8: Expected a value.");
    expect(text()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Show in input" }));
    expect(input.selectionStart).toBe(19);
    expect(document.activeElement).toBe(input);
  });

  it("keeps the chosen output mode while the input changes", () => {
    const input = setup('{"b":1,"a":2}');
    fireEvent.click(screen.getByRole("button", { name: "Sort keys" }));
    expect(screen.getByRole("button", { name: "Sort keys" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(input, { target: { value: '{"d":1,"c":2}' } });
    expect(text()).toBe('{\n  "c": 2,\n  "d": 1\n}');
  });
});
