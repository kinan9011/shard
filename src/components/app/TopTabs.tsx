import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { X } from "lucide-react";
import { toolTint, type CatalogTool } from "@/app/catalog";
import { toolName } from "@/app/toolNames";
import { getDir, useT } from "@/i18n";
import { TabContextMenu, type TabContextMenuItem } from "@/components/app/TabContextMenu";

interface TopTabsProps {
  tools: CatalogTool[];
  selectedId: string | null;
  onSelect: (tool: CatalogTool) => void;
  onClose: (tool: CatalogTool) => void;
  /** Close several tabs at once. When the selected tab closes, `fallback` or the nearest open tab is selected. */
  onCloseMany: (ids: ReadonlySet<string>, fallback?: CatalogTool) => void;
  /** Hides a built-in tool or turns a plugin off. Without it the menu has no such item. */
  onHide?: (tool: CatalogTool) => void;
}

export function TopTabs({ tools, selectedId, onSelect, onClose, onCloseMany, onHide }: TopTabsProps) {
  const t = useT();
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const measure = () => setTabsOverflow(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tools.length]);

  useEffect(() => {
    // Keep the selected tab in view when the strip overflows.
    if (selectedId) document.getElementById(`tab-${selectedId}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  const [tabMenu, setTabMenu] = useState<{ tool: CatalogTool; x: number; y: number } | null>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const openTabMenu = (event: ReactMouseEvent<HTMLElement>, tool: CatalogTool) => {
    event.preventDefault();
    // The keyboard menu key reports no pointer position, so anchor the menu under the tab.
    const anchor = event.clientX || event.clientY ? null : event.currentTarget.getBoundingClientRect();
    setTabMenu({ tool, x: anchor ? anchor.left : event.clientX, y: anchor ? anchor.bottom : event.clientY });
  };
  const tabMenuItems = (tool: CatalogTool): TabContextMenuItem[] => {
    const index = tools.findIndex((entry) => entry.id === tool.id);
    const others = tools.filter((entry) => entry.id !== tool.id);
    const toRight = tools.slice(index + 1);
    return [
      { label: t("common.close"), onSelect: () => onClose(tool) },
      { label: t("shell.tabs.closeOthers"), disabled: others.length === 0, onSelect: () => onCloseMany(new Set(others.map((entry) => entry.id)), tool) },
      { label: t("shell.tabs.closeRight"), disabled: toRight.length === 0, onSelect: () => onCloseMany(new Set(toRight.map((entry) => entry.id)), tool) },
      { label: t("shell.tabs.closeAll"), onSelect: () => onCloseMany(new Set(tools.map((entry) => entry.id))) },
      ...(onHide ? [{ label: tool.pluginId ? t("shell.tabs.turnOffPlugin") : t("shell.tabs.hideTool"), onSelect: () => onHide(tool) }] : []),
    ];
  };

  return (
    <>
      <div className="workspace-tabs" role="tablist" aria-label={t("shell.phone.openTools")} ref={tabStripRef} data-overflow={tabsOverflow || undefined}>
        {tools.length === 0 && <span className="workspace-tab-placeholder">{t("shell.tabs.workspace")}</span>}
        {tools.map((tool) => (
          <div className="workspace-tab-wrap" role="presentation" key={tool.id} onContextMenu={(event) => openTabMenu(event, tool)}>
            <button type="button" role="tab" id={`tab-${tool.id}`} aria-controls={`panel-${tool.id}`} aria-selected={selectedId === tool.id}
              tabIndex={selectedId === tool.id ? 0 : -1}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(tool); } }}
              className="workspace-tab" onClick={() => onSelect(tool)}
              onKeyDown={(event) => {
                const index = tools.findIndex((entry) => entry.id === tool.id);
                let next = index;
                if (event.key === (getDir() === "rtl" ? "ArrowLeft" : "ArrowRight")) next = (index + 1) % tools.length;
                else if (event.key === (getDir() === "rtl" ? "ArrowRight" : "ArrowLeft")) next = (index - 1 + tools.length) % tools.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tools.length - 1;
                else if (event.key === "Delete") { onClose(tool); return; }
                else return;
                event.preventDefault();
                onSelect(tools[next]);
                document.getElementById(`tab-${tools[next].id}`)?.focus();
              }}>
              <span data-tint={toolTint(tool.id)} className="flex shrink-0"><tool.icon size={14} className="tint-icon" aria-hidden="true" /></span><span>{toolName(tool)}</span>
            </button>
            <button type="button" className="tab-close" tabIndex={-1} aria-label={t("shell.tabs.closeTool", { name: toolName(tool) })} title={t("shell.tabs.closeTab")} onClick={() => onClose(tool)}><X size={12} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      {tabMenu && <TabContextMenu x={tabMenu.x} y={tabMenu.y} label={t("shell.tabs.tabLabel", { name: toolName(tabMenu.tool) })} items={tabMenuItems(tabMenu.tool)} onClose={closeTabMenu} />}
    </>
  );
}
