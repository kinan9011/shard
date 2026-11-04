import { useRef, useState, type ChangeEvent } from "react";
import { useT } from "@/i18n";
import { CopyButton } from "../CopyButton";
import { LanguagePicker } from "./LanguagePicker";

export interface PaneHeaderProps {
  side: "a" | "b";
  /** "Original" or "Modified": shown while the pane has no file name. */
  label: string;
  name: string;
  language: string | null;
  /** Null while the side is empty: the design shows neither the count nor Clear and Copy then. */
  lineCount: number | null;
  focused: boolean;
  copyValue: () => string;
  onName(name: string): void;
  onLanguage(name: string | null): void;
  onFile(file: File): void;
  onPaste(): void;
  onClear(): void;
  onSave(): void;
}

export function PaneHeader(props: PaneHeaderProps) {
  const t = useT();
  const { side, label, name, language, lineCount, focused, copyValue } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const title = label;
  const filled = lineCount !== null;

  /** Escape and Enter both close the input; the blur that follows must not commit a second time. */
  const closed = useRef(false);
  const commit = () => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    if (draft.trim() !== name) props.onName(draft.trim());
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) props.onFile(file);
  };

  return (
    <div
      className="relative flex min-w-0 items-center justify-between gap-3 py-0 ps-[10px] pe-3 text-xs font-medium"
      style={{ background: "hsl(var(--muted) / .35)", borderBottom: "1px solid hsl(var(--border) / .5)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            autoFocus
            aria-label={t("diffMerge.pane.nameOf", { title })}
            value={draft}
            className="h-6 w-40 rounded-[5px] border border-input bg-background px-1.5 text-xs"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                closed.current = true;
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            title={t("diffMerge.pane.rename")}
            className="truncate whitespace-nowrap rounded-[5px] border border-transparent px-1.5 py-0.5 hover:border-border"
            onClick={() => {
              setDraft(name);
              closed.current = false;
              setEditing(true);
            }}
          >
            {name || label}
          </button>
        )}
        <LanguagePicker value={language} label={t("diffMerge.pane.languageOf", { title })} onChange={props.onLanguage} />
        {filled && <span className="whitespace-nowrap font-normal text-muted-foreground">{t("diffMerge.pane.lines", { count: lineCount })}</span>}
      </div>
      <div className="flex items-center gap-0.5 font-normal">
        <button type="button" className="toolbar-text-button" onClick={() => fileInput.current?.click()}>{t("diffMerge.pane.open")}</button>
        <input ref={fileInput} type="file" hidden data-open-side={side} aria-label={t("diffMerge.pane.openInto", { title })} onChange={onPick} />
        <button type="button" className="toolbar-text-button" onClick={props.onPaste}>{t("common.paste")}</button>
        {filled && (
          <>
            <button type="button" className="toolbar-text-button" onClick={props.onClear}>{t("common.clear")}</button>
            <CopyButton value={copyValue} label={t("common.copy")} ariaLabel={t("diffMerge.pane.copy", { title })} />
            <button type="button" className="toolbar-text-button" aria-label={t("diffMerge.pane.save", { title })} onClick={props.onSave}>{t("common.save")}</button>
          </>
        )}
      </div>
      {focused && <span className="absolute inset-x-0 -bottom-px h-0.5" style={{ background: "hsl(var(--ring))" }} data-side={side} />}
    </div>
  );
}
