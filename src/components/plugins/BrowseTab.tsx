import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Puzzle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo } from "@/plugins/api";
import type { PluginRuntime } from "@/plugins/types";
import { rowKey, type CatalogAction, type CatalogRow } from "@/plugins/usePluginCatalog";
import { installingLabel } from "@/plugins/useInstallFlow";
import { PluginDetail } from "./PluginDetail";
import { RuntimeBadge } from "./RuntimeBadge";

type RuntimeChip = "web" | "wasm";
type Sort = "name" | "newest";

const OTHER = "Other";
const chipOf = (runtime: PluginRuntime): RuntimeChip => (runtime === "web" ? "web" : "wasm");
const categoryOf = (row: CatalogRow) => row.entry.category?.trim() || OTHER;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const selectClass = "h-[30px] rounded-md border border-input bg-background px-2 text-sm text-foreground";

interface BrowseTabProps {
  rows: readonly CatalogRow[];
  repos: readonly Repo[];
  loading: boolean;
  error: string | null;
  onInstall: (row: CatalogRow) => void;
  /** Uninstalls a plugin after the detail has confirmed it. */
  onUninstall?: (row: CatalogRow) => void;
  /** The plugins being installed: id → percent, or null when the size is unknown. */
  progress: Readonly<Record<string, number | null>>;
  /** "cards" is the Launcher layout: a card grid with category chips, and the detail opens as a page (`onOpen`). */
  variant?: "list" | "cards";
  onOpen?: (row: CatalogRow) => void;
}

// Update stays disabled: it goes through the permission dialog in "update" mode, which the Installed tab brings.
function RowAction({ action, progress, onInstall }: { action: CatalogAction; progress: number | null | undefined; onInstall: () => void }) {
  if (action.kind === "installed" && progress === undefined) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-[5px] bg-success/15 px-[7px] text-2xs font-medium text-success">
        <Check size={12} aria-hidden="true" />
        Installed
      </span>
    );
  }
  const installing = progress !== undefined;
  return (
    <button
      type="button"
      disabled={installing || action.kind !== "install"}
      aria-busy={installing || undefined}
      onClick={onInstall}
      className="relative z-10 inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground disabled:opacity-60"
    >
      {action.kind === "install" && !installing && <Download size={14} aria-hidden="true" />}
      {installing ? installingLabel(progress) : action.kind === "update" ? `Update to ${action.to}` : "Install"}
    </button>
  );
}

function PluginRow({ row, onSelect, onInstall, progress }: { row: CatalogRow; onSelect: () => void; onInstall: () => void; progress: number | null | undefined }) {
  const { entry } = row;
  return (
    <div data-plugin-row className="relative flex h-[66px] shrink-0 items-center gap-3.5 rounded-lg px-4 hover:bg-secondary/60">
      <span className="grid size-[38px] shrink-0 place-items-center rounded-[9px] bg-accent text-primary">
        <Puzzle size={18} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {/* The name is the row's button; its ::after covers the row, the action button sits above it. */}
          <button type="button" onClick={onSelect} data-testid="plugin-name" className="font-semibold text-foreground after:absolute after:inset-0 after:content-['']">
            {entry.name}
          </button>
          <RuntimeBadge runtime={entry.runtime} />
        </span>
        <span className="truncate text-sm text-muted-foreground">{entry.description}</span>
      </div>
      <span className="w-[150px] shrink-0 truncate text-xs text-muted-foreground">{`${entry.repoName} · ${entry.version}`}</span>
      <span className="flex w-[130px] shrink-0 justify-end">
        <RowAction action={row.action} progress={progress} onInstall={onInstall} />
      </span>
    </div>
  );
}

function CompactRow({ row, selected, onSelect }: { row: CatalogRow; selected: boolean; onSelect: () => void }) {
  const { entry } = row;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn("flex h-[54px] shrink-0 items-center gap-3 rounded-lg px-2.5 text-left", selected ? "bg-secondary" : "hover:bg-secondary/60")}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
        <Puzzle size={16} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-foreground">{entry.name}</span>
        <span className="truncate text-xs text-muted-foreground">{entry.repoName}</span>
      </span>
      {row.action.kind === "update" && <span role="img" aria-label="Update available" className="size-[7px] shrink-0 rounded-full bg-primary" />}
      {row.action.kind === "installed" && <Check size={14} strokeWidth={2.5} role="img" aria-label="Installed" className="shrink-0 text-success" />}
    </button>
  );
}

