import { useEffect, useState } from "react";
import { installTheme, themeCatalog, type ThemeCatalogEntry } from "@/lib/desktop";
import { ActionButton } from "@/components/app/settings/Row";
import type { CustomThemes } from "@/components/app/settings/CustomThemes";

/** The color themes the repositories list, with Install and Update. Installed themes land in the themes folder of Settings. */
export function ThemesTab({ themes }: { themes: CustomThemes }) {
  const [catalog, setCatalog] = useState<ThemeCatalogEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    themeCatalog().then(setCatalog, () => setCatalog([]));
  }, []);

  const install = async (entry: ThemeCatalogEntry) => {
    setProblem(null);
    try {
      await installTheme(entry.repo, entry.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    await themes.reload();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-3">
      {catalog?.length === 0 && <p className="py-6 text-sm text-muted-foreground">No repository lists themes yet.</p>}
      {catalog?.map((entry) => {
        const installed = themes.themes.find((theme) => theme.id === entry.id);
        // ponytail: any other version counts as an update. Compare semver if a repository ever lists older ones.
        const update = installed?.repo === entry.repo && installed.version !== entry.version;
        const label = installed ? (update ? "Update" : "Installed") : "Install";
        return (
          <div key={`${entry.repo}/${entry.id}`} className="flex items-center justify-between gap-6 border-b border-border py-2.5 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="text-foreground">{entry.name} <span className="text-xs text-muted-foreground">{entry.version} · {entry.repoName}</span></span>
              {entry.description && <span className="text-xs text-muted-foreground">{entry.description}</span>}
            </span>
            <ActionButton aria-label={`${label} ${entry.name}`} disabled={Boolean(installed) && !update} onClick={() => void install(entry)}>
              {label}
            </ActionButton>
          </div>
        );
      })}
      {problem && <p role="alert" className="py-2 text-xs text-destructive">{problem}</p>}
    </div>
  );
}
