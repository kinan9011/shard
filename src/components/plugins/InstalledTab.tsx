import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Ellipsis, FolderOpen, Lock, Puzzle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDialogFocus } from "@/components/app/useDialogFocus";
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
  if (added.length === 1 && only) return `${only.name} asks for ${only.count === 1 ? "one new permission" : `${only.count} new permissions`}.`;
  return `${listNames(added.map((item) => item.name))} ask for new permissions.`;
}

const asMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

const BUTTON = "inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border px-3 text-sm font-medium disabled:opacity-60";
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_90px_170px_110px_70px_30px] items-center px-3.5";
const TILE = "grid shrink-0 place-items-center bg-accent text-primary";

function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">{children}</span>;
}

const updatingLabel = (percent: number | null | undefined) => (typeof percent === "number" ? `Updating… ${percent}%` : "Updating…");

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
  /** Pixels from the top of the scrolling body. */
  top: number;
}

function ConfirmUninstall({ plugin, onCancel, onConfirm }: { plugin: InstalledPlugin; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogFocus(true, onCancel);
  const title = `Uninstall ${plugin.manifest.name}?`;
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[75] grid place-items-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={ref} role="alertdialog" aria-modal="true" aria-label={title} className="modal-surface flex w-[400px] max-w-full flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">Its files and the data it stored are removed.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onCancel} className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={cn(BUTTON, "border-destructive bg-destructive text-destructive-foreground")}>
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon, children, destructive, onClick }: { icon: ReactNode; children: string; destructive?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left hover:bg-accent focus:bg-accent focus:outline-none", destructive && "text-destructive")}
    >
      <span className={cn("flex w-[14px] justify-center", !destructive && "text-muted-foreground")}>{icon}</span>
      {children}
    </button>
  );
}

