import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { permissionRows } from "@/plugins/permissions";
import { installingLabel } from "@/plugins/useInstallFlow";
import type { PluginRuntime } from "@/plugins/types";
import type { CatalogRow } from "@/plugins/usePluginCatalog";
import { pluginUrl } from "@/plugins/url";
import { DASH, formatSize } from "@/plugins/format";
import { ConfirmUninstall } from "./ConfirmUninstall";
import { PermissionList } from "./PermissionList";
import { RuntimeBadge } from "./RuntimeBadge";
import { TabButton } from "./TabButton";

const TABS = ["overview", "permissions", "changelog"] as const;
type DetailTab = (typeof TABS)[number];

const RUNTIME_DETAIL: Record<PluginRuntime, string> = { web: "Web UI", wasm: "WASM backend", "web+wasm": "Web UI + WASM backend" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-18` → `18 Oct 2026`. Anything else is shown as it came. */
function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : date;
}

/** `1.0.0` → `Shard 1.0 or later`. */
function formatRequires(minAppVersion: string | undefined): string {
  const match = minAppVersion ? /^(\d+)\.(\d+)/.exec(minAppVersion) : null;
  return match ? `Shard ${match[1]}.${match[2]} or later` : "Any version";
}

/** The URL when it is https, else null: a link is never made from anything else. */
const httpsOnly = (url: string | undefined) => (url && /^https:\/\//.test(url) ? url : null);

const shortSha = (sha: string) => (sha.length > 12 ? `${sha.slice(0, 6)}…${sha.slice(-5)}` : sha);

/** `https://github.com/o/r` → `o/r`; null when the URL is not a GitHub repository. */
const ownerAndRepo = (repoUrl: string) => /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(repoUrl)?.[1] ?? null;

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-full flex flex-col gap-px" : "flex min-w-0 flex-col gap-px"}>
      <span className="text-muted-foreground">{label}</span>
      {wide ? children : <span className="truncate">{children}</span>}
    </div>
  );
}

function DetailsGrid({ entry, installed, sourceUrl, className }: { entry: CatalogRow["entry"]; installed: CatalogRow["installed"]; sourceUrl: string | null; className: string }) {
  return (
    <div className={cn("grid gap-x-5 gap-y-2.5 text-xs", className)}>
      <Detail label="Version">{entry.released ? `${entry.version}, released ${formatDate(entry.released)}` : entry.version}</Detail>
      <Detail label="Size">{formatSize(entry.size)}</Detail>
      <Detail label="Runtime">{RUNTIME_DETAIL[entry.runtime]}</Detail>
      <Detail label="Requires">{formatRequires(entry.minAppVersion)}</Detail>
      <Detail label="License">{installed?.manifest.license ?? DASH}</Detail>
      <Detail label="Source">
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {sourceUrl.replace(/^https:\/\//, "")}
          </a>
        ) : (
          DASH
        )}
      </Detail>
      <Detail label="Checksum" wide>
        <span className="flex items-center gap-1.5">
          <span className="font-mono">{`SHA-256 ${shortSha(entry.sha256)}`}</span>
          <span className="flex items-center gap-1 text-success">
            <Check size={12} strokeWidth={3} aria-hidden="true" />
            matches release
          </span>
        </span>
      </Detail>
    </div>
  );
}

function PrimaryAction({ action, progress, onInstall }: { action: CatalogRow["action"]; progress: number | null | undefined; onInstall: () => void }) {
  if (action.kind === "installed" && progress === undefined) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-success/15 px-3 text-sm font-medium text-success">
        <Check size={14} aria-hidden="true" />
        Installed
      </span>
    );
  }
  // Update stays disabled: it goes through the permission dialog in "update" mode, which the Installed tab brings.
  const installing = progress !== undefined;
  return (
    <button
      type="button"
      disabled={installing || action.kind !== "install"}
      aria-busy={installing || undefined}
      onClick={onInstall}
      className="inline-flex h-8 items-center gap-[7px] whitespace-nowrap rounded-md border border-primary-solid bg-primary-solid px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
    >
      {action.kind === "install" && !installing && <Download size={14} aria-hidden="true" />}
      {installing ? installingLabel(progress) : action.kind === "update" ? `Update to ${action.to}` : "Install"}
    </button>
  );
}

