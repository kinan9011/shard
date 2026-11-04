import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, House, Minus, Pin, Puzzle, Search, X } from "lucide-react";
import { MAX_PINNED } from "@/app/pinned";
import { categoryName, categorySearchNames, toolName, toolSearchNames } from "@/app/toolNames";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toolTint, type CatalogTool } from "@/app/catalog";
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
  const t = useT();
  const name = toolName(tool);
  return (
    <div className="sidebar-tool group relative flex items-center">
      <button
        type="button"
        className="tree-row ps-7 pe-7"
        data-selected={isSelected || undefined}
        aria-current={isSelected ? "page" : undefined}
        onClick={() => onSelect(tool)}
      >
        <span data-tint={toolTint(tool.id)} className="flex"><tool.icon className="tint-icon h-3.5 w-3.5 shrink-0" aria-hidden="true" /></span>
        <span className="flex-1 truncate text-start">{name}</span>
      </button>
      <button
        type="button"
        onClick={() => onTogglePinned(tool.id)}
        className={`sidebar-favorite absolute end-1 rounded p-1 ${isPinned ? "is-favorite" : ""}`}
        aria-pressed={isPinned}
        aria-label={t("shell.sidebar.pin", { name })}
        title={isPinned ? t("shell.sidebar.unpinFromHome") : t("shell.sidebar.pinToHome")}
      >
        <Pin
          aria-hidden="true"
          className={`h-3 w-3 ${isPinned ? "fill-primary text-primary" : "text-muted-foreground"}`}
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
  onOpenPlugins: () => void;
  /** Settings → Appearance → Sidebar categories. */
  categoryMode: SidebarCategoryMode;
  /** Every built-in is hidden and no plugin is installed. */
  empty: boolean;
  /** Phone only: Plugins, Settings and the status line, which have no stripe or status bar to live in. */
  footer?: ReactNode;
}

/** The Tools window: a search field and the tools as a tree, grouped by category. Plugins, Settings and the version live in the stripe and the status bar. */
export function Sidebar({
  open, onOpenChange, searchQuery, onSearchChange, selectedId, tools, categories, pinned, pinnedTools,
  onSelect, onTogglePinned, onOpenPalette, paletteShortcutLabel, onOpenPlugins, categoryMode, empty, footer,
}: SidebarProps) {
  const t = useT();
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
  const anyExpanded = categories.some((category) => isExpanded(category.name));
  // Collapse all when something is open, else expand all. `toggled` lists the exceptions to the mode's start, so the two are mirror images.
  const setAllExpanded = (expanded: boolean) =>
    setToggled(expanded === (categoryMode === "open") ? [] : categories.map((category) => category.name));

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const query = searchQuery.trim().toLowerCase();
    return tools.filter(
      (tool) =>
        toolSearchNames(tool).some((name) => name.toLowerCase().includes(query)) ||
        categorySearchNames(tool.category).some((name) => name.toLowerCase().includes(query)) ||
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
          open ? "w-60 translate-x-0" : "w-0 -translate-x-full rtl:translate-x-full sm:translate-x-0 rtl:sm:translate-x-0"
        } h-full workspace-sidebar flex flex-col transition-all duration-200 overflow-hidden
        fixed sm:relative inset-y-0 start-0 z-50 sm:z-auto`}
      >
        <div className="tool-window-header">
          <h2>{t("shell.sidebar.title")}</h2>
          {!empty && !searchQuery && (
            <button
              type="button"
              className="chrome-button"
              aria-label={anyExpanded ? t("shell.sidebar.collapseAllLabel") : t("shell.sidebar.expandAllLabel")}
              title={anyExpanded ? t("shell.sidebar.collapseAll") : t("shell.sidebar.expandAll")}
              onClick={() => setAllExpanded(!anyExpanded)}
            >
              {anyExpanded ? <ChevronsDownUp size={14} aria-hidden="true" /> : <ChevronsUpDown size={14} aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            aria-label={t("shell.sidebar.close")}
            title={t("shell.sidebar.hide")}
            className="chrome-button"
            onClick={() => onOpenChange(false)}
          >
            <X className="sm:hidden" size={14} aria-hidden="true" />
            <Minus className="hidden sm:block" size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="absolute start-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && searchQuery) { e.preventDefault(); onSearchChange(""); } }}
              placeholder={t("shell.sidebar.searchPlaceholder")}
              aria-label={t("shell.sidebar.filterLabel")}
              className="h-7 ps-7 pe-14 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={onOpenPalette}
              className="sidebar-search-kbd"
              aria-label={t("shell.sidebar.openPaletteLabel", { shortcut: paletteShortcutLabel })}
              title={t("shell.sidebar.openPalette")}
            >
              {paletteShortcutLabel}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label={t("shell.sidebar.title")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {/* Home */}
          <button
            type="button"
            className="tree-row"
            data-selected={!selectedId || undefined}
            id="workspace-home"
            onClick={() => onSelect(null)}
          >
            <House className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t("shell.sidebar.home")}</span>
          </button>

          {/* Pinned */}
          {pinnedTools.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Pin className="h-3 w-3" aria-hidden="true" />
                  <span>{t("shell.sidebar.pinned")}</span>
                </div>
                <span className="text-2xs" aria-label={t("shell.sidebar.pinnedCount", { count: pinnedTools.length, max: MAX_PINNED })}>
                  {pinnedTools.length}/{MAX_PINNED}
                </span>
              </div>
              {pinnedTools.map(renderTool)}
            </div>
          )}

          {/* Categories */}
          {empty ? (
            <div className="mt-3 flex flex-col gap-2.5 rounded-md border border-dashed border-border p-3">
              <span className="text-sm font-medium text-foreground">{t("shell.sidebar.emptyTitle")}</span>
              <span className="text-xs text-muted-foreground">{t("shell.sidebar.emptyBody")}</span>
              <Button type="button" size="sm" className="w-fit gap-1.5 px-3 text-sm" onClick={onOpenPlugins}>
                <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />
                {t("shell.empty.browse")}
              </Button>
            </div>
          ) : !searchQuery ? (
            categories.map((category) => {
              const expanded = isExpanded(category.name);
              const FolderIcon = expanded ? FolderOpen : Folder;
              return (
                <div key={category.name}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleCategory(category.name)}
                    className="tree-row"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" aria-hidden="true" />}
                    <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate text-start">{categoryName(category.name)}</span>
                    <span className="tree-count">{category.tools.length}</span>
                  </button>
                  {expanded && category.tools.map(renderTool)}
                </div>
              );
            })
          ) : (
            <div className="mt-1">
              {filteredTools.map(renderTool)}
              {filteredTools.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground" role="status">
                  <p>{t("shell.sidebar.noMatch", { query: searchQuery.trim() })}</p>
                  <button type="button" className="sidebar-empty-action" onClick={onOpenPalette}>{t("shell.sidebar.searchInPalette")}</button>
                </div>
              )}
            </div>
          )}
        </nav>
        {footer}
      </aside>
    </>
  );
}
