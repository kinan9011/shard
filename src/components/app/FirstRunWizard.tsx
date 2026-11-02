import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Info, Puzzle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BatchPermissionDialog } from "@/components/plugins/BatchPermissionDialog";
import { PermissionDialog } from "@/components/plugins/PermissionDialog";
import { PickerBody } from "@/components/app/PinnedEditor";
import { LayoutChoice } from "@/components/app/settings/LayoutChoice";
import { CORE_NAMES } from "@/app/firstRun";
import { MAX_PINNED, pickerItems, pinLimitMessage, type PickerItem } from "@/app/pinned";
import type { CatalogTool } from "@/app/catalog";
import { listRepos, repoBundles, syncRepos, type Repo } from "@/plugins/api";
import { formatSize } from "@/plugins/format";
import { permissionRows } from "@/plugins/permissions";
import { repoJob, useInstallFlow } from "@/plugins/useInstallFlow";
import { usePluginCatalog, type CatalogRow } from "@/plugins/usePluginCatalog";
import type { PluginBundle } from "@/plugins/types";
import { searchTools } from "@/utils/tool-search";
import { cn } from "@/lib/utils";
import type { Layout } from "@/utils/theme";

const OTHER = "Other";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

type Load = { phase: "loading" } | { phase: "ready"; repo: Repo; bundles: PluginBundle[] } | { phase: "offline"; reason: string };

/** A bundle with the plugins of it that can be installed now. */
interface BundleCardData extends PluginBundle {
  rows: CatalogRow[];
}

interface FirstRunWizardProps {
  tools: CatalogTool[];
  pinned: readonly string[];
  platform: string | undefined;
  /** The layout setting: step 1 changes it, and it applies at once. */
  layout: Layout;
  onLayout: (layout: Layout) => void;
  /** Pins a tool. False when the limit stopped it (a toast says so). */
  onPin: (id: string) => boolean;
  onUnpin: (id: string) => void;
  /** A plugin installed from the step 3 picker is pinned. */
  onPinInstalled: (id: string) => void;
  /** The "Open" action of an install toast. */
  onOpenPlugin: (id: string) => void;
  onFinish: () => void;
}

