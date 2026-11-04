import { useState } from "react";
import { ChevronLeft, House, Layers, Menu, Pin, Puzzle, Search, Settings, X } from "lucide-react";
import type { CatalogTool } from "@/app/catalog";
import { toolName } from "@/app/toolNames";
import { useT } from "@/i18n";
import { BrandMark } from "@/components/app/BrandMark";
import { useDialogFocus } from "@/components/app/useDialogFocus";

export type PhoneDestination = "home" | "tool" | "plugins" | "settings";

interface PhoneHeaderProps {
  destination: PhoneDestination;
  /** The title of what is on screen: the tool's name, "Plugins", "Settings", or the app's name on Home. */
  title: string;
  onBack: () => void;
  /** Sidebar layout only: opens the sidebar drawer. Launcher navigates with the bottom bar instead. */
  onMenu?: () => void;
  onSearch: () => void;
  /** The tool on screen, if any: it can be pinned. */
  tool: CatalogTool | null;
  pinned: boolean;
  onTogglePin: () => void;
  openTools: readonly CatalogTool[];
  onSelectTool: (tool: CatalogTool) => void;
  onCloseTool: (tool: CatalogTool) => void;
}

/** The phone's top bar: back to Home from a tool, the title, search, pin, and the list of open tools. */
export function PhoneHeader({ destination, title, onBack, onMenu, onSearch, tool, pinned, onTogglePin, openTools, onSelectTool, onCloseTool }: PhoneHeaderProps) {
  const t = useT();
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <header className="phone-header">
        {onMenu && (
          <button type="button" className="chrome-button" aria-label={t("shell.phone.openSidebar")} onClick={onMenu}>
            <Menu size={20} aria-hidden="true" />
          </button>
        )}
        {destination === "home" ? (
          !onMenu && <BrandMark className="size-6" />
        ) : (
          <button type="button" className="chrome-button" aria-label={t("shell.phone.backHome")} onClick={onBack}>
            <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden="true" />
          </button>
        )}
        {/* Not a heading: Plugins and Settings have their own, and a page has one. */}
        <div data-testid="phone-title" className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</div>
        {tool && (
          <button type="button" className="chrome-button" aria-label={pinned ? t("shell.sidebar.unpinFromHome") : t("shell.sidebar.pinToHome")} onClick={onTogglePin}>
            <Pin size={18} className={pinned ? "fill-current text-primary" : ""} aria-hidden="true" />
          </button>
        )}
        {openTools.length > 0 && (
          <button type="button" className="chrome-button relative" aria-label={t("shell.phone.openToolsCount", { count: openTools.length })} onClick={() => setSheet(true)}>
            <Layers size={18} aria-hidden="true" />
            <span className="launcher-badge">{openTools.length}</span>
          </button>
        )}
        <button type="button" className="chrome-button" aria-label={t("shell.palette.searchLabel")} onClick={onSearch}>
          <Search size={18} aria-hidden="true" />
        </button>
      </header>
      {sheet && (
        <OpenToolsSheet
          tools={openTools}
          onClose={() => setSheet(false)}
          onSelect={(next) => {
            setSheet(false);
            onSelectTool(next);
          }}
          onCloseTool={onCloseTool}
        />
      )}
    </>
  );
}

/** The open tools as a sheet over the screen: tap one to switch to it, × to close it. A phone has no tab strip. */
function OpenToolsSheet({ tools, onClose, onSelect, onCloseTool }: { tools: readonly CatalogTool[]; onClose: () => void; onSelect: (tool: CatalogTool) => void; onCloseTool: (tool: CatalogTool) => void }) {
  const t = useT();
  const ref = useDialogFocus(true, onClose);
  return (
    <div className="modal-backdrop fixed inset-0 z-[75] flex items-end" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t("shell.phone.openTools")} className="modal-surface max-h-[70dvh] w-full overflow-y-auto rounded-b-none pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-sm font-semibold text-foreground">{t("shell.phone.openTools")}</h2>
          <button type="button" className="chrome-button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="flex flex-col">
          {tools.map((tool) => (
            <li key={tool.id} className="flex items-center border-t border-border">
              <button type="button" className="min-h-12 flex-1 truncate px-4 text-start text-sm text-foreground" onClick={() => onSelect(tool)}>
                {toolName(tool)}
              </button>
              <button type="button" className="chrome-button" aria-label={t("shell.tabs.closeTool", { name: toolName(tool) })} onClick={() => onCloseTool(tool)}>
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface MobileNavProps {
  destination: PhoneDestination;
  onHome: () => void;
  onSearch: () => void;
  onPlugins: () => void;
  onSettings: () => void;
  /** Plugin and theme updates waiting. */
  badge: number;
}

/** The phone's bottom bar. */
export function MobileNav({ destination, onHome, onSearch, onPlugins, onSettings, badge }: MobileNavProps) {
  const t = useT();
  const item = (label: string, Icon: typeof House, active: boolean, onClick: () => void, count = 0) => (
    <button type="button" className="phone-nav-item" aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="relative">
        <Icon size={20} aria-hidden="true" />
        {count > 0 && <span className="launcher-badge">{count}</span>}
      </span>
      {label}
    </button>
  );
  return (
    <nav className="phone-nav" aria-label={t("shell.phone.main")}>
      {item(t("shell.sidebar.home"), House, destination === "home" || destination === "tool", onHome)}
      {item(t("common.search"), Search, false, onSearch)}
      {item(t("shell.stripe.plugins"), Puzzle, destination === "plugins", onPlugins, badge)}
      {item(t("shell.stripe.settings"), Settings, destination === "settings", onSettings)}
    </nav>
  );
}
