import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { X } from "lucide-react";
import { toolTint, type CatalogTool } from "@/app/catalog";
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
      { label: "Close", onSelect: () => onClose(tool) },
      { label: "Close other tabs", disabled: others.length === 0, onSelect: () => onCloseMany(new Set(others.map((entry) => entry.id)), tool) },
      { label: "Close tabs to the right", disabled: toRight.length === 0, onSelect: () => onCloseMany(new Set(toRight.map((entry) => entry.id)), tool) },
      { label: "Close all tabs", onSelect: () => onCloseMany(new Set(tools.map((entry) => entry.id))) },
      ...(onHide ? [{ label: tool.pluginId ? "Turn off this plugin" : "Hide this tool", onSelect: () => onHide(tool) }] : []),
    ];
  };

  return (
    <>
      <div className="workspace-tabs" role="tablist" aria-label="Open tools" ref={tabStripRef} data-overflow={tabsOverflow || undefined}>
        {tools.length === 0 && <span className="workspace-tab-placeholder">Workspace</span>}
        {tools.map((tool) => (
          <div className="workspace-tab-wrap" role="presentation" key={tool.id} onContextMenu={(event) => openTabMenu(event, tool)}>
            <button type="button" role="tab" id={`tab-${tool.id}`} aria-controls={`panel-${tool.id}`} aria-selected={selectedId === tool.id}
              tabIndex={selectedId === tool.id ? 0 : -1}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(tool); } }}
              className="workspace-tab" onClick={() => onSelect(tool)}
              onKeyDown={(event) => {
                const index = tools.findIndex((entry) => entry.id === tool.id);
                let next = index;
                if (event.key === "ArrowRight") next = (index + 1) % tools.length;
                else if (event.key === "ArrowLeft") next = (index - 1 + tools.length) % tools.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tools.length - 1;
                else if (event.key === "Delete") { onClose(tool); return; }
                else return;
                event.preventDefault();
                onSelect(tools[next]);
                document.getElementById(`tab-${tools[next].id}`)?.focus();
              }}>
              <span data-tint={toolTint(tool.id)} className="flex shrink-0"><tool.icon size={14} className="tint-icon" aria-hidden="true" /></span><span>{tool.name}</span>
            </button>
            <button type="button" className="tab-close" tabIndex={-1} aria-label={`Close ${tool.name}`} title="Close tab" onClick={() => onClose(tool)}><X size={12} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      {tabMenu && <TabContextMenu x={tabMenu.x} y={tabMenu.y} label={`${tabMenu.tool.name} tab`} items={tabMenuItems(tabMenu.tool)} onClose={closeTabMenu} />}
    </>
  );
}
