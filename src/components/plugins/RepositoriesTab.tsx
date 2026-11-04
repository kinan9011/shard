import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Ellipsis, GitBranch, Lock, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { t, useT } from "@/i18n";
import { AnchoredPanel } from "@/components/tools/diff-merge/Panels";
import { Switch } from "@/components/ui/switch";
import { themeCatalog } from "@/lib/desktop";
import { addRepo, removeRepo, repoSettings, setRepoEnabled, setRepoSettings, syncRepos, type Repo, type RepoSettings } from "@/plugins/api";
import { repoAddress, syncedAgo } from "@/plugins/format";
import type { CatalogRow } from "@/plugins/usePluginCatalog";
import { cn } from "@/lib/utils";

const asMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

const COLUMNS = "grid grid-cols-[minmax(0,1fr)_140px_100px_190px_50px_64px] items-center px-3.5";
const BADGE = "inline-flex h-5 items-center rounded-[5px] border px-[7px] text-2xs font-medium whitespace-nowrap";
const SWITCH = "h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5 rtl:[&>span]:data-[state=checked]:-translate-x-3.5";
const CARD_BUTTON = "inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-60";
const ICON_BUTTON = "grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-60";

const TYPE_LABEL = { index: "index.json", releases: "GitHub Releases" } as const;

interface RepositoriesTabProps {
  repos: readonly Repo[];
  /** The catalog: how many plugins each repository lists. */
  rows: readonly CatalogRow[];
  /** Reads the repositories and the catalog again. */
  refresh: () => Promise<void> | void;
  /** "cards" is the Launcher layout (screen 05 B): one card per repository instead of the table. */
  variant?: "list" | "cards";
}

interface MenuState {
  repo: Repo;
  anchor: HTMLElement;
}

function MenuItem({ icon, children, destructive, onClick }: { icon: ReactNode; children: string; destructive?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-start hover:bg-accent focus:bg-accent focus:outline-none", destructive && "text-destructive")}
    >
      <span className={cn("flex w-[14px] justify-center", !destructive && "text-muted-foreground")}>{icon}</span>
      {children}
    </button>
  );
}

function Status({ repo }: { repo: Repo }) {
  const t = useT();
  if (repo.lastError) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-destructive" title={repo.lastError}>
        <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{repo.lastError}</span>
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{repo.lastSync != null ? syncedAgo(repo.lastSync) : t("plugins.repos.notSynced")}</span>;
}

