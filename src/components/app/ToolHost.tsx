import { Suspense, memo } from "react";
import { TOOL_COMPONENTS, type BuiltinToolId } from "@/app/toolRegistry";
import type { CatalogTool } from "@/app/catalog";
import { ToolActiveContext } from "@/hooks/useToolActive";
import { PluginFrame } from "@/components/plugins/PluginFrame";

// Memoized so a shell state change (sidebar search, menus, paste) does not re-render every open tool.
const ToolPanel = memo(function ToolPanel({ id, name, source }: { id: string; name: string; source: CatalogTool["source"] }) {
  if (source === "plugin") return <PluginFrame pluginId={id} name={name} />;
  const Component = TOOL_COMPONENTS[id as BuiltinToolId];
  return Component ? <Component /> : null;
});

// A hidden plugin tab cannot be focused or clicked by accident. React 18 has no `inert` prop type, so pass the attribute through a spread.
const INERT = { inert: "" } as Record<string, string>;

// Tools that use the shared editor layout (toolbar, panes, status bar) and fill the panel.
const WORKSPACE_TOOL_IDS = new Set<string>(["asn1-inspector", "checksum", "xml-inspector", "json-viewer", "text-compare", "diff-merge", "json-diff", "har-viewer", "jwt-decoder", "csv-json", "base64", "url-encoder", "code-formatter", "yaml-json", "string-inspector", "line-tools", "escape-tools", "random-string", "qr-reader", "image-metadata", "video-metadata", "secret-redactor", "token-counter", "ai-text-cleaner", "json-typescript", "certificate-decoder", "html-preview", "html-to-jsx", "svg-to-css", "curl-to-code", "php-tools", "compression", "lorem-generator", "case-converter", "regex-generator", "qr-generator", "date-format", "json-schema", "key-generator"]);

interface ToolHostProps {
  tools: CatalogTool[];
  selectedId: string | null;
}

// Every open tool stays mounted (hidden when not selected) so its state survives tab switches.
export function ToolHost({ tools, selectedId }: ToolHostProps) {
  return (
    <>
      {tools.map((tool) => (
        <section key={tool.id} id={`panel-${tool.id}`} role="tabpanel" aria-labelledby={`tab-${tool.id}`} hidden={selectedId !== tool.id} {...(tool.source === "plugin" && selectedId !== tool.id ? INERT : {})} className={`tool-panel ${tool.source === "plugin" || WORKSPACE_TOOL_IDS.has(tool.id) ? "tool-panel-editor" : "tool-panel-form"}`}>

          <ToolActiveContext.Provider value={selectedId === tool.id}>
            <Suspense fallback={<div className="p-8 text-muted-foreground">Loading {tool.name}…</div>}><ToolPanel id={tool.id} name={tool.name} source={tool.source} /></Suspense>
          </ToolActiveContext.Provider>
        </section>
      ))}
    </>
  );
}
