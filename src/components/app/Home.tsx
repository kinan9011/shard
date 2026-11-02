import { useState } from "react";
import { ChevronRight, Download, Plus, Puzzle, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CatalogTool } from "@/app/catalog";
import type { PortedTool } from "@/app/legacyMigration";
import { PinnedEditor } from "@/components/app/PinnedEditor";
import { PortedToolBanners } from "@/components/app/PortedToolBanners";
import type { PluginUpdate } from "@/plugins/api";
import { listNames } from "@/plugins/format";

function HomeToolCard({ tool, onSelect }: { tool: CatalogTool; onSelect: (tool: CatalogTool) => void }) {
  return (
    <button
      onClick={() => onSelect(tool)}
      className="home-tool-row" aria-label={tool.name} data-tool={tool.id}
    >
      <div
        className="home-tool-icon"
      >
        <tool.icon className="w-4 h-4 text-primary" />
      </div>
      <span className="font-medium text-foreground text-sm">
        {tool.name}
      </span>
      {tool.source === "plugin" && <span className="ml-auto pr-1 text-2xs text-muted-foreground">Plugin</span>}
      {tool.source !== "plugin" && <ChevronRight size={14} className="home-tool-arrow" aria-hidden="true" />}
    </button>
  );
}

function HomeSection({ title, tools, onSelect, action }: { title: string; tools: CatalogTool[]; onSelect: (tool: CatalogTool) => void; action?: React.ReactNode }) {
  return (
    <div>
      {action ? (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          {title}
        </h2>
      )}
      <div className="home-tool-list grid grid-cols-1 sm:grid-cols-2">
        {tools.map((tool) => (
          <HomeToolCard key={tool.id} tool={tool} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

interface HomeProps {
  recentTools: CatalogTool[];
  /** Every tool in the catalog: the pin picker lists them. */
  tools: CatalogTool[];
  pinned: readonly string[];
  pinnedTools: CatalogTool[];
  /** Pins a tool. False when the limit stopped it (a toast says so). */
  onPin: (id: string) => boolean;
  onUnpin: (id: string) => void;
  onMovePinned: (id: string, targetId: string) => void;
  /** A plugin installed from the picker is pinned. */
  onPinInstalled: (id: string) => void;
  onOpenPlugin: (id: string) => void;
  quickAccessTools: CatalogTool[];
  platform: string | undefined;
  paletteShortcutLabel: string;
  onSelect: (tool: CatalogTool) => void;
  onOpenPalette: () => void;
  /** Installed plugins that have a newer version. */
  updates: readonly PluginUpdate[];
  /** Opens Plugins → Installed. */
  onReviewUpdates: () => void;
  /** Every built-in is hidden and no plugin is installed: Home offers the ways to add tools. */
  empty: boolean;
  onBrowsePlugins: () => void;
  onInstallFromFile: () => void;
  /** An existing user: the one-time "Plugins are here" banner. */
  pluginsIntro: boolean;
  onDismissPluginsIntro: () => void;
  /** Tools that moved out of the app and that the user had pinned or used: "X is now a plugin. Install". */
  portedOffers: readonly PortedTool[];
  onDismissPorted: (id: string) => void;
}

export function UpdateBanner({ updates, onReview }: { updates: readonly PluginUpdate[]; onReview: () => void }) {
  return (
    <div className="mb-6 mt-2 flex items-center gap-3 rounded-lg bg-primary/[.14] px-3 py-2.5 text-sm text-foreground" role="status">
      <RefreshCw size={16} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">
        {updates.length} plugin {updates.length === 1 ? "update is" : "updates are"} ready: {listNames(updates.map((update) => update.name))}.
      </span>
      <Button type="button" variant="secondary" size="sm" className="h-7 px-3 text-sm" onClick={onReview}>Review</Button>
    </div>
  );
}

export function PluginsIntroBanner({ onBrowse, onDismiss }: { onBrowse: () => void; onDismiss: () => void }) {
  return (
    <div className="mb-6 mt-2 flex items-center gap-3 rounded-lg bg-primary/[.14] px-3 py-2.5 text-sm text-foreground" role="status">
      <Puzzle size={16} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">
        <strong className="font-semibold">Plugins are here.</strong> Add tools from the Shard Official repository, a zip file, a folder or a repo URL.
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 px-3 text-sm"
        onClick={() => {
          onDismiss();
          onBrowse();
        }}
      >
        Browse plugins
      </Button>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function EmptyHome({ onBrowse, onInstall, className = "mx-auto h-full max-w-[420px]" }: { onBrowse: () => void; onInstall: () => void; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        <Puzzle size={22} aria-hidden="true" />
      </span>
      <h1 className="mt-1 text-lg font-semibold text-foreground">No tools installed yet</h1>
      <p className="text-sm text-muted-foreground">
        Install plugins from the Shard Official repository, or add your own from a zip file, a folder or a repo URL.
      </p>
      <div className="mt-1.5 flex gap-2">
        <Button type="button" size="sm" className="h-[30px] gap-[7px] px-3 text-sm" onClick={onBrowse}>
          <Puzzle size={14} aria-hidden="true" />
          Browse plugins
        </Button>
        <Button type="button" variant="secondary" size="sm" className="h-[30px] gap-[7px] px-3 text-sm" onClick={onInstall}>
          <Download size={14} aria-hidden="true" />
          Install from file or URL
        </Button>
      </div>
    </div>
  );
}

export function Home({ recentTools, tools, pinned, pinnedTools, onPin, onUnpin, onMovePinned, onPinInstalled, onOpenPlugin, quickAccessTools, platform, paletteShortcutLabel, onSelect, onOpenPalette, updates, onReviewUpdates, empty, onBrowsePlugins, onInstallFromFile, pluginsIntro, onDismissPluginsIntro, portedOffers, onDismissPorted }: HomeProps) {
  const [editing, setEditing] = useState(false);
  const [pickerFirst, setPickerFirst] = useState(false);
  if (empty) return <EmptyHome onBrowse={onBrowsePlugins} onInstall={onInstallFromFile} />;
  const edit = (picker: boolean) => {
    setPickerFirst(picker);
    setEditing(true);
  };
  return (
    <div className="workspace-home max-w-3xl mx-auto">
      {/* Welcome */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-2">
          Your workspace
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Open a tool, or search with the command palette.
        </p>
      </div>

      <button type="button" className={`home-search ${editing ? "opacity-50" : ""}`} disabled={editing} onClick={onOpenPalette}>
        <Search size={17} aria-hidden="true" />
        <span>Find a tool…</span>
        {!editing && <kbd>{paletteShortcutLabel}</kbd>}
      </button>
      {!editing && (
        <p className="home-paste-hint">
          Or paste a JWT, JSON, a URL, a timestamp, or other text here with {platform === "darwin" ? "⌘V" : "Ctrl+V"} to find the right tool.
        </p>
      )}
      {!editing && pluginsIntro && <PluginsIntroBanner onBrowse={onBrowsePlugins} onDismiss={onDismissPluginsIntro} />}
      {!editing && <PortedToolBanners offers={portedOffers} onDismiss={onDismissPorted} onOpenPlugin={onOpenPlugin} />}
      {!editing && updates.length > 0 && <UpdateBanner updates={updates} onReview={onReviewUpdates} />}
      <div className="home-sections space-y-8">
        {editing ? (
          <PinnedEditor
            tools={tools}
            pinned={pinned}
            pinnedTools={pinnedTools}
            startWithPicker={pickerFirst}
            onPin={onPin}
            onUnpin={onUnpin}
            onMove={onMovePinned}
            onPinInstalled={onPinInstalled}
            onOpenPlugin={onOpenPlugin}
            onDone={() => setEditing(false)}
          />
        ) : pinnedTools.length > 0 ? (
          <HomeSection
            title="Pinned tools"
            tools={pinnedTools}
            onSelect={onSelect}
            action={<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-sm text-muted-foreground" onClick={() => edit(false)}>Edit</Button>}
          />
        ) : (
          <div>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Pinned tools</h2>
            <button
              type="button"
              onClick={() => edit(true)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-input text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Plus size={14} aria-hidden="true" />
              Pin tools to Home
            </button>
          </div>
        )}
        {!editing && recentTools.length > 0 && <HomeSection title="Recently Used" tools={recentTools} onSelect={onSelect} />}
        {!editing && <HomeSection title="Quick Access" tools={quickAccessTools} onSelect={onSelect} />}
      </div>
    </div>
  );
}
