import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GripVertical, Plus, Puzzle, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AnchoredPanel } from "@/components/tools/diff-merge/Panels";
import { PermissionDialog } from "@/components/plugins/PermissionDialog";
import { MAX_PINNED, pickerItems, pinLimitMessage, type PickerItem } from "@/app/pinned";
import type { CatalogTool } from "@/app/catalog";
import { useReorder } from "@/app/useReorder";
import { installingLabel, useInstallFlow } from "@/plugins/useInstallFlow";
import { usePluginCatalog, type CatalogRow } from "@/plugins/usePluginCatalog";
import { searchTools } from "@/utils/tool-search";
import { cn } from "@/lib/utils";

const tagFor = (item: PickerItem) => (item.kind === "install" ? "Not installed" : item.tool.source === "plugin" ? "Plugin" : "Built-in");

interface PickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  items: PickerItem[];
  pinned: readonly string[];
  progress: Readonly<Record<string, number | null>>;
  onPick: (item: PickerItem) => void;
  /** Replaces the list's height limit (the wizard shows it in a taller panel). */
  listClassName?: string;
}

export function PickerBody({ items, pinned, progress, onPick, listClassName }: Omit<PickerProps, "open" | "onClose" | "anchorRef">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const visible = useMemo(() => {
    if (!query.trim()) return items;
    const matches = new Set(searchTools(items.map((item) => ({ id: item.id, name: item.name, category: item.kind === "tool" ? item.tool.category : item.row.entry.category, keywords: item.kind === "tool" ? item.tool.keywords : [] })), query).map((hit) => hit.id));
    return items.filter((item) => matches.has(item.id));
  }, [items, query]);
  const current = Math.min(active, Math.max(0, visible.length - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % Math.max(1, visible.length));
    } else if (event.key === "Enter" && visible[current]) {
      event.preventDefault();
      onPick(visible[current]);
    }
  };
  return (
    <>
      <div className="p-2.5">
        <div className="flex h-8 items-center gap-2 rounded-[7px] border border-border bg-background px-2.5 text-foreground focus-within:border-ring focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/.16)]">
          <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="pin-picker-list"
            aria-activedescendant={visible[current] ? `pin-option-${visible[current].id}` : undefined}
            aria-label="Search tools to pin"
            placeholder="Search tools…"
            className="min-w-0 flex-1 !border-transparent bg-transparent text-sm !shadow-none !outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div id="pin-picker-list" role="listbox" aria-label="Tools" className={cn("flex flex-col overflow-y-auto px-1.5 pb-1.5", listClassName ?? "max-h-[280px]")}>
        {visible.map((item, index) => {
          const isPinned = pinned.includes(item.id);
          const percent = progress[item.id];
          return (
            <div
              key={item.id}
              id={`pin-option-${item.id}`}
              role="option"
              aria-selected={isPinned}
              onClick={() => onPick(item)}
              onMouseMove={() => setActive(index)}
              className={cn("flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm", index === current && "bg-accent")}
            >
              {item.kind === "tool" ? (
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", isPinned ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden="true">
                  {isPinned && <span className="text-[10px] leading-none">✓</span>}
                </span>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
                {item.kind === "tool" ? <item.tool.icon size={13} /> : <Puzzle size={13} />}
              </span>
              <span className="flex-1 truncate">{item.name}</span>
              <span className="text-2xs text-muted-foreground">{percent !== undefined ? installingLabel(percent) : tagFor(item)}</span>
            </div>
          );
        })}
        {visible.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground" role="status">No tools match “{query.trim()}”.</p>}
      </div>
      <div className="border-t border-border px-3.5 py-[9px] text-xs text-muted-foreground">
        {pinned.length} of {MAX_PINNED} pinned · Enter to pin
      </div>
    </>
  );
}

interface PinnedEditorProps {
  tools: CatalogTool[];
  pinned: readonly string[];
  pinnedTools: CatalogTool[];
  startWithPicker: boolean;
  onPin: (id: string) => boolean;
  onUnpin: (id: string) => void;
  onMove: (id: string, targetId: string) => void;
  onPinInstalled: (id: string) => void;
  onOpenPlugin: (id: string) => void;
  onDone: () => void;
}

/** Home → Pinned tools in edit mode (design screen 2c). */
export function PinnedEditor({ tools, pinned, pinnedTools, startWithPicker, onPin, onUnpin, onMove, onPinInstalled, onOpenPlugin, onDone }: PinnedEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(startWithPicker);
  const addRef = useRef<HTMLButtonElement>(null);
  const { dragging, announcement, tileProps, gridProps } = useReorder({ tools: pinnedTools, onMove });
  const catalog = usePluginCatalog();
  const install = useInstallFlow({ onOpen: onOpenPlugin, refresh: catalog.refresh, onInstalled: onPinInstalled });

  const items = useMemo(() => pickerItems(tools, catalog.rows), [tools, catalog.rows]);

  const pick = (item: PickerItem) => {
    if (item.kind === "tool") {
      if (pinned.includes(item.id)) onUnpin(item.id);
      else onPin(item.id);
    } else if (pinned.length >= MAX_PINNED) {
      toast.error(pinLimitMessage);
    } else {
      setPickerOpen(false);
      install.request(item.row);
    }
  };

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Pinned tools</h2>
          <span className="text-xs text-muted-foreground">Drag to reorder</span>
        </span>
        <span className="flex gap-2">
          <Button ref={addRef} type="button" variant="secondary" size="sm" className="h-7 gap-[7px] px-3 text-sm" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
            <Plus size={14} aria-hidden="true" />
            Add tool
          </Button>
          <Button type="button" size="sm" className="h-7 px-3 text-sm" onClick={onDone}>Done</Button>
        </span>
      </div>

      <div {...gridProps} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {pinnedTools.map((tool, index) => (
          <div
            key={tool.id}
            role="group"
            aria-label={tool.name}
            aria-roledescription="reorderable tile"
            tabIndex={0}
            {...tileProps(tool, index)}
            className={cn(
              "flex h-14 cursor-grab items-center gap-2.5 rounded-lg border border-border bg-muted pl-1.5 pr-2.5 transition-[transform,box-shadow]",
              dragging === tool.id && "z-[1] translate-x-1.5 -translate-y-[3px] border-primary/60 shadow-[0_8px_24px_rgba(0,0,0,.35)]",
            )}
          >
            <GripVertical size={14} className="shrink-0 text-muted-foreground/60" aria-hidden="true" />
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] bg-primary/15 text-primary" aria-hidden="true">
              <tool.icon size={15} />
            </span>
            <span className="flex-1 truncate text-sm font-medium text-foreground">{tool.name}</span>
            <button
              type="button"
              aria-label={`Unpin ${tool.name}`}
              onClick={() => onUnpin(tool.id)}
              className="grid h-[22px] w-[22px] place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="Add tool to pinned"
          onClick={() => setPickerOpen(true)}
          className="flex h-14 items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-input text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          <Plus size={14} aria-hidden="true" />
          Add tool
        </button>
      </div>
      <p className="mt-3.5 text-xs text-muted-foreground">
        Pinned tools show on Home in both layouts. In the sidebar layout they also appear in a Pinned group at the top of the sidebar.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      <AnchoredPanel open={pickerOpen} onClose={() => setPickerOpen(false)} anchorRef={addRef} width={300} top={34} role="dialog">
        <PickerBody items={items} pinned={pinned} progress={install.progress} onPick={pick} />
      </AnchoredPanel>

      {install.pending && (
        <PermissionDialog
          key={install.pending.id}
          mode="install"
          entry={install.pending.entry}
          official={catalog.repos.some((item) => item.url === install.pending?.entry.repo && item.official)}
          verified={install.pending.verified}
          onCancel={install.cancel}
          onConfirm={install.confirm}
        />
      )}
    </div>
  );
}
