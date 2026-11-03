import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Home, Pin, Puzzle, Search, Settings, X } from "lucide-react";
import { MAX_PINNED } from "@/app/pinned";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/app/BrandMark";
import { Input } from "@/components/ui/input";
import type { CatalogTool } from "@/app/catalog";
import type { SidebarCategoryMode } from "@/utils/theme";

const EXPANDED_STORAGE_KEY = "shard-sidebar-expanded";

/** The category names left open the last time, in "Remember" mode. Unreadable storage gives none. */
function readRemembered(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

interface ToolButtonProps {
  tool: CatalogTool;
  isPinned: boolean;
  isSelected: boolean;
  onSelect: (tool: CatalogTool) => void;
  onTogglePinned: (toolId: string) => void;
}

function ToolButton({ tool, isPinned, isSelected, onSelect, onTogglePinned }: ToolButtonProps) {
  return (
    <div className={`sidebar-tool group relative flex items-center rounded-md transition-colors ${
      isSelected ? "bg-accent text-accent-foreground text-foreground" : "text-muted-foreground hover:bg-accent"
    }`}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
        aria-current={isSelected ? "page" : undefined}
        onClick={() => onSelect(tool)}
      >
        <tool.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left truncate">{tool.name}</span>
      </button>
      <button
        type="button"
        onClick={() => onTogglePinned(tool.id)}
        className={`sidebar-favorite mr-1.5 rounded p-1 ${isPinned ? "is-favorite" : ""}`}
        aria-pressed={isPinned}
        aria-label={`Pin ${tool.name}`}
        title={isPinned ? "Unpin from Home" : "Pin to Home"}
      >
        <Pin
          aria-hidden="true"
          className={`w-3.5 h-3.5 ${isPinned ? "fill-primary text-primary" : "text-muted-foreground"}`}
        />
      </button>
    </div>
  );
}

interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** Id of the selected tool, or null when Home is showing. */
  selectedId: string | null;
  tools: CatalogTool[];
  categories: { name: string; tools: CatalogTool[] }[];
  pinned: readonly string[];
  pinnedTools: CatalogTool[];
  onSelect: (tool: CatalogTool | null) => void;
  onTogglePinned: (toolId: string) => void;
  onOpenPalette: () => void;
  paletteShortcutLabel: string;
  isDesktop: boolean;
  appVersion: string;
  /** A pending app update, in words. Opens Settings → General. Empty when there is none. */
  updateNotice: string;
  hasReleaseNotes: boolean;
  hasUnreadWhatsNew: boolean;
  onWhatsNew: () => void;
  onOpenPlugins: () => void;
  pluginsOpen: boolean;
  /** Plugins with a newer version, for the badge on the Plugins destination. */
  updateCount: number;
  onOpenSettings: (section?: string) => void;
  settingsOpen: boolean;
  /** Settings → Appearance → Sidebar categories. */
  categoryMode: SidebarCategoryMode;
  /** Every built-in is hidden and no plugin is installed. */
  empty: boolean;
}

