import { useState } from "react";
import { importTheme, openThemesFolder, removeTheme } from "@/lib/desktop";
import type { ColorScheme, UserTheme } from "@/utils/theme";
import { isMobileApp } from "@/lib/platform";
import { ThemeSwatches } from "@/components/app/ThemeSwatches";
import { ActionButton, Row } from "./Row";
import { ThemeEditor } from "./ThemeEditor";

export interface CustomThemes {
  /** The themes of the user's folder. */
  themes: UserTheme[];
  schemes: ColorScheme[];
  /** Files in that folder that are not usable. */
  errors: string[];
  reload(): Promise<void>;
}

/** Import, list and remove the theme files of the user. A theme is a JSON file: see docs/themes.md. */
export function CustomThemesRow({ themes, onBrowse, dark = false, onApply }: { themes: CustomThemes; onBrowse(): void; dark?: boolean; onApply?(id: string): void }) {
  // The editor: a new theme (`null`), a theme of the user's to change, or closed (`undefined`).
  const [editor, setEditor] = useState<UserTheme | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  // Remove deletes the file, which for a theme the user wrote is the only copy. Two steps, like Reset.
  const [removing, setRemoving] = useState<string | null>(null);
  // Every action ends with a reload, so the list and the stylesheet follow the folder.
  const run = async (action: () => Promise<unknown>) => {
    setProblem(null);
    setRemoving(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    await themes.reload();
  };
  const file = (id: string) => themes.themes.find((theme) => theme.id === id);
  const problems = [...(problem ? [problem] : []), ...themes.errors];
  return (
    <>
      <Row title="Custom themes" hint="Make a theme, add a theme file, get one from your repositories, or edit the ones in the themes folder and reload.">
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => setEditor(null)}>Create…</ActionButton>
          <ActionButton onClick={onBrowse}>Get themes…</ActionButton>
          {/* A phone's file picker hands out content addresses, not paths, and it has no folder to open. */}
          {!isMobileApp() && <ActionButton onClick={() => void run(importTheme)}>Import…</ActionButton>}
          {!isMobileApp() && <ActionButton onClick={() => void run(openThemesFolder)}>Open folder</ActionButton>}
          <ActionButton onClick={() => void themes.reload()}>Reload</ActionButton>
        </div>
      </Row>
      {themes.schemes.map((scheme) => (
        <div key={scheme.id} className="flex items-center justify-between gap-6 border-t border-border py-2 pl-4 text-sm">
          <span className="flex items-center gap-3 text-foreground">
            {scheme.name}
            {file(scheme.id) && <ThemeSwatches theme={file(scheme.id)!} dark={dark} />}
          </span>
          {removing === scheme.id ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Deletes the file. This can't be undone.</span>
              <ActionButton onClick={() => setRemoving(null)}>Cancel</ActionButton>
              <ActionButton aria-label={`Delete ${scheme.name}`} className="text-destructive" onClick={() => void run(() => removeTheme(scheme.id))}>Delete</ActionButton>
            </div>
          ) : (
            <span className="flex gap-2">
              {file(scheme.id) && !file(scheme.id)!.repo && <ActionButton aria-label={`Edit ${scheme.name}`} onClick={() => setEditor(file(scheme.id))}>Edit</ActionButton>}
              <ActionButton aria-label={`Remove ${scheme.name}`} onClick={() => setRemoving(scheme.id)}>Remove</ActionButton>
            </span>
          )}
        </div>
      ))}
      {editor !== undefined && (
        <ThemeEditor
          key={editor?.id ?? "new"}
          initial={editor}
          dark={dark}
          onClose={() => setEditor(undefined)}
          onSaved={(theme) => {
            setEditor(undefined);
            void themes.reload().then(() => onApply?.(theme.id));
          }}
        />
      )}
      {problems.length > 0 && (
        <ul role="alert" className="border-t border-border py-2 text-xs text-destructive">
          {problems.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </>
  );
}
