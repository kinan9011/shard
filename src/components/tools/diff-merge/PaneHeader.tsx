import { useRef, useState, type ChangeEvent } from "react";
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
      className="relative flex min-w-0 items-center justify-between gap-3 py-0 pl-[10px] pr-3 text-xs font-medium"
      style={{ background: "hsl(var(--muted) / .35)", borderBottom: "1px solid hsl(var(--border) / .5)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            autoFocus
            aria-label={`Name of ${title}`}
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
            title="Rename"
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
        <LanguagePicker value={language} label={`Language of ${title}`} onChange={props.onLanguage} />
        {filled && <span className="whitespace-nowrap font-normal text-muted-foreground">{lineCount} lines</span>}
      </div>
      <div className="flex items-center gap-0.5 font-normal">
        <button type="button" className="toolbar-text-button" onClick={() => fileInput.current?.click()}>Open</button>
        <input ref={fileInput} type="file" hidden aria-label={`Open file into ${title}`} onChange={onPick} />
        <button type="button" className="toolbar-text-button" onClick={props.onPaste}>Paste</button>
        {filled && (
          <>
            <button type="button" className="toolbar-text-button" onClick={props.onClear}>Clear</button>
            <CopyButton value={copyValue} label="Copy" ariaLabel={`Copy ${title}`} />
            <button type="button" className="toolbar-text-button" aria-label={`Save ${title}`} onClick={props.onSave}>Save</button>
          </>
        )}
      </div>
      {focused && <span className="absolute inset-x-0 -bottom-px h-0.5" style={{ background: "hsl(var(--ring))" }} data-side={side} />}
    </div>
  );
}
