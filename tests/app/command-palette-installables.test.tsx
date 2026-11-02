import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/app/CommandPalette";
import { buildInstallables, type InstallableItem } from "@/hooks/usePaletteInstallables";

const plugin = (id: string, name: string, repo = "https://github.com/kinan9011/shard-plugins") =>
  ({ id, name, version: "1.0.0", description: `${name} does things.`, category: "Encoding", runtime: "web", url: "https://example.test/p.zip", sha256: "0".repeat(64), repo, repoName: "Shard Official", permissions: [] }) as never;
const theme = (id: string, name: string) => ({ id, name, version: "1.0.0", description: "Cool.", repo: "https://github.com/kinan9011/shard-themes", repoName: "Shard Themes" });

describe("buildInstallables", () => {
  const actions = { installPlugin: vi.fn(), installTheme: vi.fn() };

  it("lists what is not installed, once, with a second line that says what it is", () => {
    const items = buildInstallables(
      { plugins: [plugin("base64", "Base64"), plugin("checksum", "Checksum"), plugin("base64", "Base64 again", "https://github.com/acme/other")], themes: [theme("nord", "Nord"), theme("dracula", "Dracula")] },
      new Set(["checksum"]),
      new Set(["dracula"]),
      actions,
    );
    expect(items.map((item) => [item.name, item.subtitle])).toEqual([
      ["Base64", "Plugin · Shard Official"],
      ["Nord", "Theme · Shard Themes"],
    ]);
  });

  it("runs the matching action", () => {
    const [first, second] = buildInstallables({ plugins: [plugin("base64", "Base64")], themes: [theme("nord", "Nord")] }, new Set(), new Set(), actions);
    first!.run();
    second!.run();
    expect(actions.installPlugin).toHaveBeenCalledWith(expect.objectContaining({ id: "base64" }));
    expect(actions.installTheme).toHaveBeenCalledWith(expect.objectContaining({ id: "nord" }));
  });
});

describe("Command palette, install results", () => {
  const items: InstallableItem[] = [
    { id: "theme:nord", kind: "theme", name: "Nord", category: "Theme", keywords: ["Cool."], subtitle: "Theme · Shard Themes", run: vi.fn() },
    { id: "plugin:base64", kind: "plugin", name: "Base64", category: "Encoding", keywords: [], subtitle: "Plugin · Shard Official", run: vi.fn() },
  ];
  const open = () => {
    const onClose = vi.fn();
    render(<CommandPalette open tools={[]} pinned={[]} recents={[]} onClose={onClose} onSelectTool={vi.fn()} installables={items} />);
    return { onClose, input: screen.getByRole("combobox", { name: "Search tools" }) };
  };

  it("shows nothing to install until the user types", () => {
    open();
    expect(screen.queryByText("Install Nord")).toBeNull();
  });

  it("finds a theme by name, says where it is from, and installs it with Enter", () => {
    const { input, onClose } = open();
    fireEvent.change(input, { target: { value: "nord" } });
    expect(screen.getByRole("option", { name: /Install Nord/ })).toHaveTextContent("Theme · Shard Themes");
    expect(screen.queryByText("Install Base64")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(items[0]!.run).toHaveBeenCalledOnce();
  });

  it("finds a plugin by its category", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "encoding" } });
    fireEvent.click(screen.getByRole("option", { name: /Install Base64/ }));
    expect(items[1]!.run).toHaveBeenCalledOnce();
  });
});
