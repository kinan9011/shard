import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Ellipsis, FolderOpen, Lock, Puzzle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BuiltInToolSwitches } from "@/components/app/BuiltInToolSwitches";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { t, useT } from "@/i18n";
import { isMobileApp } from "@/lib/platform";
import { ConfirmUninstall } from "./ConfirmUninstall";
import { AnchoredPanel } from "@/components/tools/diff-merge/Panels";
import { Switch } from "@/components/ui/switch";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { setToolHidden, useHiddenTools } from "@/app/useToolCatalog";
import { revealPluginFolder, setPluginEnabled, setPluginGrants, uninstallPlugin, type InstalledPlugin, type PluginUpdate, type Repo } from "@/plugins/api";
import { listNames, sourceLabel } from "@/plugins/format";
import { updateJob, type InstallJob } from "@/plugins/useInstallFlow";
import type { CatalogRow } from "@/plugins/usePluginCatalog";
import { refreshPlugins } from "@/plugins/usePlugins";
import { cn } from "@/lib/utils";
import { PermissionDialog } from "./PermissionDialog";
import { RuntimeBadge } from "./RuntimeBadge";

/** "Compose Validator asks for one new permission." for the updates that add permissions; empty when none does. */
function newPermissionSentence(added: readonly { name: string; count: number }[]): string {
  if (added.length === 0) return "";
  const [only] = added;
  if (added.length === 1 && only) return t("plugins.installed.newPermission", { name: only.name, count: only.count });
  return t("plugins.installed.newPermissions", { names: listNames(added.map((item) => item.name)) });
}

const asMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

const BUTTON = "inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border px-3 text-sm font-medium disabled:opacity-60";
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_90px_170px_110px_70px_30px] items-center px-3.5";
const TILE = "grid shrink-0 place-items-center bg-accent text-primary";

function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">{children}</span>;
}

const updatingLabel = (percent: number | null | undefined) => (typeof percent === "number" ? t("plugins.installed.updatingPercent", { percent }) : t("plugins.installed.updating"));

interface InstalledTabProps {
  plugins: readonly InstalledPlugin[];
  /** The repository catalog: the listing of the new version has the permissions it asks for. */
  rows: readonly CatalogRow[];
  repos: readonly Repo[];
  updates: readonly PluginUpdate[];
  /** Starts an update through the install flow (the permission dialog when it adds permissions). */
  onRequest: (job: InstallJob) => void;
  /** The percent of every install or update in progress (the install flow's). */
  progress: Readonly<Record<string, number | null>>;
  /** Reads the catalog again, so the update list follows an uninstall. */
  refresh: () => Promise<void> | void;
  /** "cards" is the Launcher layout (screen 04 B): a banner, cards and chips instead of the list and the table. */
  variant?: "list" | "cards";
}

interface MenuState {
  plugin: InstalledPlugin;
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

function BuiltIns() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const core = useMemo(() => ALL_TOOLS.filter((tool) => tool.kind === "core"), []);
  const first = core.slice(0, 3).map((tool) => tool.name);
  const more = core.length - first.length;
  return (
    <div className="flex flex-col rounded-lg bg-secondary">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Lock size={15} aria-hidden="true" className="shrink-0 text-muted-foreground rtl:-scale-x-100" />
        <span className="flex-1">
          <span className="font-medium text-foreground">{t("plugins.installed.builtInCount", { count: core.length })}</span>{" "}
          <span className="text-muted-foreground">
            {more > 0
              ? t("plugins.installed.builtInSummaryMore", { names: first.join(", "), more })
              : t("plugins.installed.builtInSummary", { names: first.join(", ") })}
          </span>
        </span>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn(BUTTON, "border-transparent text-muted-foreground")}>
          {open ? t("plugins.installed.hide") : t("plugins.installed.show")}
        </button>
      </div>
      {open && <BuiltInToolSwitches />}
    </div>
  );
}

