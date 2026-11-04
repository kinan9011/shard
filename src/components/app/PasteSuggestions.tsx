import { useEffect } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { useT } from "@/i18n";
import type { PasteSuggestion } from "@/utils/clipboard-detect";

interface PasteSuggestionsProps {
  suggestions: PasteSuggestion[];
  toolName: (toolId: string) => string;
  /** Called with the tool's id: the app opens the tool, or installs it when the suggestion says `install`. */
  onOpen: (toolId: string) => void;
  onDismiss: () => void;
}

/** Suggests tools for text the user pasted outside a field. Enter opens (or installs) the first, Esc dismisses. */
export function PasteSuggestions({ suggestions, toolName, onOpen, onDismiss }: PasteSuggestionsProps) {
  const t = useT();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onOpen(suggestions[0].toolId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const timer = window.setTimeout(onDismiss, 15000);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(timer);
    };
  }, [onDismiss, onOpen, suggestions]);

  const [best, ...others] = suggestions;
  return (
    <div className="paste-suggestions" role="status" aria-live="polite">
      <ClipboardPaste size={16} aria-hidden="true" className="shrink-0 text-primary" />
      <p className="text-sm">
        {t("shell.paste.looksLike", { label: best.label })}
      </p>
      <button type="button" className="native-button" onClick={() => onOpen(best.toolId)}>
        {t(best.install ? "shell.paste.install" : "shell.paste.open", { name: toolName(best.toolId) })} <kbd>↵</kbd>
      </button>
      {others.map((item) => (
        <button key={item.toolId} type="button" className="toolbar-text-button" onClick={() => onOpen(item.toolId)}>
          {item.install ? t("shell.paste.install", { name: toolName(item.toolId) }) : toolName(item.toolId)}
        </button>
      ))}
      <button type="button" className="toolbar-text-button" aria-label={t("shell.paste.dismiss")} title={t("shell.paste.dismissTitle")} onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