function PluginCard({ row, onOpen, onInstall, progress }: { row: CatalogRow; onOpen: () => void; onInstall: () => void; progress: number | null | undefined }) {
  const { entry } = row;
  return (
    <div data-plugin-card data-plugin-key={rowKey(row)} className="relative flex flex-col gap-3 rounded-[10px] border border-border bg-secondary p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
          <Puzzle size={20} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col">
          {/* The name is the card's button; its ::after covers the card, the action button sits above it. */}
          <button type="button" onClick={onOpen} data-testid="plugin-name" className="truncate text-left font-semibold text-foreground after:absolute after:inset-0 after:content-['']">
            {entry.name}
          </button>
          <span className="truncate text-xs text-muted-foreground">{`${entry.repoName} · v${entry.version}`}</span>
        </div>
      </div>
      <p className="line-clamp-2 min-h-[38px] text-muted-foreground">{entry.description}</p>
      <div className="flex items-center justify-between">
        <RuntimeBadge runtime={entry.runtime} />
        <RowAction action={row.action} progress={progress} onInstall={onInstall} />
      </div>
    </div>
  );
}

function FilterTitle({ children, id }: { children: string; id: string }) {
  return (
    <span id={id} className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">
      {children}
    </span>
  );
}

export function BrowseTab({ rows, repos, loading, error, onInstall, onUninstall, progress, variant = "list", onOpen }: BrowseTabProps) {
  const [selectedRepo, setRepo] = useState("");
  // A repository that was removed or turned off must not leave an empty list behind.
  const repo = repos.some((item) => item.url === selectedRepo) ? selectedRepo : "";
  const [category, setCategory] = useState("");
  const [runtimes, setRuntimes] = useState<ReadonlySet<RuntimeChip>>(new Set<RuntimeChip>(["web", "wasm"]));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [selectedKey, setSelectedKey] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

  // Category counts follow the repository, the other filters then narrow the list.
  const inRepo = useMemo(() => rows.filter((row) => !repo || row.entry.repo === repo), [rows, repo]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of inRepo) counts.set(categoryOf(row), (counts.get(categoryOf(row)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inRepo]);
  // A category that vanished with a repository change must not leave an empty list behind.
  const activeCategory = categories.some(([name]) => name === category) ? category : "";

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = inRepo.filter(
      (row) =>
        (!activeCategory || categoryOf(row) === activeCategory) &&
        runtimes.has(chipOf(row.entry.runtime)) &&
        (!needle || [row.entry.name, row.entry.description, row.entry.id, categoryOf(row)].some((text) => text.toLowerCase().includes(needle))),
    );
    return list.sort((a, b) =>
      sort === "newest" ? (b.entry.released ?? "").localeCompare(a.entry.released ?? "") || a.entry.name.localeCompare(b.entry.name) : a.entry.name.localeCompare(b.entry.name),
    );
  }, [inRepo, activeCategory, runtimes, query, sort]);

  // A plugin that left the catalog (repository removed or turned off) closes its detail pane.
  const selected = rows.find((row) => rowKey(row) === selectedKey);
  const select = (row: CatalogRow) => setSelectedKey(rowKey(row) === selectedKey ? "" : rowKey(row));

  // Closing the pane swaps the layout, which drops the focused element: put focus on the search box.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (hadSelection.current && !selected) searchInput.current?.focus();
    hadSelection.current = !!selected;
  }, [selected]);

  const shownRepos = new Set(shown.map((row) => row.entry.repo)).size;
  const toggleRuntime = (chip: RuntimeChip) =>
    setRuntimes((current) => {
      const next = new Set(current);
      if (!next.delete(chip)) next.add(chip);
      return next;
    });

  const notice = error && rows.length === 0 ? (
    <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>
  ) : loading && rows.length === 0 ? (
    <p className="px-4 py-6 text-sm text-muted-foreground">Loading plugins…</p>
  ) : rows.length === 0 ? (
    <p className="px-4 py-6 text-sm text-muted-foreground">No plugins yet. Add a repository to see its plugins.</p>
  ) : shown.length === 0 ? (
    <p className="px-4 py-6 text-sm text-muted-foreground">No plugins match.</p>
  ) : null;
  const errorBanner = error && rows.length > 0 ? <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p> : null;

  const searchBox = (className: string) => (
    <label className={cn("flex h-8 items-center gap-[9px] rounded-[7px] border border-input bg-background px-[11px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring", className)}>
      <Search size={15} aria-hidden="true" className="shrink-0" />
      <input
        ref={searchInput}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search plugins"
        aria-label="Search plugins"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );

  if (variant === "cards") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto px-7 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {searchBox("w-[300px] max-w-full shrink-0")}
          <select aria-label="Repository" className={selectClass} value={repo} onChange={(event) => setRepo(event.target.value)}>
            <option value="">All repositories</option>
            {repos.map((item) => (
              <option key={item.url} value={item.url}>
                {item.name}
              </option>
            ))}
          </select>
          <div role="group" aria-label="Category" className="ml-auto flex flex-wrap gap-1.5">
            {["", ...categories.map(([name]) => name)].map((name) => (
              <button
                key={name || "all"}
                type="button"
                aria-pressed={activeCategory === name}
                onClick={() => setCategory(name)}
                className={cn(
                  "inline-flex h-7 items-center rounded-full px-3 text-xs",
                  activeCategory === name ? "bg-foreground font-semibold text-background" : "border border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {name || "All"}
              </button>
            ))}
          </div>
        </div>
        {errorBanner}
        {notice}
        {!notice && (
          <div className="grid grid-cols-3 gap-3">
            {shown.map((row) => (
              <PluginCard key={rowKey(row)} row={row} onOpen={() => onOpen?.(row)} onInstall={() => onInstall(row)} progress={progress[row.entry.id]} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex min-w-0 flex-1" onKeyDown={(event) => {
          // Escape in the search box clears the box, it does not close the pane.
          if (event.key === "Escape" && !event.defaultPrevented && !(event.target instanceof HTMLInputElement)) setSelectedKey("");
        }}>
        <div className="flex w-[380px] shrink-0 flex-col gap-2 overflow-hidden border-r border-border px-3 py-3.5">
          {searchBox("w-full shrink-0")}
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {errorBanner}
            {notice}
            {!notice && shown.map((row) => <CompactRow key={rowKey(row)} row={row} selected={row === selected} onSelect={() => select(row)} />)}
          </div>
        </div>
        <PluginDetail key={rowKey(selected)} row={selected} progress={progress[selected.entry.id]} onInstall={() => onInstall(selected)} onUninstall={onUninstall && (() => onUninstall(selected))} official={repos.some((item) => item.url === selected.entry.repo && item.official)} />
      </div>
    );
  }

  return (
    <>
      <div className="flex w-[200px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-border py-[18px] pl-7 pr-4">
        <div className="flex flex-col gap-1.5">
          <FilterTitle id="plugins-filter-repo">Repository</FilterTitle>
          <select aria-labelledby="plugins-filter-repo" className={selectClass} value={repo} onChange={(event) => setRepo(event.target.value)}>
            <option value="">All repositories</option>
            {repos.map((item) => (
              <option key={item.url} value={item.url}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-labelledby="plugins-filter-category" className="flex flex-col gap-0.5">
          <span className="mb-1"><FilterTitle id="plugins-filter-category">Category</FilterTitle></span>
          {[[ "", inRepo.length ] as const, ...categories].map(([name, count]) => (
            <button
              key={name || "all"}
              type="button"
              aria-pressed={activeCategory === name}
              onClick={() => setCategory(name)}
              className={cn(
                "flex h-7 items-center justify-between rounded-md px-2 text-sm",
                activeCategory === name ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <span className="truncate">{name || "All"}</span>
              <span className="text-xs">{count}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-labelledby="plugins-filter-runtime" className="flex flex-col gap-2">
          <FilterTitle id="plugins-filter-runtime">Runtime</FilterTitle>
          {([["web", "Web"], ["wasm", "Web + WASM"]] as const).map(([chip, label]) => (
            <button key={chip} type="button" role="checkbox" aria-checked={runtimes.has(chip)} onClick={() => toggleRuntime(chip)} className="flex items-center gap-2 text-sm text-foreground">
              <span
                aria-hidden="true"
                className={cn("grid size-4 shrink-0 place-items-center rounded border", runtimes.has(chip) ? "border-primary bg-primary text-primary-foreground" : "border-input")}
              >
                {runtimes.has(chip) && <Check size={12} strokeWidth={3} />}
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-4 pt-3.5">
        <div className="flex items-center gap-2.5 pb-2.5">
          {searchBox("w-[340px] max-w-full shrink")}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">{`${plural(shown.length, "plugin", "plugins")} from ${plural(shownRepos, "repository", "repositories")}`}</span>
            <select aria-label="Sort" className={selectClass} value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="name">Sort: Name</option>
              <option value="newest">Sort: Newest</option>
            </select>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
          {errorBanner}
          {notice}
          {!notice && shown.map((row) => <PluginRow key={rowKey(row)} row={row} onSelect={() => select(row)} onInstall={() => onInstall(row)} progress={progress[row.entry.id]} />)}
        </div>
      </div>
    </>
  );
}