/** Screen 05 A: the repositories, with add, sync, on/off and remove, and the two switches of `repos.json`. */
export function RepositoriesTab({ repos, rows, refresh, variant = "list" }: RepositoriesTabProps) {
  const t = useT();
  const cards = variant === "cards";
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [settings, setSettings] = useState<RepoSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const anchorRef = useMemo(() => ({ current: menu?.anchor ?? null }), [menu]);

  useEffect(() => {
    let current = true;
    repoSettings().then(
      (loaded) => current && setSettings(loaded),
      (error) => current && toast.error(t("plugins.repos.readSettingsFailed"), { description: asMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [t]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const { entry } of rows) out.set(entry.repo, (out.get(entry.repo) ?? 0) + 1);
    return out;
  }, [rows]);

  // The themes a repository lists. The catalog above is the plugins only.
  const [themeCounts, setThemeCounts] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(themeCatalog)
      .then(
        (themes) => {
          const out = new Map<string, number>();
          for (const theme of themes) out.set(theme.repo, (out.get(theme.repo) ?? 0) + 1);
          if (current) setThemeCounts(out);
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, [repos]);

  /** "3 plugins", "6 themes" or both. Null while the repository is off or not synced yet. */
  const countLabel = (repo: Repo): string | null => {
    if (!repo.enabled || repo.lastSync == null) return null;
    const plugins = counts.get(repo.url) ?? 0;
    const themes = themeCounts.get(repo.url) ?? 0;
    const parts = [];
    if (plugins > 0 || themes === 0) parts.push(t("plugins.repos.pluginCount", { count: plugins }));
    if (themes > 0) parts.push(t("plugins.repos.themeCount", { count: themes }));
    return parts.join(", ");
  };

  const run = async (key: string, work: () => Promise<unknown>, failure: string) => {
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    try {
      await work();
    } catch (error) {
      toast.error(failure, { description: asMessage(error) });
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== key)));
    }
  };

  const add = async () => {
    const value = url.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      const added = await addRepo(value);
      toast.success(t("plugins.repos.added"), { description: added.name });
      setUrl("");
      await refresh();
    } catch (error) {
      toast.error(t("plugins.repos.addFailed"), { description: asMessage(error) });
    } finally {
      setAdding(false);
    }
  };

  const sync = (repo: Repo) =>
    run(repo.url, async () => {
      const after = (await syncRepos(repo.url)).find((item) => item.url === repo.url);
      await refresh();
      if (after?.lastError) toast.error(t("plugins.repos.syncFailed", { name: repo.name }), { description: after.lastError });
    }, t("plugins.repos.syncFailed", { name: repo.name }));

  const toggle = (repo: Repo, enabled: boolean) =>
    run(repo.url, async () => {
      await setRepoEnabled(repo.url, enabled);
      await refresh();
    }, t(enabled ? "plugins.repos.turnOnFailed" : "plugins.repos.turnOffFailed", { name: repo.name }));

  const remove = (repo: Repo) =>
    run(repo.url, async () => {
      await removeRepo(repo.url);
      toast.success(t("plugins.repos.removed"), { description: repo.name });
      await refresh();
    }, t("plugins.repos.removeFailed", { name: repo.name }));

  const save = async (patch: Partial<RepoSettings>) => {
    if (!settings || saving) return;
    const before = settings;
    setSaving(true);
    setSettings({ ...before, ...patch });
    try {
      setSettings(await setRepoSettings(patch));
    } catch (error) {
      setSettings(before);
      toast.error(t("plugins.repos.saveFailed"), { description: asMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const openMenu = (repo: Repo, anchor: HTMLElement) => {
    if (menu?.repo.url === repo.url) return setMenu(null);
    setMenu({ repo, anchor });
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-7">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <label className="flex h-[34px] w-full min-w-0 sm:w-[480px] sm:shrink-0 items-center gap-[9px] rounded-[7px] border border-input bg-background ps-[11px] pe-2 text-muted-foreground focus-within:border-ring">
            <GitBranch size={15} aria-hidden="true" className="shrink-0" />
            <input
              type="text"
              aria-label={t("plugins.installDialog.urlLabel")}
              placeholder="https://github.com/owner/repo"
              value={url}
              disabled={adding}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button
            type="button"
            disabled={!url.trim() || adding}
            onClick={() => void add()}
            className="inline-flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-md border border-primary-solid bg-primary-solid px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed"
          >
            <Plus size={14} aria-hidden="true" />
            {t("plugins.repos.add")}
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("plugins.repos.hint")}
        </span>
      </div>

      {cards ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {repos.map((repo) => {
            const working = busy.has(repo.url);
            const label = countLabel(repo);
            return (
              <div key={repo.url} data-repo-card className={cn("flex flex-col gap-3 rounded-[10px] border bg-secondary p-4", repo.lastError ? "border-destructive/40" : "border-border")}>
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                    <GitBranch size={17} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground">{repo.name}</span>
                      {repo.official && <span className={cn(BADGE, "border-transparent bg-primary/15 text-primary")}>{t("plugins.repos.official")}</span>}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{repoAddress(repo.url)}</span>
                  </div>
                  <Switch aria-label={t("plugins.installed.enabledAria", { name: repo.name })} checked={repo.enabled} disabled={working} onCheckedChange={(enabled) => void toggle(repo, enabled)} className={SWITCH} />
                </div>
                <div className="flex items-center gap-2.5 text-xs">
                  {repo.type && <span className={cn(BADGE, "border-input bg-background text-muted-foreground")}>{TYPE_LABEL[repo.type]}</span>}
                  {label !== null && <span className="text-foreground">{label}</span>}
                  <span className="ms-auto flex min-w-0">
                    <Status repo={repo} />
                  </span>
                </div>
                <div className="flex gap-1.5 border-t border-border pt-2.5">
                  <button type="button" disabled={working} onClick={() => void sync(repo)} className={CARD_BUTTON}>
                    <RefreshCw size={14} aria-hidden="true" className={cn(working && "animate-spin")} />
                    {repo.lastError ? t("plugins.repos.retry") : t("plugins.repos.syncNow")}
                  </button>
                  {repo.official ? (
                    <span className="ms-auto self-center text-xs text-muted-foreground">{t("plugins.repos.officialHint")}</span>
                  ) : (
                    <button type="button" disabled={working} onClick={() => void remove(repo)} className={CARD_BUTTON}>
                      {t("plugins.repos.remove")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div role="table" aria-label={t("plugins.repos.title")} className="flex flex-col">
        <div role="row" className={cn(COLUMNS, "h-[30px] border-b border-border text-xs text-muted-foreground")}>
          <span role="columnheader">{t("plugins.repos.colRepository")}</span>
          <span role="columnheader">{t("plugins.repos.colType")}</span>
          <span role="columnheader">{t("plugins.repos.colPlugins")}</span>
          <span role="columnheader">{t("plugins.repos.colStatus")}</span>
          <span role="columnheader">{t("plugins.repos.colOn")}</span>
          <span role="columnheader" aria-label={t("plugins.installed.colActions")} />
        </div>
        {repos.map((repo) => {
          const working = busy.has(repo.url);
          const label = countLabel(repo);
          return (
            <div key={repo.url} role="row" className={cn(COLUMNS, "min-h-14 border-b border-border")}>
              <span role="cell" className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{repo.name}</span>
                  {repo.official && <span className={cn(BADGE, "border-transparent bg-primary/15 text-primary")}>{t("plugins.repos.official")}</span>}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">{repoAddress(repo.url)}</span>
              </span>
              <span role="cell">
                {repo.type ? <span className={cn(BADGE, "border-input bg-secondary text-muted-foreground")}>{TYPE_LABEL[repo.type]}</span> : <span className="text-muted-foreground">–</span>}
              </span>
              <span role="cell" className={label === null ? "text-muted-foreground" : "text-foreground"}>
                {label ?? "–"}
              </span>
              <span role="cell" className="flex min-w-0 pe-2">
                <Status repo={repo} />
              </span>
              <span role="cell">
                <Switch aria-label={t("plugins.installed.enabledAria", { name: repo.name })} checked={repo.enabled} disabled={working} onCheckedChange={(enabled) => void toggle(repo, enabled)} className={SWITCH} />
              </span>
              <span role="cell" className="flex gap-0.5">
                <button type="button" aria-label={t("plugins.repos.syncAria", { name: repo.name })} disabled={working} onClick={() => void sync(repo)} className={ICON_BUTTON}>
                  <RefreshCw size={16} aria-hidden="true" className={cn(working && "animate-spin")} />
                </button>
                {repo.official ? (
                  <span role="img" aria-label={t("plugins.repos.officialLocked")} title={t("plugins.repos.officialLocked")} className="grid w-[30px] place-items-center text-muted-foreground">
                    <Lock size={14} aria-hidden="true" />
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={t("plugins.installed.actionsFor", { name: repo.name })}
                    aria-haspopup="menu"
                    aria-expanded={menu?.repo.url === repo.url}
                    disabled={working}
                    onClick={(event) => openMenu(repo, event.currentTarget)}
                    className={ICON_BUTTON}
                  >
                    <Ellipsis size={16} aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      )}

      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 pt-1">
        <span className="flex items-center gap-2.5">
          <span className="text-muted-foreground">{t("plugins.repos.checkForUpdates")}</span>
          <span className="relative inline-flex">
            <select
              aria-label={t("plugins.repos.checkForUpdates")}
              value={settings?.checkOnStart === false ? "manual" : "start"}
              disabled={!settings || saving}
              onChange={(event) => void save({ checkOnStart: event.target.value === "start" })}
              className="h-[30px] appearance-none rounded-md border border-input bg-background ps-[11px] pe-8 text-sm text-foreground disabled:opacity-60"
            >
              <option value="start">{t("plugins.repos.whenStarts")}</option>
              <option value="manual">{t("plugins.repos.manually")}</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </span>
        </span>
        <label className="flex items-center gap-2.5">
          <Switch
            checked={settings?.allowOutside ?? false}
            disabled={!settings || saving}
            onCheckedChange={(allowOutside) => void save({ allowOutside })}
            className={SWITCH}
          />
          {cards ? t("plugins.repos.allowOutsideShort") : t("plugins.repos.allowOutside")}
        </label>
      </div>

      <AnchoredPanel open={!!menu} onClose={() => setMenu(null)} anchorRef={anchorRef} width={168} align="end" role="menu">
        {menu && (
          <div className="p-1">
            <MenuItem
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={() => {
                const { repo } = menu;
                setMenu(null);
                void sync(repo);
              }}
            >
              {menu.repo.lastError ? t("plugins.repos.retry") : t("plugins.repos.syncNow")}
            </MenuItem>
            <div className="-mx-1 my-1 h-px bg-border" />
            <MenuItem
              destructive
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => {
                const { repo } = menu;
                setMenu(null);
                void remove(repo);
              }}
            >
              {t("plugins.repos.remove")}
            </MenuItem>
          </div>
        )}
      </AnchoredPanel>
    </div>
  );
}