interface PluginDetailProps {
  row: CatalogRow;
  /** Whether the plugin comes from the official repository. */
  official: boolean;
  /** Percent while the plugin is being installed, null when the size is unknown, undefined otherwise. */
  progress: number | null | undefined;
  onInstall: () => void;
  /** Uninstalls the plugin after the confirm step. Without it the detail offers no Uninstall. */
  onUninstall?: () => void;
  /** "page" is the Launcher layout: a full page with a back link and an aside (Details, Asks for). */
  variant?: "pane" | "page";
  onBack?: () => void;
}

const LABEL = "text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground";

/** The first screenshot of the manifest, served by the plugin protocol. It is dropped when the file can't be loaded (a disabled plugin is a 404). */
function Screenshot({ row }: { row: CatalogRow }) {
  const [failed, setFailed] = useState(false);
  const file = row.installed?.manifest.screenshots?.[0];
  if (!file || failed) return null;
  return (
    <div className="grid h-[300px] place-items-center overflow-hidden rounded-[10px] border border-border bg-secondary">
      <img src={pluginUrl(row.entry.id, file)} alt={`Screenshot of ${row.entry.name}`} onError={() => setFailed(true)} className="size-full object-contain" />
    </div>
  );
}

/** The detail of a plugin: header with the action, then Overview, Permissions and Changelog. Remount per plugin (key) to reset the tab. */
export function PluginDetail({ row, official, progress, onInstall, onUninstall, variant = "pane", onBack }: PluginDetailProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [confirming, setConfirming] = useState(false);
  const { entry, installed } = row;
  const page = variant === "page";
  const rows = permissionRows(entry);
  const slug = ownerAndRepo(entry.repo);
  const sourceUrl = httpsOnly(installed?.manifest.source) ?? httpsOnly(entry.repo);
  const description = installed?.manifest.longDescription?.trim() || entry.description;
  const panel = "plugin-detail-panel";
  const section = useRef<HTMLElement>(null);
  // The list row that was clicked is gone from the tree (the layout changes), so focus follows to the pane.
  useEffect(() => section.current?.focus(), []);

  const tabs = (
    <div role="tablist" aria-label="Plugin sections" className="-ml-3 flex h-9 shrink-0 border-b border-border">
      <TabButton<DetailTab> idPrefix="plugin-detail-tab" controls={panel} id="overview" selected={tab === "overview"} onSelect={setTab}>
        Overview
      </TabButton>
      <TabButton<DetailTab> idPrefix="plugin-detail-tab" controls={panel} id="permissions" selected={tab === "permissions"} onSelect={setTab}>
        Permissions{" "}
        <span className={tab === "permissions" ? "" : "font-normal"}>{rows.length}</span>
      </TabButton>
      <TabButton<DetailTab> idPrefix="plugin-detail-tab" controls={panel} id="changelog" selected={tab === "changelog"} onSelect={setTab}>
        Changelog
      </TabButton>
    </div>
  );
  const changelog = <p className="max-w-[640px] whitespace-pre-line leading-[1.6] text-foreground">{entry.changelog?.trim() || "No changelog yet."}</p>;

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Plugin details"
      onKeyDown={
        page
          ? (event) => {
              // Escape in an input clears the input, it does not leave the page.
              if (event.key === "Escape" && !event.defaultPrevented && !(event.target instanceof HTMLInputElement)) onBack?.();
            }
          : undefined
      }
      className={cn("flex min-w-0 flex-1 flex-col overflow-y-auto outline-none", page ? "gap-[18px] px-4 pb-5 pt-[18px] sm:px-10" : "gap-3.5 px-4 py-5 sm:px-8")}
    >
      {page && (
        <button type="button" onClick={onBack} className="flex w-fit items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} aria-hidden="true" />
          Plugins
        </button>
      )}
      <div className="flex items-start gap-4">
        <span className={cn("grid shrink-0 place-items-center bg-accent text-primary", page ? "size-16 rounded-[15px]" : "size-[52px] rounded-xl")}>
          <Puzzle size={page ? 28 : 24} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-xl font-semibold leading-[1.2] text-foreground">{entry.name}</h2>
          <span className="text-muted-foreground">{slug ? `${slug.split("/")[0]} · from ${slug}` : `from ${entry.repoName}`}</span>
          <div className="flex gap-1.5">
            <RuntimeBadge runtime={entry.runtime} />
            {!official && <span className="inline-flex h-5 items-center rounded-[5px] bg-warning/15 px-[7px] text-2xs font-medium text-warning">Third-party</span>}
            <span className="inline-flex h-5 items-center rounded-[5px] border border-input bg-secondary px-[7px] text-2xs font-medium text-muted-foreground">{`v${entry.version}`}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.installed && progress === undefined && onUninstall && (
            <button
              type="button"
              aria-label={`Uninstall ${entry.name}`}
              onClick={() => setConfirming(true)}
              className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-input bg-secondary px-3 text-sm font-medium text-destructive"
            >
              Uninstall
            </button>
          )}
          <PrimaryAction action={row.action} progress={progress} onInstall={onInstall} />
        </div>
        {confirming && row.installed && onUninstall && (
          <ConfirmUninstall plugin={row.installed} onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onUninstall(); }} />
        )}
      </div>
      {page ? (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            {tabs}
            <div id={panel} role="tabpanel" aria-labelledby={`plugin-detail-tab-${tab}`} className="flex flex-col gap-4">
              {tab === "overview" && (
                <>
                  <p className="whitespace-pre-line leading-[1.6] text-foreground [text-wrap:pretty]">{description}</p>
                  <Screenshot row={row} />
                </>
              )}
              {tab === "permissions" && <PermissionList rows={rows} />}
              {tab === "changelog" && changelog}
            </div>
          </div>
          <aside aria-label={`About ${entry.name}`} className="flex flex-col gap-3.5">
            <section aria-label="Details" className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
              <span className={LABEL}>Details</span>
              <DetailsGrid entry={entry} installed={installed} sourceUrl={sourceUrl} className="grid-cols-1 sm:grid-cols-2" />
            </section>
            {rows.length > 0 && (
              <section aria-label="Asks for" className="flex flex-col rounded-[10px] border border-border px-4 pb-2 pt-4">
                <span className={cn(LABEL, "mb-2")}>Asks for</span>
                <ul>
                  {rows.map((item) => (
                    <li key={item.key} className="flex items-center gap-2.5 border-t border-border py-[7px]">
                      <item.icon size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.required ? "Required" : "Optional"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      ) : (
        <>
          {tabs}
          <div id={panel} role="tabpanel" aria-labelledby={`plugin-detail-tab-${tab}`} className="flex flex-col gap-3.5">
            {tab === "overview" && (
              <>
                <p className="max-w-[640px] whitespace-pre-line leading-[1.6] text-foreground [text-wrap:pretty]">{description}</p>
                <DetailsGrid entry={entry} installed={installed} sourceUrl={sourceUrl} className="grid-cols-1 sm:grid-cols-3" />
                <div className="mt-1 flex flex-col">
                  <span className={cn(LABEL, "mb-2")}>Permissions</span>
                  <PermissionList rows={rows} />
                </div>
              </>
            )}
            {tab === "permissions" && <PermissionList rows={rows} />}
            {tab === "changelog" && changelog}
          </div>
        </>
      )}
    </section>
  );
}
