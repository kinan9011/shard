import { useEffect, useRef, useState } from "react";
import { OFFICIAL_REPO_URL, type InstallableTool } from "@/app/installableTools";
import { PermissionDialog } from "@/components/plugins/PermissionDialog";
import { installFromRepo } from "@/plugins/api";
import { useInstallFlow } from "@/plugins/useInstallFlow";
import { usePluginCatalog, type CatalogRow } from "@/plugins/usePluginCatalog";

/** The official repository's row for the plugin first, then any other repository that lists it. */
function pickRow(rows: readonly CatalogRow[], id: string, isOfficial: (repo: string) => boolean): CatalogRow | undefined {
  const listed = rows.filter((row) => row.entry.id === id && row.action.kind === "install");
  return listed.find((row) => isOfficial(row.entry.repo)) ?? listed[0];
}

/** The catalog, the install flow and the install of a plugin from the official repository. */
function usePasteInstall(onOpenPlugin: (id: string) => void) {
  const catalog = usePluginCatalog();
  // The plugin is installed: the app reads the plugins again and the offer is gone, so nothing else is needed here.
  const install = useInstallFlow({ onOpen: onOpenPlugin, refresh: catalog.refresh });
  const officialUrl = OFFICIAL_REPO_URL;
  const isOfficial = (repo: string) => catalog.repos.some((item) => item.url === repo && item.official);

  const start = (tool: InstallableTool) => {
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
function InstallDialog({ flow }: { flow: ReturnType<typeof usePasteInstall> }) {
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
 * Installs a plugin the user asked for from a paste suggestion ("Install Color Palette"): the same flow as the
 * Home banner, without the banner. It shows the permission dialog when the plugin asks for something, and calls
 * `onDone` once the install is over (done, failed or cancelled).
 */
export function PasteInstall({ tool, onOpenPlugin, onDone }: { tool: InstallableTool; onOpenPlugin: (id: string) => void; onDone: () => void }) {
  const flow = usePasteInstall(onOpenPlugin);
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
