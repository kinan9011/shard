import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstallFlow } from "@/plugins/useInstallFlow";
import { rowKey, usePluginCatalog } from "@/plugins/usePluginCatalog";
import { usePlugins } from "@/plugins/usePlugins";
import { BrowseTab } from "./BrowseTab";
import { InstallDialog } from "./InstallDialog";
import { InstalledTab } from "./InstalledTab";
import { PermissionDialog } from "./PermissionDialog";
import { PluginDetail } from "./PluginDetail";
import { RepositoriesTab } from "./RepositoriesTab";
import { TabButton } from "./TabButton";

export const PLUGIN_TABS = ["browse", "installed", "repositories"] as const;
export type PluginsTab = (typeof PLUGIN_TABS)[number];

interface PluginsPageProps {
  tab: string;
  onTabChange: (tab: PluginsTab) => void;
  /** Opens an installed plugin as a tool (the "Open" action of the Installed toast). */
  onOpenPlugin?: (id: string) => void;
  /** Opens the "Install plugin" dialog on arrival (Home's "Install from file or URL"). */
  startInstall?: boolean;
  /** "cards" is the Launcher layout (screens 02 B – 05 B): the same data and dialogs, other chrome. */
  variant?: "list" | "cards";
}

/** The Plugins destination: Browse, Installed and Repositories. */
export function PluginsPage({ tab, onTabChange, onOpenPlugin, startInstall = false, variant = "list" }: PluginsPageProps) {
  const catalog = usePluginCatalog();
  const { plugins } = usePlugins();
  const install = useInstallFlow({ onOpen: (id) => onOpenPlugin?.(id), refresh: catalog.refresh });
  const pending = install.pending;
  const [installOpen, setInstallOpen] = useState(startInstall);
  const current: PluginsTab = PLUGIN_TABS.find((candidate) => candidate === tab) ?? "browse";
  const updateCount = catalog.updates.length;
  const cards = variant === "cards";
  // Cards: the detail is a page over the tabs. The tabs stay mounted (hidden), so Browse keeps its search and filters.
  const [detailKey, setDetailKey] = useState("");
  const detail = cards ? catalog.rows.find((row) => rowKey(row) === detailKey) : undefined;
  const body = useRef<HTMLDivElement>(null);
  // A plugin that left the catalog (repository removed or turned off) closes its page for good: it does not reopen when the plugin is back.
  useEffect(() => {
    if (detailKey && !catalog.loading && !catalog.rows.some((row) => rowKey(row) === detailKey)) setDetailKey("");
  }, [detailKey, catalog.loading, catalog.rows]);
  const closeDetail = () => {
    const key = detailKey;
    setDetailKey("");
    // The page leaves the tree: focus goes back to the card that opened it.
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-plugin-key="${CSS.escape(key)}"] [data-testid="plugin-name"]`)?.focus());
  };

  return (
    <div data-variant={variant} className="flex h-full min-h-0 flex-col bg-background">
      {detail && (
        <PluginDetail
          key={rowKey(detail)}
          variant="page"
          row={detail}
          progress={install.progress[detail.entry.id]}
          onInstall={() => install.request(detail)}
          official={catalog.repos.some((item) => item.url === detail.entry.repo && item.official)}
          onBack={closeDetail}
        />
      )}
      <div className={cn("flex shrink-0 flex-col gap-3.5 border-b border-border px-7 pt-5", detail && "hidden")}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-xl font-semibold leading-[1.3] text-foreground">Plugins</h1>
            <p className="text-sm text-muted-foreground">Add tools from your repositories, a zip file, a folder or a repo URL.</p>
          </div>
          <button
            type="button"
            onClick={() => setInstallOpen(true)}
            className="inline-flex h-[30px] items-center gap-[7px] whitespace-nowrap rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground"
          >
            <Download size={14} aria-hidden="true" />
            Install from file or URL
          </button>
        </div>
        <div role="tablist" aria-label="Plugins" className="-ml-3 flex h-9 gap-1">
          <TabButton idPrefix="plugins-tab" controls="plugins-panel" id="browse" selected={current === "browse"} onSelect={onTabChange}>
            Browse
          </TabButton>
          <TabButton idPrefix="plugins-tab" controls="plugins-panel" id="installed" selected={current === "installed"} onSelect={onTabChange}>
            Installed
            {updateCount > 0 && (
              <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary/15 px-1.5 text-2xs font-semibold text-primary">
                {updateCount} {updateCount === 1 ? "update" : "updates"}
              </span>
            )}
          </TabButton>
          <TabButton idPrefix="plugins-tab" controls="plugins-panel" id="repositories" selected={current === "repositories"} onSelect={onTabChange}>
            Repositories
            {catalog.repos.length > 0 && <span className="font-normal text-muted-foreground">{catalog.repos.length}</span>}
          </TabButton>
        </div>
      </div>
      <div ref={body} id="plugins-panel" role="tabpanel" aria-labelledby={`plugins-tab-${current}`} className={cn("flex min-h-0 flex-1", detail && "hidden")}>
        {current === "browse" ? (
          <BrowseTab rows={catalog.rows} repos={catalog.repos} loading={catalog.loading} error={catalog.error} onInstall={install.request} progress={install.progress} variant={variant} onOpen={(row) => setDetailKey(rowKey(row))} />
        ) : current === "installed" ? (
          <InstalledTab
            plugins={plugins}
            rows={catalog.rows}
            repos={catalog.repos}
            updates={catalog.updates}
            onRequest={install.requestJob}
            progress={install.progress}
            refresh={catalog.refresh}
            variant={variant}
          />
        ) : (
          <RepositoriesTab repos={catalog.repos} rows={catalog.rows} refresh={catalog.refresh} variant={variant} />
        )}
      </div>
      {installOpen && (
        <InstallDialog
          onCancel={() => setInstallOpen(false)}
          onContinue={(job) => {
            setInstallOpen(false);
            install.requestJob(job);
          }}
          onOpenRepositories={() => {
            setInstallOpen(false);
            onTabChange("repositories");
          }}
        />
      )}
      {pending && (
        <PermissionDialog
          key={pending.id}
          mode={pending.update ? "update" : "install"}
          granted={pending.update?.granted}
          newPermissions={pending.update?.newPermissions}
          entry={pending.entry}
          official={catalog.repos.some((item) => item.url === pending.entry.repo && item.official)}
          verified={pending.verified}
          onCancel={install.cancel}
          onConfirm={install.confirm}
        />
      )}
    </div>
  );
}
