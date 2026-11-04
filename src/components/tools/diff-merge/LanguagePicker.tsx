import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { languages } from "@codemirror/language-data";
import { useT } from "@/i18n";
import { languageLabel } from "@/utils/diff-merge/language";

const LANGUAGE_NAMES = languages.map((l) => l.name);
const PLAIN = "Plain text";

interface Props {
  /** `LanguageDescription` name, or null for plain text. */
  value: string | null;
  /** Names the trigger, e.g. "Language of Original". */
  label: string;
  onChange(name: string | null): void;
}

/** A language dropdown with a filter box. Radix Select only jumps by first letters, and the list has about 150 entries. */
export function LanguagePicker({ value, label, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const display = (name: string) => (name === PLAIN ? t("diffMerge.plainText") : name);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [PLAIN, ...LANGUAGE_NAMES].filter((n) => display(n).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (name: string) => {
    onChange(name === PLAIN ? null : name);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // The first match is the one Enter takes, so it is active as soon as the filter changes.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, options.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && options[active] !== undefined) pick(options[active]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-5 items-center gap-1 rounded-full border border-border bg-transparent py-0 ps-[9px] pe-1.5 text-[11px] font-semibold"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {languageLabel(value)}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="absolute start-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border bg-card text-xs font-normal shadow-lg"
          style={{ borderColor: "hsl(var(--foreground) / .12)" }}
        >
          <input
            autoFocus
            role="combobox"
            aria-label={t("diffMerge.language.filter")}
            aria-expanded
            aria-controls="dm-language-list"
            aria-activedescendant={options[active] !== undefined ? `dm-language-${active}` : undefined}
            placeholder={t("diffMerge.language.filter")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-full border-b border-border bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground"
          />
          <ul ref={list} id="dm-language-list" role="listbox" aria-label={t("diffMerge.language.options", { label })} className="m-0 max-h-64 list-none overflow-y-auto p-1">
            {options.map((name, i) => (
              <li
                key={name}
                id={`dm-language-${i}`}
                role="option"
                aria-selected={name === (value ?? PLAIN)}
                className={`cursor-pointer rounded-[5px] px-2 py-1.5 ${i === active ? "bg-accent text-accent-foreground" : ""} ${name === (value ?? PLAIN) ? "font-semibold" : ""}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(name)}
              >
                {display(name)}
              </li>
            ))}
            {options.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">{t("diffMerge.language.none")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
