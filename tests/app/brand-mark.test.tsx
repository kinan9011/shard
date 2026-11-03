import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark } from "@/components/app/BrandMark";

describe("BrandMark", () => {
  it("is the one-tone mark, inverted on a dark theme, and hidden from screen readers", () => {
    const { container } = render(<BrandMark className="size-6" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("./brand/mark-mono.svg");
    expect(img).toHaveClass("dark:invert", "size-6");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });
});
