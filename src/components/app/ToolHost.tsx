import { Suspense, memo } from "react";
import { TOOL_COMPONENTS, type BuiltinToolId } from "@/app/toolRegistry";
import type { CatalogTool } from "@/app/catalog";
import { ToolActiveContext } from "@/hooks/useToolActive";
import { PluginFrame } from "@/components/plugins/PluginFrame";
import { toolName } from "@/app/toolNames";
import { useT } from "@/i18n";

// Memoized so a shell state change (sidebar search, menus, paste) does not re-render every open tool.
const ToolPanel = memo(function ToolPanel({ id, name, source }: { id: string; name: string; source: CatalogTool["source"] }) {
  if (source === "plugin") return <PluginFrame pluginId={id} name={name} />;
  const Component = TOOL_COMPONENTS[id as BuiltinToolId];
  return Component ? <Component /> : null;
});

// A hidden plugin tab cannot be focused or clicked by accident. React 18 has no `inert` prop type, so pass the attribute through a spread.
const INERT = { inert: "" } as Record<string, string>;

// Tools that use the shared editor layout (toolbar, panes, status bar) and fill the panel.
const WORKSPACE_TOOL_IDS = new Set<string>(["json-viewer", "text-compare", "diff-merge", "json-diff", "jwt-decoder", "json-typescript", "regex-generator", "json-schema"]);

interface ToolHostProps {
  tools: CatalogTool[];
  selectedId: string | null;
}

// Every open tool stays mounted (hidden when not selected) so its state survives tab switches.
export function ToolHost({ tools, selectedId }: ToolHostProps) {
  const t = useT();
  return (
    <>
      {tools.map((tool) => (
        <section key={tool.id} id={`panel-${tool.id}`} role="tabpanel" aria-labelledby={`tab-${tool.id}`} hidden={selectedId !== tool.id} {...(tool.source === "plugin" && selectedId !== tool.id ? INERT : {})} className={`tool-panel ${tool.source === "plugin" || WORKSPACE_TOOL_IDS.has(tool.id) ? "tool-panel-editor" : "tool-panel-form"}`}>

          <ToolActiveContext.Provider value={selectedId === tool.id}>
            <Suspense fallback={<div className="p-8 text-muted-foreground">{t("shell.toolHost.loading", { name: toolName(tool) })}</div>}><ToolPanel id={tool.id} name={tool.name} source={tool.source} /></Suspense>
          </ToolActiveContext.Provider>
        </section>
      ))}
    </>
  );
}