function BuiltIns() {
  const hidden = useHiddenTools();
  const [open, setOpen] = useState(false);
  const core = useMemo(() => ALL_TOOLS.filter((tool) => tool.kind === "core"), []);
  const first = core.slice(0, 3).map((tool) => tool.name);
  const more = core.length - first.length;
  return (
    <div className="flex flex-col rounded-lg bg-secondary">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Lock size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="flex-1">
          <span className="font-medium text-foreground">{core.length} built-in tools</span>{" "}
          <span className="text-muted-foreground">
            · {first.join(", ")}
            {more > 0 ? ` and ${more} more` : ""}. Built in, so they can be hidden but not uninstalled.
          </span>
        </span>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn(BUTTON, "border-transparent text-muted-foreground")}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <ul aria-label="Built-in tools" className="flex flex-col border-t border-border">
          {core.map((tool) => (
            <li key={tool.id} className="flex h-10 items-center gap-3 border-b border-border px-3.5 last:border-b-0">
              <tool.icon size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium text-foreground">{tool.name}</span>
              <span className="text-xs text-muted-foreground">{tool.category}</span>
              <Switch
                aria-label={`Show ${tool.name}`}
                checked={!hidden.has(tool.id)}
                onCheckedChange={(shown) => setToolHidden(tool.id, !shown)}
                className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Screen 04 B: the built-in tools as chips. A chip toggles the tool's visibility (hidden, never uninstalled). */
function BuiltInChips() {
  const hidden = useHiddenTools();
  const core = useMemo(() => ALL_TOOLS.filter((tool) => tool.kind === "core"), []);
  return (
    <section aria-label="Built-in tools" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <SectionTitle>{`Built-in · ${core.length}`}</SectionTitle>
        <span className="text-xs text-muted-foreground">Can be hidden, not uninstalled</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {core.map((tool) => {
          const shown = !hidden.has(tool.id);
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={shown}
              title={`${shown ? "Hide" : "Show"} ${tool.name}`}
              onClick={() => setToolHidden(tool.id, shown)}
              className={cn("inline-flex h-[38px] items-center gap-[9px] whitespace-nowrap rounded-lg border border-border bg-secondary pl-[5px] pr-3.5 text-foreground", !shown && "opacity-50")}
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
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [managing, setManaging] = useState<InstalledPlugin | null>(null);
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const body = useRef<HTMLDivElement>(null);
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
    }, `Couldn't ${enabled ? "enable" : "disable"} ${plugin.manifest.name}`);

  const uninstall = (plugin: InstalledPlugin) => {
    setRemoving(null);
    void run(plugin.id, async () => {
      await uninstallPlugin(plugin.id);
      toast.success("Uninstalled", { description: plugin.manifest.name });
      await Promise.allSettled([refreshPlugins(), refresh()]);
    }, `Couldn't uninstall ${plugin.manifest.name}`);
  };

  const saveGrants = (plugin: InstalledPlugin, grants: string[]) => {
    setManaging(null);
    void run(plugin.id, async () => {
      await setPluginGrants(plugin.id, grants);
      await refreshPlugins();
      toast.success("Permissions saved", { description: plugin.manifest.name });
    }, `Couldn't save the permissions of ${plugin.manifest.name}`);
  };

  const openMenu = (plugin: InstalledPlugin, anchor: HTMLElement) => {
    if (menu?.plugin.id === plugin.id) return setMenu(null);
    const box = body.current;
    const top = box ? anchor.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop + 4 : 40;
    setMenu({ plugin, anchor, top });
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
      aria-label={`Actions for ${plugin.manifest.name}`}
      aria-haspopup="menu"
      aria-expanded={menu?.plugin.id === plugin.id}
      onClick={(event) => openMenu(plugin, event.currentTarget)}
      className="grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-secondary"
    >
      <Ellipsis size={16} aria-hidden="true" />
    </button>
  );

  const banner = pairs.length > 0 && (
    <section aria-label="Updates available" className="flex items-center gap-3.5 rounded-[10px] bg-primary/[.14] px-4 py-3">
      <RefreshCw size={16} aria-hidden="true" className="shrink-0 text-primary" />
      <span className="flex-1">
        <span className="font-semibold text-foreground">{`${pairs.length} ${pairs.length === 1 ? "update" : "updates"} ready.`}</span>{" "}
        {listNames(pairs.map(({ update }) => `${update.name} ${update.to}`))}.{" "}
        {newPermissionSentence(pairs.filter(({ update }) => update.newPermissions.length > 0).map(({ update }) => ({ name: update.name, count: update.newPermissions.length })))}
      </span>
      <button type="button" onClick={review} className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}>
        Review
      </button>
      <button type="button" onClick={() => pairs.forEach(startUpdate)} className={cn(BUTTON, "border-primary bg-primary text-primary-foreground")}>
        Update all
      </button>
    </section>
  );

  const pluginCards = (
    <section aria-label="Installed plugins" className="flex flex-col gap-2.5">
      <SectionTitle>{`Plugins · ${plugins.length}`}</SectionTitle>
      {plugins.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No plugins installed yet.</p>
      ) : (
        <div ref={grid} className="grid grid-cols-4 gap-3">
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
                    aria-label={`Enabled: ${plugin.manifest.name}`}
                    checked={plugin.enabled}
                    disabled={busy.has(plugin.id)}
                    onCheckedChange={(enabled) => void toggleEnabled(plugin, enabled)}
                    className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5"
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
                      aria-label={`Update ${plugin.manifest.name}`}
                      onClick={() => startUpdate(pair)}
                      className="inline-flex h-5 items-center rounded-[5px] bg-primary/15 px-[7px] text-2xs font-medium text-primary disabled:opacity-60"
                    >
                      {updating ? updatingLabel(progress[pair.update.id]) : `Update ${pair.update.to}`}
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
    <div ref={body} className={cn("relative flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-[18px]", cards ? "gap-5" : "gap-[22px]")}>
      {cards && banner}
      {cards && pluginCards}
      {cards && <BuiltInChips />}
      {!cards && pairs.length > 0 && (
        <section aria-label="Updates available" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionTitle>{`Updates available · ${pairs.length}`}</SectionTitle>
            <button type="button" onClick={() => pairs.forEach(startUpdate)} className={cn(BUTTON, "border-primary bg-primary text-primary-foreground")}>
              <RefreshCw size={14} aria-hidden="true" />
              Update all
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
                      <ArrowRight size={12} aria-label="to" className="shrink-0 text-muted-foreground" />
                      <span className="font-medium text-primary">{update.to}</span>
                    </span>
                    {update.changelog && <span className="truncate text-xs text-muted-foreground">{update.changelog}</span>}
                  </div>
                  {update.newPermissions.length > 0 && (
                    <span className="inline-flex h-5 items-center rounded-[5px] bg-warning/15 px-[7px] text-2xs font-medium text-warning">New permission</span>
                  )}
                  <button
                    type="button"
                    disabled={updating}
                    aria-label={`Update ${plugin.manifest.name}`}
                    onClick={() => startUpdate(pair)}
                    className={cn(BUTTON, "border-input bg-secondary text-secondary-foreground")}
                  >
                    {updating ? updatingLabel(progress[update.id]) : "Update"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!cards && <section aria-label="Installed plugins" className="flex flex-col gap-2">
        <SectionTitle>{`Installed plugins · ${plugins.length}`}</SectionTitle>
        {plugins.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No plugins installed yet.</p>
        ) : (
          <div role="table" aria-label="Installed plugins" className="flex flex-col">
            <div role="row" className={cn(COLUMNS, "h-[30px] border-b border-border text-xs text-muted-foreground")}>
              <span role="columnheader">Name</span>
              <span role="columnheader">Version</span>
              <span role="columnheader">Source</span>
              <span role="columnheader">Runtime</span>
              <span role="columnheader">Enabled</span>
              <span role="columnheader" aria-label="Actions" />
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
                    aria-label={`Enabled: ${plugin.manifest.name}`}
                    checked={plugin.enabled}
                    disabled={busy.has(plugin.id)}
                    onCheckedChange={(enabled) => void toggleEnabled(plugin, enabled)}
                    className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5"
                  />
                </span>
                <span role="cell" className="flex">
                  <button
                    type="button"
                    aria-label={`Actions for ${plugin.manifest.name}`}
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

      <AnchoredPanel open={!!menu} onClose={() => setMenu(null)} anchorRef={anchorRef} width={188} top={menu?.top} align="end" role="menu">
        {menu && (
          <div className="p-1">
            <MenuItem
              icon={<ShieldCheck size={14} aria-hidden="true" />}
              onClick={() => {
                setManaging(menu.plugin);
                setMenu(null);
              }}
            >
              Permissions…
            </MenuItem>
            <MenuItem
              icon={<FolderOpen size={14} aria-hidden="true" />}
              onClick={() => {
                const { plugin } = menu;
                setMenu(null);
                void revealPluginFolder(plugin.id).catch((error) => toast.error("Couldn't open the folder", { description: asMessage(error) }));
              }}
            >
              Show in folder
            </MenuItem>
            <div className="-mx-1 my-1 h-px bg-border" />
            <MenuItem
              destructive
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => {
                setRemoving(menu.plugin);
                setMenu(null);
              }}
            >
              Uninstall
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
