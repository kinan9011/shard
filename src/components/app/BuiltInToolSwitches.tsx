import { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { ALL_TOOLS } from "@/app/toolRegistry";
import { categoryName, toolName } from "@/app/toolNames";
import { useT } from "@/i18n";
import { setToolHidden, useHiddenTools } from "@/app/useToolCatalog";

/** One show/hide switch per built-in tool. Hidden tools leave the sidebar, Home and search; nothing is uninstalled. */
export function BuiltInToolSwitches() {
  const t = useT();
  const hidden = useHiddenTools();
  const core = useMemo(() => ALL_TOOLS.filter((tool) => tool.kind === "core"), []);
  return (
    <ul aria-label={t("shell.builtIn.label")} className="flex flex-col border-t border-border">
      {core.map((tool) => (
        <li key={tool.id} className="flex h-10 items-center gap-3 border-b border-border px-3.5 last:border-b-0">
          <tool.icon size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <span className="flex-1 font-medium text-foreground">{toolName(tool)}</span>
          <span className="text-xs text-muted-foreground">{categoryName(tool.category)}</span>
          <Switch
            aria-label={t("shell.builtIn.show", { name: toolName(tool) })}
            checked={!hidden.has(tool.id)}
            onCheckedChange={(shown) => setToolHidden(tool.id, !shown)}
            className="h-[18px] w-8 border-0 p-0.5 [&>span]:size-3.5 [&>span]:data-[state=checked]:translate-x-3.5 rtl:[&>span]:data-[state=checked]:-translate-x-3.5"
          />
        </li>
      ))}
    </ul>
  );
}
