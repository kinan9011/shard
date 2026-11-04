import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useT } from "@/i18n";

/** An installed tool that suits some text. `what` names the text ("JSON", "a JWT") for the menu. */
export interface SendTarget {
  toolId: string;
  name: string;
  what: string;
}

export interface SendToApi {
  /** Opens the tool with `text` in its main input. */
  send: (toolId: string, text: string) => void;
  /** Installed tools that suit `text`, best first. */
  targets: (text: string) => SendTarget[];
}

const SendToContext = createContext<SendToApi | null>(null);
/** The shell provides this, so a tool does not import the shell. Without it the menu is not shown. */
export const SendToProvider = SendToContext.Provider;

/**
 * "Send to…" for a tool's output: lists the other tools that recognise the text and opens the one picked with it.
 * The tools are found when the menu opens, not on every render, because the output can be large.
 */
export function SendToMenu({ text, from, label: labelProp }: { text: string; /** This tool's id: never offered as a target. */ from: string; label?: string }) {
  const t = useT();
  const label = labelProp ?? t("shell.sendTo.label");
  const api = useContext(SendToContext);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<SendTarget[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only this menu: not the dialog or palette it may sit in.
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!api) return null;

  const toggle = () => {
    if (!open) setTargets(api.targets(text).filter((target) => target.toolId !== from));
    setOpen(!open);
  };
  const pick = (toolId: string) => {
    setOpen(false);
    api.send(toolId, text);
  };

  return (
    <div ref={root} className="relative inline-block">
      <button ref={button} type="button" className="toolbar-text-button" onClick={toggle} disabled={!text.trim()} aria-expanded={open} aria-haspopup="true">
        <Send size={14} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <ul className="absolute end-0 top-full z-30 mt-1 min-w-[200px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md" aria-label={label}>
          {targets.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("shell.sendTo.none")}</li>}
          {targets.map((target) => (
            <li key={target.toolId}>
              <button type="button" className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent" onClick={() => pick(target.toolId)}>
                <span>{target.name}</span>
                <span className="text-xs text-muted-foreground">{target.what}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
