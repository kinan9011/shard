import { useCallback, useEffect, useRef, useState } from "react";
import { useT, type TKey } from "@/i18n";
import { installTheme, previewTheme, removeTheme, themeCatalog, type ThemeCatalogEntry } from "@/lib/desktop";
import { refreshThemeUpdates } from "@/hooks/useThemeUpdates";
import { ThemeSwatches } from "@/components/app/ThemeSwatches";
import type { UserTheme } from "@/utils/theme";
import { syncRepos } from "@/plugins/api";
import { isNewerVersion } from "@/utils/theme-updates";
import { ActionButton } from "@/components/app/settings/Row";
import type { CustomThemes } from "@/components/app/settings/CustomThemes";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What Apply needs: the scheme in use, how to switch, and the mode in effect. Without it the tab only installs. */
export interface ThemeApply {
  scheme: string;
  onScheme(id: string): void;
  dark: boolean;
}

/** The color themes the repositories list, with swatches, Install, Update, Apply and Remove. Installed themes land in the themes folder of Settings. */
export function ThemesTab({ themes, apply, onAddRepository }: { themes: CustomThemes; apply?: ThemeApply; onAddRepository?: () => void }) {
  const t = useT();
  const [catalog, setCatalog] = useState<ThemeCatalogEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  // Remove deletes the file, so it takes a second step, like Settings → Custom themes.
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(() => themeCatalog().then(setCatalog, () => setCatalog([])), []);
  useEffect(() => {
    void load();
  }, [load]);

  // The colors of each listed theme, read one after the other: a few small files, checked like an install but not saved.
  const [previews, setPreviews] = useState<Readonly<Record<string, UserTheme>>>({});
  const previewed = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const entry of catalog ?? []) {
        const key = `${entry.repo}/${entry.id}/${entry.version}`;
        if (cancelled) return;
        if (previewed.current.has(key)) continue;
        try {
          const theme = await previewTheme(entry.repo, entry.id);
          if (cancelled) return;
          previewed.current.add(key);
          setPreviews((current) => ({ ...current, [`${entry.repo}/${entry.id}`]: theme }));
        } catch {
          // No swatches for this one; Install shows the real reason if the file is bad.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  // The catalog is what the last sync read, so a repository that was not synced yet lists nothing until this runs.
  const sync = async () => {
    setSyncing(true);
    setProblem(null);
    try {
      await syncRepos();
    } catch (error) {
      setProblem(message(error));
    }
    await load();
    void refreshThemeUpdates();
    setSyncing(false);
  };

  const install = async (entry: ThemeCatalogEntry) => {
    const key = `${entry.repo}/${entry.id}`;
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    setProblem(null);
    try {
      await installTheme(entry.repo, entry.id);
    } catch (error) {
      setProblem(message(error));
    }
    await themes.reload();
    void refreshThemeUpdates();
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const remove = async (id: string) => {
    setRemoving(null);
    setProblem(null);
    try {
      await removeTheme(id);
    } catch (error) {
      setProblem(message(error));
    }
    await themes.reload();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-7">
      <div className="flex justify-end pb-2">
        <ActionButton disabled={syncing} onClick={() => void sync()}>{syncing ? t("plugins.themes.syncing") : t("plugins.themes.sync")}</ActionButton>
      </div>
      {catalog?.length === 0 && (
        <div className="flex flex-col items-start gap-3 py-6 text-sm text-muted-foreground">
          <p>{t("plugins.themes.empty")}</p>
          <div className="flex flex-wrap gap-2">
            {onAddRepository && <ActionButton onClick={onAddRepository}>{t("plugins.themes.addRepository")}</ActionButton>}
            <a className="inline-flex h-[30px] items-center text-primary underline-offset-2 hover:underline" href="https://github.com/kinan9011/shard/blob/main/docs/themes.md" target="_blank" rel="noreferrer">{t("plugins.themes.howItWorks")}</a>
          </div>
        </div>
      )}
      {catalog?.map((entry) => {
        const key = `${entry.repo}/${entry.id}`;
        const installed = themes.themes.find((theme) => theme.id === entry.id);
        // The file of that id came from this repository, or from the user or another repository, which Install never replaces.
        const ours = installed?.repo === entry.repo;
        const update = ours && isNewerVersion(entry.version, installed.version);
        const [label, labelAria]: readonly [TKey, TKey] = !installed ? ["plugins.themes.install", "plugins.themes.installAria"] : !ours ? ["plugins.themes.idInUse", "plugins.themes.idInUseAria"] : update ? ["plugins.themes.update", "plugins.themes.updateAria"] : ["plugins.themes.installed", "plugins.themes.installedAria"];
        return (
          <div key={key} className="flex items-center justify-between gap-6 border-b border-border py-2.5 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
                {entry.name} <span className="text-xs text-muted-foreground">{entry.version} · {entry.repoName}</span>
                {previews[`${entry.repo}/${entry.id}`] && <ThemeSwatches theme={previews[`${entry.repo}/${entry.id}`]!} dark={apply?.dark ?? false} />}
              </span>
              {entry.description && <span className="text-xs text-muted-foreground">{entry.description}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {ours && removing === entry.id ? (
                <>
                  <span className="text-xs text-muted-foreground">{t("plugins.themes.deletesFile")}</span>
                  <ActionButton onClick={() => setRemoving(null)}>{t("common.cancel")}</ActionButton>
                  <ActionButton aria-label={t("plugins.themes.deleteAria", { name: entry.name })} className="text-destructive" onClick={() => void remove(entry.id)}>{t("common.delete")}</ActionButton>
                </>
              ) : (
                <>
                  {ours && <ActionButton aria-label={t("plugins.themes.removeAria", { name: entry.name })} onClick={() => setRemoving(entry.id)}>{t("plugins.repos.remove")}</ActionButton>}
                  {ours && apply && installed && (
                    <ActionButton
                      aria-label={t("plugins.themes.applyAria", { name: entry.name })}
                      disabled={apply.scheme === entry.id || !installed[apply.dark ? "dark" : "light"]}
                      title={!installed[apply.dark ? "dark" : "light"] ? t(apply.dark ? "plugins.themes.noDark" : "plugins.themes.noLight") : undefined}
                      onClick={() => apply.onScheme(entry.id)}
                    >
                      {apply.scheme === entry.id ? t("plugins.themes.inUse") : t("plugins.themes.apply")}
                    </ActionButton>
                  )}
                  <ActionButton
                    aria-label={t(labelAria, { name: entry.name })}
                    title={!installed || ours ? undefined : t("plugins.themes.idInUseHint")}
                    disabled={busy.has(key) || (Boolean(installed) && !update)}
                    onClick={() => void install(entry)}
                  >
                    {t(label)}
                  </ActionButton>
                </>
              )}
            </span>
          </div>
        );
      })}
      {problem && <p role="alert" className="py-2 text-xs text-destructive">{problem}</p>}
    </div>
  );
}
