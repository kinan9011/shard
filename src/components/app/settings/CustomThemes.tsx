import { useEffect, useState } from "react";
import { importTheme, installTheme, openThemesFolder, removeTheme, themeCatalog, type ThemeCatalogEntry } from "@/lib/desktop";
import type { ColorScheme, UserTheme } from "@/utils/theme";
import { ActionButton, Row } from "./Row";

export interface CustomThemes {
  /** The themes of the user's folder. */
  themes: UserTheme[];
  schemes: ColorScheme[];
  /** Files in that folder that are not usable. */
  errors: string[];
  reload(): Promise<void>;
}

/** Import, list and remove the theme files of the user. A theme is a JSON file: see docs/themes.md. */
export function CustomThemesRow({ themes }: { themes: CustomThemes }) {
  const [problem, setProblem] = useState<string | null>(null);
  // Every action ends with a reload, so the list and the stylesheet follow the folder.
  const run = async (action: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    await themes.reload();
  };
  const [catalog, setCatalog] = useState<ThemeCatalogEntry[]>([]);
  useEffect(() => {
    themeCatalog().then(setCatalog, () => setCatalog([]));
  }, []);
  const problems = [...(problem ? [problem] : []), ...themes.errors];
  return (
    <>
      <Row title="Custom themes" hint="Add a theme file, or edit the ones in the themes folder and reload.">
        <div className="flex gap-2">
          <ActionButton onClick={() => void run(importTheme)}>Import…</ActionButton>
          <ActionButton onClick={() => void run(openThemesFolder)}>Open folder</ActionButton>
          <ActionButton onClick={() => void themes.reload()}>Reload</ActionButton>
        </div>
      </Row>
      {themes.schemes.map((scheme) => (
        <div key={scheme.id} className="flex items-center justify-between gap-6 border-t border-border py-2 pl-4 text-sm">
          <span className="text-foreground">{scheme.name}</span>
          <ActionButton aria-label={`Remove ${scheme.name}`} onClick={() => void run(() => removeTheme(scheme.id))}>Remove</ActionButton>
        </div>
      ))}
      {catalog.map((entry) => {
        const installed = themes.themes.find((theme) => theme.id === entry.id);
        // ponytail: any other version counts as an update. Compare semver if a repository ever lists older ones.
        const update = installed?.repo === entry.repo && installed.version !== entry.version;
        return (
          <div key={`${entry.repo}/${entry.id}`} className="flex items-center justify-between gap-6 border-t border-border py-2 pl-4 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground">{entry.name} <span className="text-xs text-muted-foreground">{entry.version} · {entry.repoName}</span></span>
              {entry.description && <span className="text-xs text-muted-foreground">{entry.description}</span>}
            </span>
            <ActionButton
              aria-label={`${installed ? (update ? "Update" : "Installed") : "Install"} ${entry.name}`}
              disabled={Boolean(installed) && !update}
              onClick={() => void run(() => installTheme(entry.repo, entry.id))}
            >
              {installed ? (update ? "Update" : "Installed") : "Install"}
            </ActionButton>
          </div>
        );
      })}
      {problems.length > 0 && (
        <ul role="alert" className="border-t border-border py-2 text-xs text-destructive">
          {problems.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </>
  );
}
