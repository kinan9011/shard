import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { saveFile, saveTheme } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { fromPicker, toPicker } from "@/utils/theme-colors";
import { contrastWarnings, describeWarning } from "@/utils/theme-contrast";
import { ALL_TOKENS, FALLBACK, TOKEN_GROUPS, slugify } from "@/utils/theme-tokens";
import { themeCss, type UserTheme } from "@/utils/theme";
import { ActionButton } from "./Row";

const DRAFT_ID = "draft-preview";
const STYLE_ID = "shard-theme-draft";
type Mode = "light" | "dark";
type Tokens = Record<string, string>;

/** The colors the page shows right now, token by token. A token the page does not define gets a neutral gray. */
function currentTokens(): Tokens {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(ALL_TOKENS.map((token) => [token, style.getPropertyValue(token).trim() || FALLBACK(token)]));
}

interface Props {
  /** A theme of the user to edit. Absent: a new one, started from the colors on screen. */
  initial?: UserTheme | null;
  /** The mode in effect: the draft is shown in it while the editor is open. */
  dark: boolean;
  onClose(): void;
  /** The theme was saved. */
  onSaved(theme: UserTheme): void;
}

/** Makes or edits a theme with color pickers, shows it live, warns about faint text, saves it to the themes folder or exports it as JSON. */
export function ThemeEditor({ initial, dark, onClose, onSaved }: Props) {
  const t = useT();
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [idTouched, setIdTouched] = useState(editing);
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [mode, setMode] = useState<Mode>(dark ? "dark" : "light");
  const [blocks, setBlocks] = useState<Partial<Record<Mode, Tokens>>>(() => ({
    light: initial?.light,
    dark: initial?.dark,
    ...(initial ? {} : { [dark ? "dark" : "light"]: currentTokens() }),
  }));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useDialogFocus(true, onClose);

  const draft = useMemo<UserTheme>(
    () => ({ id: id || DRAFT_ID, name: name || "Untitled", version: initial?.version ?? "1.0.0", author, ...(blocks.light ? { light: blocks.light } : {}), ...(blocks.dark ? { dark: blocks.dark } : {}) }),
    [id, name, author, blocks, initial?.version],
  );

  // Live preview: the draft as a scheme of its own, switched on while the editor is open and put back after.
  const before = useRef<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    before.current ??= root.getAttribute("data-scheme");
    const style = document.getElementById(STYLE_ID) ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    style.textContent = themeCss([{ ...draft, id: DRAFT_ID }]);
    document.head.appendChild(style);
    root.setAttribute("data-scheme", DRAFT_ID);
  }, [draft]);
  useEffect(
    () => () => {
      const root = document.documentElement;
      if (before.current) root.setAttribute("data-scheme", before.current);
      document.getElementById(STYLE_ID)?.remove();
    },
    [],
  );

  const tokens = blocks[mode];
  const warnings = contrastWarnings(tokens);
  const setToken = (token: string, hex: string) => setBlocks((current) => ({ ...current, [mode]: { ...current[mode], [token]: fromPicker(token, hex) } }));
  // A mode the theme does not have yet starts as a copy of the one it has.
  const addMode = (next: Mode) => {
    setBlocks((current) => ({ ...current, [next]: { ...(current[mode] ?? currentTokens()) } }));
    setMode(next);
  };
  const other: Mode = mode === "dark" ? "light" : "dark";

  const file = (): UserTheme => ({ ...draft, id: id || slugify(name) });
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await saveTheme(file(), editing));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  const exportJson = async () => {
    const theme = file();
    try {
      await saveFile(new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" }), `${theme.id || "theme"}.json`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const field = "h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground";
  return (
    <div className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={editing ? t("settings.themeEditor.edit", { name: initial?.name ?? "" }) : t("settings.themeEditor.create")} className="modal-surface flex max-h-full w-[640px] max-w-full flex-col">
        <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-5">
          <h2 className="text-base font-semibold text-foreground">{editing ? t("settings.themeEditor.edit", { name: initial?.name ?? "" }) : t("settings.themeEditor.create")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label={t("settings.themeEditor.name")}
              placeholder={t("settings.themeEditor.namePlaceholder")}
              maxLength={40}
              className={field}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!idTouched) setId(slugify(event.target.value));
              }}
            />
            <input aria-label={t("settings.themeEditor.id")} placeholder={t("settings.themeEditor.idPlaceholder")} maxLength={40} disabled={editing} className={cn(field, "font-mono")} value={id} onChange={(event) => { setIdTouched(true); setId(event.target.value); }} />
            <input aria-label={t("settings.themeEditor.author")} placeholder={t("settings.themeEditor.author")} className={cn(field, "col-span-2")} value={author} onChange={(event) => setAuthor(event.target.value)} />
          </div>
          <div className="flex items-center gap-2" role="group" aria-label={t("settings.themeEditor.mode")}>
            {(["light", "dark"] as const).map((item) =>
              blocks[item] ? (
                <ActionButton key={item} aria-pressed={mode === item} className={mode === item ? "bg-accent" : ""} onClick={() => setMode(item)}>
                  {item === "dark" ? t("settings.theme.dark") : t("settings.theme.light")}
                </ActionButton>
              ) : null,
            )}
            {!blocks[other] && <ActionButton onClick={() => addMode(other)}>{other === "dark" ? t("settings.themeEditor.addDark") : t("settings.themeEditor.addLight")}</ActionButton>}
            <span className="text-xs text-muted-foreground">{dark ? t("settings.themeEditor.showsDark") : t("settings.themeEditor.showsLight")}</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {TOKEN_GROUPS.map((group) => (
            <section key={group.title} aria-label={t(group.title)} className="flex flex-col gap-1.5">
              <h3 className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">{t(group.title)}</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {group.tokens.map((token) => (
                  <label key={token} className="flex items-center justify-between gap-2 text-xs text-foreground">
                    <span className="font-mono">{token}</span>
                    <input type="color" aria-label={token} className="h-6 w-10 cursor-pointer rounded border border-input bg-transparent p-0" value={toPicker(tokens?.[token] ?? FALLBACK(token))} onChange={(event) => setToken(token, event.target.value)} />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-3">
          {warnings.length > 0 && (
            <ul aria-label={t("settings.themeEditor.warnings")} className="flex max-h-20 flex-col gap-0.5 overflow-y-auto text-xs text-warning">
              {warnings.map((warning) => <li key={warning.foreground + warning.background}>{describeWarning(warning)}</li>)}
            </ul>
          )}
          {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
          <div className="flex justify-end gap-2">
            <ActionButton onClick={() => void exportJson()}>{t("settings.themeEditor.exportJson")}</ActionButton>
            <ActionButton onClick={onClose}>{t("common.cancel")}</ActionButton>
            <ActionButton disabled={busy || !name.trim() || !(id || slugify(name))} onClick={() => void save()}>{t("common.save")}</ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}
