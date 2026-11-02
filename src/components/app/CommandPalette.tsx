import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Download, Palette, Search, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchTools } from "@/utils/tool-search";
import type { CatalogTool } from "@/app/catalog";
import type { InstallableItem } from "@/hooks/usePaletteInstallables";

/** An action the palette offers next to the tools (for example "Open Plugins"). */
export interface PaletteCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

type PaletteItem = { kind: "tool"; tool: CatalogTool } | { kind: "command"; command: PaletteCommand } | { kind: "install"; item: InstallableItem };

interface CommandPaletteProps {
  open: boolean;
  tools: CatalogTool[];
  pinned: readonly string[];
  recents: string[];
  onClose: () => void;
  onSelectTool: (tool: CatalogTool) => void;
  /** Actions that match the query by label. Not shown while the field is empty. */
  commands?: readonly PaletteCommand[];
  /** Plugins and themes of the repositories that are not installed yet. Found by name, category or description; not shown while the field is empty. */
  installables?: readonly InstallableItem[];
  /** Text to put in the search field when the palette opens, for example from a link. */
  initialQuery?: string;
}

const MAX_RESULTS = 10;
const MAX_INSTALLABLES = 5;

function buildDefaultResults(
  tools: CatalogTool[],
  pinned: readonly string[],
  recents: string[],
): CatalogTool[] {
  const orderedIds = [...pinned, ...recents];
  const seenToolIds = new Set<string>();
  const prioritizedTools: CatalogTool[] = [];

  for (const toolId of orderedIds) {
    const tool = tools.find((entry) => entry.id === toolId);
    if (!tool || seenToolIds.has(tool.id)) {
      continue;
    }

    prioritizedTools.push(tool);
    seenToolIds.add(tool.id);
  }

  const remainingTools = tools
    .filter((tool) => !seenToolIds.has(tool.id))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...prioritizedTools, ...remainingTools].slice(0, MAX_RESULTS);
}

export function CommandPalette({
  open,
  tools,
  pinned,
  recents,
  onClose,
  onSelectTool,
  commands = [],
  installables = [],
  initialQuery = "",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const results = useMemo<PaletteItem[]>(() => {
    if (!query.trim()) {
      return buildDefaultResults(tools, pinned, recents).map((tool) => ({ kind: "tool", tool }));
    }

    const words = query.trim().toLowerCase().split(/\s+/);
    const matching = commands.filter((command) => words.every((word) => command.label.toLowerCase().includes(word)));
    return [
      ...searchTools(tools, query).slice(0, MAX_RESULTS).map((tool): PaletteItem => ({ kind: "tool", tool })),
      ...searchTools([...installables], query).slice(0, MAX_INSTALLABLES).map((item): PaletteItem => ({ kind: "install", item })),
      ...matching.map((command): PaletteItem => ({ kind: "command", command })),
    ];
  }, [commands, installables, pinned, query, recents, tools]);

  const choose = (item: PaletteItem) => {
    if (item.kind === "tool") onSelectTool(item.tool);
    else if (item.kind === "install") {
      onClose();
      item.item.run();
    } else item.command.run();
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    setQuery(initialQuery);

    const previousFocus = document.activeElement as HTMLElement | null;
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      previousFocus?.focus();
    };
  }, [open, initialQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) document.getElementById(`palette-result-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!results.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((currentIndex) => (currentIndex - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      choose(results[activeIndex] ?? results[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center modal-backdrop p-4 pt-[12vh]">
      <div
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key !== "Tab") return;
          const items = dialogRef.current?.querySelectorAll<HTMLElement>('input, button');
          if (!items?.length) return;
          const first = items[0]; const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        className="modal-surface command-surface w-full max-w-xl overflow-hidden"
      >
        <div className="modal-header px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              role="combobox"
              aria-label="Search tools"
              aria-expanded={open}
              aria-controls="palette-results"
              aria-activedescendant={results.length ? `palette-result-${Math.min(activeIndex, results.length - 1)}` : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search tools..."
              className="h-11 border-0 bg-transparent pl-10 pr-3 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="modal-body max-h-[50vh] overflow-y-auto p-2">
          {results.length ? (
            <div className="space-y-1" id="palette-results" role="listbox" aria-label="Tools">
              {results.map((item, index) => {
                const isActive = index === activeIndex;
                const Icon = item.kind === "tool" ? item.tool.icon : item.kind === "install" ? (item.item.kind === "theme" ? Palette : Download) : item.command.icon;
                const key = item.kind === "tool" ? item.tool.id : item.kind === "install" ? item.item.id : `command:${item.command.id}`;
                const title = item.kind === "tool" ? item.tool.name : item.kind === "install" ? `Install ${item.item.name}` : item.command.label;
                const subtitle = item.kind === "tool" ? item.tool.category : item.kind === "install" ? item.item.subtitle : "Command";

                return (
                  <button
                    key={key}
                    id={`palette-result-${index}`}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{title}</p>
                      <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No tools matched “{query}”.
            </div>
          )}
        </div>

        <div className="modal-footer flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
          <span>Use arrows to navigate</span>
          <span>Enter to open • Esc to close</span>
        </div>
      </div>

      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 -z-10"
        onClick={onClose}
      />
    </div>
  );
}
