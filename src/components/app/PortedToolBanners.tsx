import { Puzzle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { OFFICIAL_REPO_URL, type PortedTool } from "@/app/legacyMigration";
import { PermissionDialog } from "@/components/plugins/PermissionDialog";
import { installFromRepo } from "@/plugins/api";
import { installingLabel, useInstallFlow } from "@/plugins/useInstallFlow";
import { usePluginCatalog, type CatalogRow } from "@/plugins/usePluginCatalog";

interface PortedToolBannersProps {
  /** The ported tools to offer (see `portedToOffer`). */
  offers: readonly PortedTool[];
  /** Drops the tool's pin and recent entry: the user does not want it back. */
  onDismiss: (id: string) => void;
  /** Opens the plugin as a tool (the "Open" action of the install toast). */
  onOpenPlugin: (id: string) => void;
}

/** "Hash Generator is now a plugin. Install": one banner per ported tool that the user had pinned or used. */
export function PortedToolBanners({ offers, onDismiss, onOpenPlugin }: PortedToolBannersProps) {
  // The catalog and the install flow are only set up while there is something to offer.
  if (offers.length === 0) return null;
  return <Banners offers={offers} onDismiss={onDismiss} onOpenPlugin={onOpenPlugin} />;
}

/** The official repository's row for the plugin first, then any other repository that lists it. */
function pickRow(rows: readonly CatalogRow[], id: string, isOfficial: (repo: string) => boolean): CatalogRow | undefined {
  const listed = rows.filter((row) => row.entry.id === id && row.action.kind === "install");
  return listed.find((row) => isOfficial(row.entry.repo)) ?? listed[0];
}

/** The catalog, the install flow and the one-click install of a ported tool from the official repository. */
function usePortedInstall(onOpenPlugin: (id: string) => void) {
  const catalog = usePluginCatalog();
  // The plugin is installed: the app reads the plugins again and the offer is gone, so nothing else is needed here.
  const install = useInstallFlow({ onOpen: onOpenPlugin, refresh: catalog.refresh });
  const officialUrl = catalog.repos.find((repo) => repo.official)?.url ?? OFFICIAL_REPO_URL;
  const isOfficial = (repo: string) => catalog.repos.some((item) => item.url === repo && item.official);

  const start = (tool: PortedTool) => {
    const row = pickRow(catalog.rows, tool.pluginId, isOfficial);
    if (row) {
      install.request(row);
      return;
    }
    // Not listed: no release of the official repository yet, or it cannot be reached. Try the download anyway, so the
    // user gets the real reason (the install error toast) and not a dead button. Nothing is known to ask permission for.
    install.requestJob({
      id: tool.pluginId,
      entry: { name: tool.name, version: "", runtime: "web", permissions: [], repo: officialUrl },
      // Not checked against any listing: no dialog shows it, because nothing is known to ask permission for.
      verified: false,
      run: () => installFromRepo(officialUrl, tool.pluginId),
    });
  };
  return { catalog, install, start, isOfficial };
}

/** The permission dialog of an install in progress (nothing when no install waits for approval). */
function InstallDialog({ flow }: { flow: ReturnType<typeof usePortedInstall> }) {
  const { install, isOfficial } = flow;
  if (!install.pending) return null;
  return (
    <PermissionDialog
      key={install.pending.id}
      mode="install"
      entry={install.pending.entry}
      official={isOfficial(install.pending.entry.repo)}
      verified={install.pending.verified}
      onCancel={install.cancel}
      onConfirm={install.confirm}
    />
  );
}

/**
 * Installs a ported tool the user asked for from a paste suggestion ("Install Color Palette"): the same flow as the
 * Home banner, without the banner. It shows the permission dialog when the plugin asks for something, and calls
 * `onDone` once the install is over (done, failed or cancelled).
 */
export function PortedToolInstall({ tool, onOpenPlugin, onDone }: { tool: PortedTool; onOpenPlugin: (id: string) => void; onDone: () => void }) {
  const flow = usePortedInstall(onOpenPlugin);
  const { loading } = flow.catalog;
  const started = useRef(false);
  const seen = useRef(false);
  const [began, setBegan] = useState(false);
  const busy = Boolean(flow.install.pending) || tool.pluginId in flow.install.progress;

  useEffect(() => {
    if (started.current || loading) return;
    started.current = true;
    flow.start(tool);
    setBegan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the catalog has loaded
  }, [loading]);
  // `start` sets the dialog or the progress in the same batch as `began`, so a render with `began` and nothing busy
  // means the install did not start (another install of it is running) or it is over.
  useEffect(() => {
    if (!began) return;
    if (busy) seen.current = true;
    else onDone();
  }, [began, busy, onDone]);

  return <InstallDialog flow={flow} />;
}

function Banners({ offers, onDismiss, onOpenPlugin }: PortedToolBannersProps) {
  const flow = usePortedInstall(onOpenPlugin);
  const { catalog, install, start } = flow;
  return (
    <>
      {offers.map((tool) => {
        const busy = tool.pluginId in install.progress;
        return (
          <div key={tool.pluginId} className="mb-6 mt-2 flex items-center gap-3 rounded-lg bg-primary/[.14] px-3 py-2.5 text-sm text-foreground" role="status">
            <Puzzle size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1">
              <strong className="font-semibold">{tool.name} is now a plugin.</strong> Install it to keep using it. Your pin and recent entry come back with it.
            </span>
            <Button type="button" variant="secondary" size="sm" className="h-7 px-3 text-sm" disabled={busy || catalog.loading} aria-label={`Install ${tool.name}`} onClick={() => start(tool)}>
              {busy ? installingLabel(install.progress[tool.pluginId]) : "Install"}
            </Button>
            <button
              type="button"
              aria-label={`Dismiss the ${tool.name} notice`}
              title="Dismiss and remove it from pinned and recent tools"
              onClick={() => onDismiss(tool.pluginId)}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <InstallDialog flow={flow} />
    </>
  );
}
