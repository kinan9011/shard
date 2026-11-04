import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeTextarea } from "@/components/tools/ToolWorkspace";
import { DirToggle } from "@/components/tools/DirToggle";
import { useFieldDirShortcut } from "@/hooks/useFieldDirShortcut";
import { setLanguage } from "@/i18n";

function Harness() {
  useFieldDirShortcut();
  return (
    <>
      <Input aria-label="plain" />
      <Textarea aria-label="area" />
      <CodeTextarea aria-label="code" />
      <CodeTextarea text id="prose" aria-label="prose" />
      <DirToggle target="prose" />
    </>
  );
}

describe("field direction", () => {
  it("lets plain fields follow what is typed, and keeps code left to right", () => {
    render(<Harness />);
    expect(screen.getByLabelText("plain")).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText("area")).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText("prose")).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText("code")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("code")).toHaveAttribute("data-dir-lock");
  });

  it("stays that way when the app is right to left", async () => {
    await setLanguage("ar");
    render(<Harness />);
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByLabelText("plain")).toHaveAttribute("dir", "auto");
    expect(screen.getByLabelText("code")).toHaveAttribute("dir", "ltr");
  });

  it("the toggle cycles auto, left to right, right to left", () => {
    render(<Harness />);
    const field = screen.getByLabelText("prose");
    const toggle = () => screen.getByRole("button", { name: /Text direction/ });
    fireEvent.click(toggle());
    expect(field).toHaveAttribute("dir", "ltr");
    expect(toggle()).toHaveAttribute("data-dir-mode", "ltr");
    fireEvent.click(toggle());
    expect(field).toHaveAttribute("dir", "rtl");
    fireEvent.click(toggle());
    expect(field).toHaveAttribute("dir", "auto");
  });

  it("Ctrl+Left Shift and Ctrl+Right Shift set the focused field, and the toggle shows it", () => {
    render(<Harness />);
    const field = screen.getByLabelText("prose");
    field.focus();
    fireEvent.keyDown(field, { code: "ShiftRight", key: "Shift", ctrlKey: true });
    expect(field).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("button", { name: /Text direction/ })).toHaveAttribute("data-dir-mode", "rtl");
    fireEvent.keyDown(field, { code: "ShiftLeft", key: "Shift", ctrlKey: true });
    expect(field).toHaveAttribute("dir", "ltr");
  });

  it("leaves code fields alone", () => {
    render(<Harness />);
    const code = screen.getByLabelText("code");
    code.focus();
    fireEvent.keyDown(code, { code: "ShiftRight", key: "Shift", ctrlKey: true });
    expect(code).toHaveAttribute("dir", "ltr");
  });

  it("needs Ctrl, and ignores other fields' keys", () => {
    render(<Harness />);
    const field = screen.getByLabelText("plain");
    field.focus();
    fireEvent.keyDown(field, { code: "ShiftRight", key: "Shift" });
    expect(field).toHaveAttribute("dir", "auto");
  });
});
