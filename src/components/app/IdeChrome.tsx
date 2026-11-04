import { Fragment } from "react";
import { LayoutGrid, Puzzle, Settings } from "lucide-react";
import { t, useT } from "@/i18n";

const pluginsLabel = (count: number) => (count > 0 ? t("shell.stripe.pluginsUpdates", { count }) : t("shell.stripe.plugins"));

interface DestinationProps {
  pluginsOpen: boolean;
  onOpenPlugins: () => void;
  /** Plugins and themes with a newer version, for the badge on Plugins. */
  updateCount: number;
  settingsOpen: boolean;
  onOpenSettings: () => void;
}

/** The 40px strip at the window's left edge, like an IDE's tool-window bar: Tools on top, Plugins and Settings at the bottom. */
export function ToolStripe({ sidebarOpen, onToggleSidebar, ...destinations }: DestinationProps & { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const t = useT();
  return (
    <div className="tool-stripe" role="toolbar" aria-label={t("shell.stripe.toolWindows")} aria-orientation="vertical">
      <div>
        <button type="button" className="stripe-button" aria-label={t("shell.sidebar.title")} aria-pressed={sidebarOpen} title={t("shell.sidebar.title")} onClick={onToggleSidebar}>
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
      </div>
      <div>
        <button
          type="button" className="stripe-button" data-destination="plugins" title={t("shell.stripe.plugins")}
          aria-label={pluginsLabel(destinations.updateCount)} aria-current={destinations.pluginsOpen ? "page" : undefined}
          onClick={destinations.onOpenPlugins}
        >
          <Puzzle size={16} aria-hidden="true" />
          {destinations.updateCount > 0 && <span className="stripe-badge" aria-hidden="true">{destinations.updateCount}</span>}
        </button>
        <button
          type="button" className="stripe-button" data-destination="settings" title={t("shell.stripe.settings")} aria-label={t("shell.stripe.settings")}
          aria-current={destinations.settingsOpen ? "page" : undefined} onClick={destinations.onOpenSettings}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface InfoProps {
  /** "v1.2.3", "Browser preview" or "Loading…". */
  version: string;
  /** A pending app update, in words. Opens Settings → General. Empty when there is none. */
  updateNotice: string;
  onUpdateNotice: () => void;
  hasReleaseNotes: boolean;
  hasUnreadWhatsNew: boolean;
  onWhatsNew: () => void;
}

function StatusInfo({ version, updateNotice, onUpdateNotice, hasReleaseNotes, hasUnreadWhatsNew, onWhatsNew }: InfoProps) {
  const t = useT();
  return (
    <>
      {updateNotice && <button type="button" onClick={onUpdateNotice}>{updateNotice}</button>}
      {hasReleaseNotes && (
        <button type="button" onClick={onWhatsNew} className="inline-flex items-center gap-1">
          <span>{t("shell.status.whatsNew")}</span>
          {hasUnreadWhatsNew && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
        </button>
      )}
      <span>{version}</span>
    </>
  );
}

/** The bar under the window: where you are on the left, the version and update notices on the right. */
export function StatusBar({ crumbs, ...info }: InfoProps & { crumbs: readonly string[] }) {
  const t = useT();
  return (
    <footer className="status-bar">
      <div className="status-crumbs" role="group" aria-label={t("shell.status.location")}>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}-${crumb}`}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb}</span>
          </Fragment>
        ))}
      </div>
      <StatusInfo {...info} />
    </footer>
  );
}

/** On a phone there is no stripe or status bar, so the drawer ends with Plugins, Settings and the same status line. */
export function SidebarFooter({ onNavigate, ...rest }: DestinationProps & InfoProps & { onNavigate?: () => void }) {
  const t = useT();
  const go = (action: () => void) => () => { action(); onNavigate?.(); };
  return (
    <div className="border-t border-border p-2">
      <button type="button" className="tree-row h-8" data-destination="plugins" aria-label={pluginsLabel(rest.updateCount)} aria-current={rest.pluginsOpen ? "page" : undefined} onClick={go(rest.onOpenPlugins)}>
        <Puzzle size={14} aria-hidden="true" />
        <span className="flex-1">{t("shell.stripe.plugins")}</span>
        {rest.updateCount > 0 && <span className="stripe-badge static" aria-hidden="true">{rest.updateCount}</span>}
      </button>
      <button type="button" className="tree-row h-8" data-destination="settings" aria-label={t("shell.stripe.settings")} aria-current={rest.settingsOpen ? "page" : undefined} onClick={go(rest.onOpenSettings)}>
        <Settings size={14} aria-hidden="true" />
        <span className="flex-1">{t("shell.stripe.settings")}</span>
      </button>
      <div className="status-bar mt-1 h-auto flex-wrap border-0 bg-transparent px-2 py-1">
        <StatusInfo {...rest} />
      </div>
    </div>
  );
}
