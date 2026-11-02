import { cn } from "@/lib/utils";
import { RUNTIME_LABEL } from "@/plugins/format";
import type { PluginRuntime } from "@/plugins/types";

export function RuntimeBadge({ runtime }: { runtime: PluginRuntime }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[5px] border px-[7px] text-2xs font-medium whitespace-nowrap",
        runtime === "web" ? "border-input bg-secondary text-muted-foreground" : "border-transparent bg-primary/15 text-primary",
      )}
    >
      {RUNTIME_LABEL[runtime]}
    </span>
  );
}