function Step({ number, label, state }: { number: number; label: string; state: "done" | "active" | "todo" }) {
  return (
    <li aria-current={state === "active" ? "step" : undefined} className={cn("flex h-10 items-center gap-3 rounded-[7px] px-2.5", state === "active" && "bg-secondary")}>
      <span
        className={cn(
          "grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-semibold",
          state === "done" && "bg-success/15 text-success",
          state === "active" && "bg-primary text-primary-foreground",
          state === "todo" && "border border-border text-muted-foreground",
        )}
      >
        {state === "done" ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : number}
      </span>
      <span className={cn(state === "active" ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
    </li>
  );
}

function PluginChoice({ row, checked, onToggle }: { row: CatalogRow; checked: boolean; onToggle: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-primary/45 bg-primary/[.14]" : "border-border bg-transparent hover:bg-accent/50",
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onToggle} aria-label={row.entry.name} />
      <span className={cn("grid size-4 shrink-0 place-items-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden="true">
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[7px] bg-primary/15 text-primary" aria-hidden="true">
        <Puzzle size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-foreground">{row.entry.name}</span>
        <span className="truncate text-xs text-muted-foreground">{row.entry.description}</span>
      </span>
    </label>
  );
}

const STACK_LIMIT = 3;

/** One bundle of the Launcher first run (08 B): stacked plugin icons, a checkbox, the name and the plugins in it. */
function BundleCard({ bundle, checked, onToggle }: { bundle: BundleCardData; checked: boolean; onToggle: () => void }) {
  // The ring around each icon is the card's own color, so the icons read as a stack on either card.
  const ring = checked ? "shadow-[0_0_0_2px_color-mix(in_srgb,hsl(var(--primary))_14%,hsl(var(--background)))]" : "shadow-[0_0_0_2px_hsl(var(--muted))]";
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-3.5 rounded-xl border p-[18px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-primary/55 bg-primary/[.14]" : "border-border bg-muted hover:border-primary/40",
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} aria-label={bundle.name} />
      <span className="flex items-center justify-between" aria-hidden="true">
        <span className="flex">
          {bundle.rows.slice(0, STACK_LIMIT).map((row, index) => (
            <span key={row.entry.id} className={cn("rounded-[9px]", ring, index > 0 && "-ml-1.5")}>
              <span className="grid size-[34px] place-items-center rounded-lg bg-primary/15 text-primary">
                <Puzzle size={17} />
              </span>
            </span>
          ))}
        </span>
        <span className={cn("grid size-4 shrink-0 place-items-center rounded", checked ? "bg-primary text-primary-foreground" : "border border-input")}>
          {checked && <Check size={11} strokeWidth={3} />}
        </span>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground">{bundle.name}</span>
        <span className="text-xs text-muted-foreground">{bundle.rows.map((row) => row.entry.name).join(", ")}</span>
      </span>
    </label>
  );
}

/** First run: screen 2a (Layout), 08 A (starter tools), 08 B (bundles, Launcher layout) and the pin step. */
export function FirstRunWizard({ tools, pinned, platform, layout, onLayout, onPin, onUnpin, onPinInstalled, onOpenPlugin, onFinish }: FirstRunWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // The Launcher offers bundles first; "Choose plugins one by one" (or a failed install) switches to the list.
  const [oneByOne, setOneByOne] = useState(false);
  const [selectedBundles, setSelectedBundles] = useState<ReadonlySet<string>>(new Set());
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState<readonly CatalogRow[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const catalog = usePluginCatalog();
  // Only plugins picked in step 3 are pinned when they finish installing, not the starter tools of step 2.
  const pinOnInstall = useRef(new Set<string>());
  const flow = useInstallFlow({
    onOpen: onOpenPlugin,
    refresh: catalog.refresh,
    onInstalled: (id) => {
      if (pinOnInstall.current.delete(id)) onPinInstalled(id);
    },
  });
  const attempt = useRef(0);
  const { refresh } = catalog;

  /** Reads the official repository's listing again, then the catalog. */
  const connect = useCallback(async () => {
    const mine = ++attempt.current;
    setLoad({ phase: "loading" });
    const settle = (next: Load) => mine === attempt.current && setLoad(next);
    try {
      const official = (await listRepos()).find((repo) => repo.official);
      if (!official) return settle({ phase: "offline", reason: "Shard Official is not in your repositories." });
      if (!official.enabled) return settle({ phase: "offline", reason: "Shard Official is turned off in Plugins → Repositories." });
      const synced = (await syncRepos(official.url)).find((repo) => repo.url === official.url) ?? official;
      if (synced.lastError) return settle({ phase: "offline", reason: synced.lastError });
      await refresh();
      // Bundles are a nicety: an index without them, or a failed read, falls back to the plain list.
      const bundles = await repoBundles(synced.url).catch(() => []);
      settle({ phase: "ready", repo: synced, bundles });
    } catch (failure) {
      settle({ phase: "offline", reason: message(failure) });
    }
  }, [refresh]);

  useEffect(() => {
    void connect();
    return () => {
      // Not a DOM ref, so the value read here is the one wanted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      attempt.current++;
    };
  }, [connect]);

  const officialUrl = load.phase === "ready" ? load.repo.url : null;
  const rows = useMemo(() => catalog.rows.filter((row) => row.entry.repo === officialUrl && row.action.kind === "install"), [catalog.rows, officialUrl]);
  const visible = useMemo(() => {
    if (!query.trim()) return rows;
    const hits = new Set(searchTools(rows.map((row) => ({ id: row.entry.id, name: row.entry.name, category: row.entry.category ?? OTHER, keywords: [row.entry.description] })), query).map((hit) => hit.id));
    return rows.filter((row) => hits.has(row.entry.id));
  }, [rows, query]);
  const groups = useMemo(() => {
    const byCategory = new Map<string, CatalogRow[]>();
    for (const row of visible) {
      const category = row.entry.category?.trim() || OTHER;
      byCategory.set(category, [...(byCategory.get(category) ?? []), row]);
    }
    return [...byCategory];
  }, [visible]);

  const bundleCards = useMemo<BundleCardData[]>(() => {
    if (load.phase !== "ready") return [];
    const byId = new Map(rows.map((row) => [row.entry.id, row]));
    return load.bundles
      .map((bundle) => ({ ...bundle, rows: bundle.plugins.flatMap((id) => byId.get(id) ?? []) }))
      .filter((bundle) => bundle.rows.length > 0);
  }, [load, rows]);
  // 08 B: only in the Launcher layout, and not once the list was asked for. While loading it shows the same screen, so it does not flash the list.
  const showBundles = layout === "launcher" && step === 2 && !oneByOne && (load.phase === "loading" || (load.phase === "ready" && bundleCards.length > 0));
  const chosenBundles = bundleCards.filter((bundle) => selectedBundles.has(bundle.id));
  const chosen = showBundles
    ? [...new Map(chosenBundles.flatMap((bundle) => bundle.rows).map((row) => [row.entry.id, row])).values()]
    : rows.filter((row) => selected.has(row.entry.id));
  const bytes = chosen.reduce((sum, row) => sum + (row.entry.size ?? 0), 0);
  const toggleBundle = (id: string) =>
    setSelectedBundles((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  /** Back to the plugin list, with what the bundles picked ticked. */
  const chooseOneByOne = () => {
    setSelected(new Set(chosen.map((row) => row.entry.id)));
    setOneByOne(true);
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (jobs: readonly CatalogRow[], grants: Record<string, string[]>) => {
    setInstalling(true);
    let installed: boolean[];
    try {
      // Rust installs one at a time; each job reports its own failure with a toast.
      installed = await Promise.all(jobs.map((row) => flow.install(repoJob(row), grants[row.entry.id] ?? [])));
    } finally {
      setInstalling(false);
    }
    const failed = jobs.filter((_, index) => !installed[index]);
    // Stay on step 2 when something failed, with the failed ones still ticked, so Install and continue retries them.
    setSelected(new Set(failed.map((row) => row.entry.id)));
    if (failed.length === 0) setStep(3);
    else setOneByOne(true);
  };

  const installAndContinue = () => {
    if (chosen.length === 0 || installing) return;
    // Nothing to approve when no plugin asks for more than the sandbox: no dialog, as everywhere else.
    if (chosen.every((row) => permissionRows(row.entry).every((item) => item.key === "wasm"))) void run(chosen, {});
    else setAsking(chosen);
  };

  const pick = (item: PickerItem) => {
    if (item.kind === "tool") {
      if (pinned.includes(item.id)) onUnpin(item.id);
      else onPin(item.id);
    } else if (pinned.length >= MAX_PINNED) {
      toast.error(pinLimitMessage);
    } else {
      pinOnInstall.current.add(item.id);
      flow.request(item.row);
    }
  };
  const items = useMemo(() => pickerItems(tools, catalog.rows), [tools, catalog.rows]);

  const mac = platform === "darwin";
  const footerStatus = installing ? `Installing ${plural(chosen.length, "plugin", "plugins")}…` : null;
  const dialogs = (
    <>
      {asking && load.phase === "ready" && (
        <BatchPermissionDialog
          entries={asking.map((row) => ({ ...row.entry }))}
          repoName={load.repo.name}
          onCancel={() => setAsking(null)}
          onConfirm={(grants) => {
            const jobs = asking;
            setAsking(null);
            void run(jobs, grants);
          }}
        />
      )}
      {flow.pending && (
        <PermissionDialog
          key={flow.pending.id}
          mode="install"
          entry={flow.pending.entry}
          official={catalog.repos.some((repo) => repo.url === flow.pending?.entry.repo && repo.official)}
          verified={flow.pending.verified}
          onCancel={() => {
            // Not asked for after all: it must not be pinned if it is installed some other way.
            pinOnInstall.current.delete(flow.pending?.id ?? "");
            flow.cancel();
          }}
          onConfirm={flow.confirm}
        />
      )}
    </>
  );

  // 08 B: the Launcher's first run has no step list, a centered column of bundles.
  if (showBundles) {
    return (
      <div className="relative flex h-screen flex-col items-center gap-[26px] overflow-hidden bg-background pt-12 text-foreground" data-platform={platform}>
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-7" />
        <div className={cn("flex flex-col items-center gap-2.5 text-center", mac && "pt-4")}>
          <span className="mb-2 scale-[1.6]">
            <span className="grid size-[22px] place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground" aria-hidden="true">D</span>
          </span>
          <h1 className="text-2xl font-semibold">Welcome to Shard</h1>
          <p className="text-muted-foreground">Start with a set of tools. The {CORE_NAMES.length} built-in tools are always included, and you can add or remove plugins any time.</p>
        </div>
        <div className="min-h-0 w-[820px] max-w-full flex-1 overflow-y-auto">
          {load.phase === "loading" ? (
            <p className="text-center text-muted-foreground" role="status">Loading plugins…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3.5">
              {bundleCards.map((bundle) => (
                <BundleCard key={bundle.id} bundle={bundle} checked={selectedBundles.has(bundle.id)} onToggle={() => toggleBundle(bundle.id)} />
              ))}
            </div>
          )}
          <div className="py-[18px] text-center">
            <button type="button" onClick={chooseOneByOne} disabled={installing} className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              Choose plugins one by one
            </button>
          </div>
        </div>
        <div className="flex w-[820px] max-w-full items-center gap-2.5 border-t border-border pb-7 pt-4">
          <span className="flex-1 text-muted-foreground" role="status">
            {footerStatus ?? `${plural(chosenBundles.length, "bundle", "bundles")} · ${plural(chosen.length, "plugin", "plugins")}${bytes > 0 ? ` · ${formatSize(bytes)}` : ""}`}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-[30px] px-3 text-sm text-muted-foreground" disabled={installing} onClick={() => setStep(3)}>Skip</Button>
          <Button type="button" size="sm" className="h-[30px] px-3 text-sm" disabled={chosen.length === 0 || installing} onClick={installAndContinue}>Install and continue</Button>
        </div>
{dialogs}
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-background text-foreground" data-platform={platform}>
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-7" />
      <aside className={cn("flex w-[300px] shrink-0 flex-col gap-7 border-r border-border p-7", mac && "pt-14")}>
        <div className="flex items-center gap-2.5">
          <span className="grid size-[22px] place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground" aria-hidden="true">D</span>
          <span className="font-semibold">Shard</span>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Welcome</h1>
          <p className="text-muted-foreground">Set up the tools you need. You can change everything later in {step === 1 ? "Settings" : "Plugins"}.</p>
        </div>
        <ol aria-label="Setup steps" className="flex flex-col gap-1">
          <Step number={1} label="Layout" state={step === 1 ? "active" : "done"} />
          <Step number={2} label="Pick starter tools" state={step === 2 ? "active" : step === 3 ? "done" : "todo"} />
          <Step number={3} label="Pin tools to Home" state={step === 3 ? "active" : "todo"} />
        </ol>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {step === 1 ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-12 pt-10">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">How do you want to move between tools?</h2>
                <p className="text-muted-foreground">You can switch at any time in Settings → Appearance.</p>
              </div>
              <LayoutChoice layout={layout} onLayout={onLayout} className="gap-4" />
            </div>
            <div className="flex items-center gap-2.5 border-t border-border px-12 py-3.5">
              <span className="flex-1 text-muted-foreground">Step 1 of 3</span>
              <Button type="button" size="sm" className="h-[30px] px-3 text-sm" onClick={() => setStep(2)}>Continue</Button>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden px-10 pt-8">
              <div className="flex items-end justify-between gap-5">
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-semibold">Pick your starter tools</h2>
                  <p className="text-muted-foreground">Plugins come from the Shard Official repository. The {CORE_NAMES.length} built-in tools are always included.</p>
                </div>
                {load.phase === "ready" && (
                  <div className="flex h-8 w-[260px] shrink-0 items-center gap-[9px] rounded-[7px] border border-border bg-background px-2.5 text-muted-foreground focus-within:border-ring focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/.16)]">
                    <Search size={15} className="shrink-0" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="Search plugins"
                      placeholder="Search plugins"
                      className="min-w-0 flex-1 !border-transparent bg-transparent text-foreground !shadow-none !outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {load.phase === "loading" && <p className="text-muted-foreground" role="status">Loading plugins…</p>}
                {load.phase === "offline" && (
                  <div role="alert" className="flex max-w-[420px] flex-col gap-3 rounded-lg border border-border bg-secondary p-4">
                    <h3 className="font-semibold text-foreground">Couldn't reach Shard Official</h3>
                    <p className="break-words text-xs text-muted-foreground">{load.reason}</p>
                    <p className="text-xs text-muted-foreground">You can add plugins later from Plugins. The built-in tools work without them.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="h-[30px] px-3 text-sm" onClick={() => void connect()}>Retry</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-[30px] px-3 text-sm text-muted-foreground" onClick={() => setStep(3)}>Skip</Button>
                    </div>
                  </div>
                )}
                {load.phase === "ready" && rows.length === 0 && <p className="text-muted-foreground" role="status">{query.trim() ? `No plugins match “${query.trim()}”.` : "Shard Official has no plugins to add right now."}</p>}
                {load.phase === "ready" && groups.length > 0 && (
                  <div className="grid grid-cols-1 gap-x-7 gap-y-[18px] md:grid-cols-2">
                    {groups.map(([category, members]) => (
                      <section key={category} aria-label={category} className="flex flex-col gap-1">
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{category}</h3>
                        {members.map((row) => (
                          <PluginChoice key={row.entry.id} row={row} checked={selected.has(row.entry.id)} onToggle={() => toggle(row.entry.id)} />
                        ))}
                      </section>
                    ))}
                  </div>
                )}
                <p className="mb-6 mt-[18px] flex items-center gap-2.5 rounded-lg bg-secondary p-3">
                  <Info size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="text-muted-foreground">Built-in: </span>
                    {CORE_NAMES.join(", ")}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border px-10 py-3.5">
              <span className="flex-1 text-muted-foreground" role="status">
                {footerStatus ?? `Step 2 of 3 · ${plural(chosen.length, "plugin", "plugins")} selected${bytes > 0 ? ` · ${formatSize(bytes)}` : ""}`}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-[30px] px-3 text-sm text-muted-foreground" disabled={installing} onClick={() => setStep(3)}>Skip</Button>
              <Button type="button" size="sm" className="h-[30px] px-3 text-sm" disabled={chosen.length === 0 || installing} onClick={installAndContinue}>Install and continue</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden px-10 pt-8">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">Pin tools to Home</h2>
                <p className="text-muted-foreground">Pinned tools show on Home and at the top of the sidebar. You can change them later.</p>
              </div>
              <div className="mb-6 flex min-h-0 max-w-[460px] flex-col overflow-hidden rounded-lg border border-border bg-card">
                <PickerBody items={items} pinned={pinned} progress={flow.progress} onPick={pick} listClassName="min-h-0 flex-1" />
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border px-10 py-3.5">
              <span className="flex-1 text-muted-foreground">Step 3 of 3</span>
              <Button type="button" size="sm" className="h-[30px] px-3 text-sm" onClick={onFinish}>Done</Button>
            </div>
          </>
        )}
      </div>

{dialogs}
    </div>
  );
}