export function Sidebar({
  open, onOpenChange, searchQuery, onSearchChange, selectedId, tools, categories, pinned, pinnedTools,
  onSelect, onTogglePinned, onOpenPalette, paletteShortcutLabel, isDesktop, appVersion, updateNotice,
  hasReleaseNotes, hasUnreadWhatsNew, onWhatsNew,
  onOpenPlugins, pluginsOpen, updateCount, onOpenSettings, settingsOpen, categoryMode, empty,
}: SidebarProps) {
  // `toggled` holds the categories that differ from the mode's starting point. "Remember" and "All closed" start
  // closed (so it lists the open ones), "All open" starts open (so it lists the closed ones). Only "Remember"
  // saves it. Changing the mode resets it, and "Remember" gets the saved list back.
  const [toggled, setToggled] = useState<string[]>(() => (categoryMode === "remember" ? readRemembered() : []));
  const [lastMode, setLastMode] = useState(categoryMode);
  if (lastMode !== categoryMode) {
    setLastMode(categoryMode);
    setToggled(categoryMode === "remember" ? readRemembered() : []);
  }
  useEffect(() => {
    if (categoryMode !== "remember") return;
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(toggled));
    } catch (error) {
      console.error("Failed to save open categories:", error);
    }
  }, [categoryMode, toggled]);
  const isExpanded = (name: string) => (categoryMode === "open") !== toggled.includes(name);
  const toggleCategory = (name: string) => {
    setToggled((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  };

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const query = searchQuery.trim().toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.category.toLowerCase().includes(query) ||
        tool.keywords.some((keyword) => keyword.startsWith(query))
    );
  }, [tools, searchQuery]);

  const renderTool = (tool: CatalogTool) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      isPinned={pinned.includes(tool.id)}
      isSelected={selectedId === tool.id}
      onSelect={onSelect}
      onTogglePinned={onTogglePinned}
    />
  );

  return (
    <>
      {/* Mobile Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 sm:hidden"
          onClick={() => onOpenChange(false)}
        />
      )}

      <aside
        aria-hidden={!open}
        style={!open ? { visibility: "hidden" } : undefined}
        className={`${
          open ? "w-56 translate-x-0" : "w-0 -translate-x-full sm:translate-x-0"
        } h-full sm:h-screen workspace-sidebar border-border border-r flex flex-col transition-all duration-200 overflow-hidden
        fixed sm:relative inset-y-0 left-0 z-50 sm:z-auto`}
      >
        {/* Logo */}
        <div data-tauri-drag-region className="sidebar-brand h-14 flex items-center justify-between px-4 border-border border-b">
          <div className="flex items-center">
            <BrandMark className="w-5 h-5" />
            <span className="ml-2.5 font-semibold text-foreground">Shard</span>
          </div>
          <button
            aria-label="Close sidebar"
            className="sm:hidden p-1 rounded hover:bg-accent"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape" && searchQuery) { e.preventDefault(); onSearchChange(""); } }}
                placeholder="Search..."
                aria-label="Filter tools"
                className="pl-9 pr-14 bg-background border-border text-sm h-8 text-foreground placeholder:text-muted-foreground rounded-md"
              />
              <button
                type="button"
                onClick={onOpenPalette}
                className="sidebar-search-kbd"
                aria-label={`Open command palette (${paletteShortcutLabel})`}
                title="Open command palette"
              >
                {paletteShortcutLabel}
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Tools" className="flex-1 min-h-0 py-1 overflow-y-auto">
          {/* Home */}
          <div className="px-2 mb-1">
            <button
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                !selectedId
                  ? "bg-accent text-accent-foreground text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              id="workspace-home"
              onClick={() => onSelect(null)}
            >
              <Home className="w-4 h-4" />
              <span>Home</span>
            </button>
          </div>

          {/* Pinned */}
          {pinnedTools.length > 0 && (
            <div className="px-2 mb-3">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Pin className="w-3 h-3" />
                  <span>Pinned</span>
                </div>
                <span className="text-2xs" aria-label={`${pinnedTools.length} of ${MAX_PINNED} pinned`}>
                  {pinnedTools.length}/{MAX_PINNED}
                </span>
              </div>
              {pinnedTools.map(renderTool)}
            </div>
          )}

          {/* Categories */}
          {empty ? (
            <div className="mx-1 mt-3 flex flex-col gap-2.5 rounded-lg border border-dashed border-border p-3.5">
              <span className="text-sm font-medium text-foreground">No tools installed</span>
              <span className="text-xs text-muted-foreground">Tools you install show up here, grouped by category.</span>
              <Button type="button" size="sm" className="h-[30px] w-fit gap-[7px] px-3 text-sm" onClick={onOpenPlugins}>
                <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                Browse plugins
              </Button>
            </div>
          ) : !searchQuery ? (
            categories.map((category) => (
              <div key={category.name} className="px-2 mb-1">
                <button
                  type="button"
                  aria-expanded={isExpanded(category.name)}
                  onClick={() => toggleCategory(category.name)}
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent rounded-md transition-colors"
                >
                  {isExpanded(category.name) ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span className="flex-1 text-left">{category.name}</span>
                  <span className="text-2xs font-normal">{category.tools.length}</span>
                </button>
                {isExpanded(category.name) && (
                  <div className="mt-0.5">
                    {category.tools.map(renderTool)}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="px-2">
              {filteredTools.map(renderTool)}
              {filteredTools.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground" role="status">
                  <p>No tools match “{searchQuery.trim()}”.</p>
                  <button type="button" className="sidebar-empty-action" onClick={onOpenPalette}>Search in the command palette</button>
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-destinations mx-2 flex flex-col gap-0.5 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onOpenPlugins}
            aria-current={pluginsOpen ? "page" : undefined}
            className="sidebar-destination"
          >
            <Puzzle className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1 text-left">Plugins</span>
            {updateCount > 0 && (
              <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-[5px] text-2xs font-semibold text-primary-foreground">
                {updateCount}
                <span className="sr-only"> {updateCount === 1 ? "update" : "updates"}</span>
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenSettings()}
            aria-current={settingsOpen ? "page" : undefined}
            className="sidebar-destination"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1 text-left">Settings</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2.5 text-2xs text-muted-foreground">
              <span>{isDesktop ? (appVersion ? `v${appVersion}` : "Loading…") : "Browser preview"}</span>
              {hasReleaseNotes && (
                <button
                  type="button"
                  onClick={onWhatsNew}
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  <span>What's new</span>
                  {hasUnreadWhatsNew && (
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            {updateNotice && (
              <button
                type="button"
                onClick={() => onOpenSettings("general")}
                className="block w-full px-2.5 text-left text-2xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
              >
                {updateNotice}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