/** Screen 04 B: the built-in tools as chips. A chip toggles the tool's visibility (hidden, never uninstalled). */
function BuiltInChips() {
  const t = useT();
  const hidden = useHiddenTools();
  const core = useMemo(() => ALL_TOOLS.filter((tool) => tool.kind === "core"), []);
  return (
    <section aria-label={t("plugins.installed.builtInTools")} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <SectionTitle>{t("plugins.installed.builtInTitle", { count: core.length })}</SectionTitle>
        <span className="text-xs text-muted-foreground">{t("plugins.installed.builtInHint")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {core.map((tool) => {
          const shown = !hidden.has(tool.id);
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={shown}
              title={t(shown ? "plugins.installed.hideTool" : "plugins.installed.showTool", { name: tool.name })}
              onClick={() => setToolHidden(tool.id, shown)}
              className={cn("inline-flex h-[38px] items-center gap-[9px] whitespace-nowrap rounded-lg border border-border bg-secondary ps-[5px] pe-3.5 text-foreground", !shown && "opacity-50")}
            >
              <span className={cn(TILE, "size-7 rounded-[7px]")}>
                <tool.icon size={14} aria-hidden="true" />
              </span>
              {tool.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Screen 04 A: updates, the installed plugins, and the built-in tools. */
export function InstalledTab({ plugins, rows, repos, updates, onRequest, progress, refresh, variant = "list" }: InstalledTabProps) {
  const t = useT();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [managing, setManaging] = useState<InstalledPlugin | null>(null);
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useMemo(() => ({ current: menu?.anchor ?? null }), [menu]);

  const pairs = useMemo(
    () =>
      updates.flatMap((update) => {
        const plugin = plugins.find((item) => item.id === update.id);
        return plugin ? [{ update, plugin, listed: rows.find((row) => row.entry.id === update.id && row.entry.repo === update.repo) }] : [];
      }),
    [updates, plugins, rows],
  );

  const startUpdate = ({ update, plugin, listed }: (typeof pairs)[number]) => onRequest(updateJob(update, plugin, listed));

  const run = async (id: string, work: () => Promise<unknown>, failure: string) => {
    setBusy((current) => new Set(current).add(id));
    try {
      await work();
    } catch (error) {
      toast.error(failure, { description: asMessage(error) });
    } finally {
      setBusy((current) => new Set([...current].filter((item) => item !== id)));
    }
  };

  const toggleEnabled = (plugin: InstalledPlugin, enabled: boolean) =>
    run(plugin.id, async () => {
      await setPluginEnabled(plugin.id, enabled);
      await refreshPlugins();
    }, t(enabled ? "plugins.installed.enableFailed" : "plugins.installed.disableFailed", { name: plugin.manifest.name }));

  const uninstall = (plugin: InstalledPlugin) => {
    setRemoving(null);
    void run(plugin.id, async () => {
      await uninstallPlugin(plugin.id);
      toast.success(t("plugins.page.uninstalled"), { description: plugin.manifest.name });
      await Promise.allSettled([refreshPlugins(), refresh()]);
    }, t("plugins.page.uninstallFailed", { name: plugin.manifest.name }));
  };

  const saveGrants = (plugin: InstalledPlugin, grants: string[]) => {
    setManaging(null);
    void run(plugin.id, async () => {
      await setPluginGrants(plugin.id, grants);
      await refreshPlugins();
      toast.success(t("plugins.installed.permissionsSaved"), { description: plugin.manifest.name });
    }, t("plugins.installed.permissionsFailed", { name: plugin.manifest.name }));
  };

  const openMenu = (plugin: InstalledPlugin, anchor: HTMLElement) => {
    if (menu?.plugin.id === plugin.id) return setMenu(null);
    setMenu({ plugin, anchor });
  };

  const cards = variant === "cards";
  const grid = useRef<HTMLDivElement>(null);
  const review = () => {
    const first = grid.current?.querySelector<HTMLElement>("[data-update]:not(:disabled)");
    first?.scrollIntoView?.({ block: "nearest" });
    first?.focus();
  };

  const menuButton = (plugin: InstalledPlugin) => (
    <button
      type="button"
      aria-label={t("plugins.installed.actionsFor", { name: plugin.manifest.name })}
      aria-haspopup="menu"
      aria-expanded={menu?.plugin.id === plugin.id}
      onClick={(event) => openMenu(plugin, event.currentTarget)}
      className="grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-secondary"
    >
      <Ellipsis size={16} aria-hidden="true" />
    </button>
  );

  const banner = pairs.length > 0 && (
    <section aria-label={t("plugins.installed.updatesAvailable")} className="flex items-center gap-3.5 rounded-[10px] bg-primary/[.14] px-4 py-3">
      <RefreshCw size={16} aria-hidden="true" className="shrink-0 text-primary" />
      <span className="flex-1">
        <span className="font-semibold text-foreground">{t("plugins.installed.updatesReady", { count: pairs.length })}</span>{" "}
        {listNames(pairs.map(({ update }) => `${update.name} ${update.to}`))}.{" "}
        {newPermissionSentence(pairs.filter(({ update }) => update.newPermissions.length > 0).map(({ update }) => ({ name: update.name, count: update.newPermissions.length })))}
      </span>
      <button type="button" onClick={review} className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}>
        {t("plugins.installed.review")}
      </button>
      <button type="button" onClick={() => pairs.forEach(startUpdate)} className={cn(BUTTON, "border-primary-solid bg-primary-solid text-primary-solid-foreground")}>
        {t("plugins.installed.updateAll")}
      </button>
    </section>
  );

  const pluginCards = (
    <section aria-label={t("plugins.installed.installedPlugins")} className="flex flex-col gap-2.5">
      <SectionTitle>{t("plugins.installed.pluginsTitle", { count: plugins.length })}</SectionTitle>
      {plugins.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t("plugins.installed.none")}</p>
      ) : (
        <div ref={grid} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plugins.map((plugin) => {
            const pair = pairs.find((item) => item.plugin.id === plugin.id);
            const updating = !!pair && pair.update.id in progress;
            return (
              <div key={plugin.id} data-plugin-card className={cn("flex flex-col gap-3 rounded-[10px] border border-border bg-secondary p-3.5", !plugin.enabled && "opacity-60")}>
                <div className="flex items-start justify-between">
                  <span className={cn(TILE, "size-10 rounded-[10px]")}>
                    <Puzzle size={20} aria-hidden="true" />
                  </span>
                  <Switch
                    aria-label={t("plugins.installed.enabledAria", { name: plugin.manifest.name })}
                    checked={plugin.enabled}
                    disabled={busy.has(plugin.id)}
                    onCheckedChange={(enabled) => void toggleEnabled(plugin, enabled)}
                    className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5 rtl:[&>span]:data-[state=checked]:-translate-x-3.5"
                  />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-foreground">{plugin.manifest.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{`${sourceLabel(plugin, repos)} · v${plugin.version}`}</span>
                </div>
                <div className="flex items-center justify-between">
                  {pair ? (
                    <button
                      type="button"
                      data-update
                      disabled={updating}
                      aria-label={t("plugins.installed.updateAria", { name: plugin.manifest.name })}
                      onClick={() => startUpdate(pair)}
                      className="inline-flex h-5 items-center rounded-[5px] bg-primary/15 px-[7px] text-2xs font-medium text-primary disabled:opacity-60"
                    >
                      {updating ? updatingLabel(progress[pair.update.id]) : t("plugins.installed.updateTo", { version: pair.update.to })}
                    </button>
                  ) : (
                    <RuntimeBadge runtime={plugin.manifest.runtime} />
                  )}
                  {menuButton(plugin)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className={cn("relative flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-[18px] sm:px-7", cards ? "gap-5" : "gap-[22px]")}>
      {cards && banner}
      {cards && pluginCards}
      {cards && <BuiltInChips />}
      {!cards && pairs.length > 0 && (
        <section aria-label={t("plugins.installed.updatesAvailable")} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionTitle>{t("plugins.installed.updatesTitle", { count: pairs.length })}</SectionTitle>
            <button type="button" onClick={() => pairs.forEach(startUpdate)} className={cn(BUTTON, "border-primary-solid bg-primary-solid text-primary-solid-foreground")}>
              <RefreshCw size={14} aria-hidden="true" />
              {t("plugins.installed.updateAll")}
            </button>
          </div>
          <ul className="rounded-lg border border-border">
            {pairs.map((pair) => {
              const { update, plugin } = pair;
              const updating = update.id in progress;
              return (
                <li key={update.id} className="flex items-center gap-3.5 border-t border-border px-3.5 py-3 first:border-t-0">
                  <span className={cn(TILE, "size-8 rounded-lg")}>
                    <Puzzle size={16} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{update.name}</span>
                      <span className="text-muted-foreground">{update.from}</span>
                      <ArrowRight size={12} aria-label={t("plugins.installed.to")} className="shrink-0 text-muted-foreground" />
                      <span className="font-medium text-primary">{update.to}</span>
                    </span>
                    {update.changelog && <span className="truncate text-xs text-muted-foreground">{update.changelog}</span>}
                  </div>
                  {update.newPermissions.length > 0 && (
                    <span className="inline-flex h-5 items-center rounded-[5px] bg-warning/15 px-[7px] text-2xs font-medium text-warning">{t("plugins.installed.newPermissionTag")}</span>
                  )}
                  <button
                    type="button"
                    disabled={updating}
                    aria-label={t("plugins.installed.updateAria", { name: plugin.manifest.name })}
                    onClick={() => startUpdate(pair)}
                    className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}
                  >
                    {updating ? updatingLabel(progress[update.id]) : t("plugins.installed.update")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!cards && <section aria-label={t("plugins.installed.installedPlugins")} className="flex flex-col gap-2">
        <SectionTitle>{t("plugins.installed.installedTitle", { count: plugins.length })}</SectionTitle>
        {plugins.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("plugins.installed.none")}</p>
        ) : (
          <div role="table" aria-label={t("plugins.installed.installedPlugins")} className="flex flex-col">
            <div role="row" className={cn(COLUMNS, "h-[30px] border-b border-border text-xs text-muted-foreground")}>
              <span role="columnheader">{t("plugins.installed.colName")}</span>
              <span role="columnheader">{t("plugins.installed.colVersion")}</span>
              <span role="columnheader">{t("plugins.installed.colSource")}</span>
              <span role="columnheader">{t("plugins.installed.colRuntime")}</span>
              <span role="columnheader">{t("plugins.installed.colEnabled")}</span>
              <span role="columnheader" aria-label={t("plugins.installed.colActions")} />
            </div>
            {plugins.map((plugin) => (
              <div key={plugin.id} role="row" className={cn(COLUMNS, "h-12 border-b border-border", !plugin.enabled && "opacity-60")}>
                <span role="cell" className="flex min-w-0 items-center gap-3">
                  <span className={cn(TILE, "size-7 rounded-[7px]")}>
                    <Puzzle size={14} aria-hidden="true" />
                  </span>
                  <span className="truncate font-medium text-foreground">{plugin.manifest.name}</span>
                </span>
                <span role="cell" className="tabular-nums text-foreground">
                  {plugin.version}
                </span>
                <span role="cell" className="truncate text-muted-foreground">
                  {sourceLabel(plugin, repos)}
                </span>
                <span role="cell">
                  <RuntimeBadge runtime={plugin.manifest.runtime} />
                </span>
                <span role="cell">
                  <Switch
                    aria-label={t("plugins.installed.enabledAria", { name: plugin.manifest.name })}
                    checked={plugin.enabled}
                    disabled={busy.has(plugin.id)}
                    onCheckedChange={(enabled) => void toggleEnabled(plugin, enabled)}
                    className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5 rtl:[&>span]:data-[state=checked]:-translate-x-3.5"
                  />
                </span>
                <span role="cell" className="flex">
                  <button
                    type="button"
                    aria-label={t("plugins.installed.actionsFor", { name: plugin.manifest.name })}
                    aria-haspopup="menu"
                    aria-expanded={menu?.plugin.id === plugin.id}
                    onClick={(event) => openMenu(plugin, event.currentTarget)}
                    className="grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-secondary"
                  >
                    <Ellipsis size={16} aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>}

      {!cards && <BuiltIns />}

      <AnchoredPanel open={!!menu} onClose={() => setMenu(null)} anchorRef={anchorRef} width={188} align="end" role="menu">
        {menu && (
          <div className="p-1">
            <MenuItem
              icon={<ShieldCheck size={14} aria-hidden="true" />}
              onClick={() => {
                setManaging(menu.plugin);
                setMenu(null);
              }}
            >
              {t("plugins.installed.menuPermissions")}
            </MenuItem>
            {!isMobileApp() && (
              <MenuItem
                icon={<FolderOpen size={14} aria-hidden="true" />}
                onClick={() => {
                  const { plugin } = menu;
                  setMenu(null);
                  void revealPluginFolder(plugin.id).catch((error) => toast.error(t("plugins.installed.openFolderFailed"), { description: asMessage(error) }));
                }}
              >
                {t("plugins.installed.showInFolder")}
              </MenuItem>
            )}
            <div className="-mx-1 my-1 h-px bg-border" />
            <MenuItem
              destructive
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => {
                setRemoving(menu.plugin);
                setMenu(null);
              }}
            >
              {t("plugins.uninstall.confirm")}
            </MenuItem>
          </div>
        )}
      </AnchoredPanel>

      {managing && (
        <PermissionDialog
          mode="manage"
          granted={managing.granted}
          entry={{ name: managing.manifest.name, version: managing.version, runtime: managing.manifest.runtime, permissions: managing.manifest.permissions, repo: sourceLabel(managing, repos) }}
          official={!!managing.source.repo && repos.some((item) => item.url === managing.source.repo && item.official)}
          verified={managing.verified}
          onCancel={() => setManaging(null)}
          onConfirm={(grants) => saveGrants(managing, grants)}
        />
      )}
      {removing && <ConfirmUninstall plugin={removing} onCancel={() => setRemoving(null)} onConfirm={() => uninstall(removing)} />}
    </div>
  );
}
