import { useState } from "react";
import { ChevronRight, Download, Plus, Puzzle, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toolTint, type CatalogTool } from "@/app/catalog";
import { toolName } from "@/app/toolNames";
import { useT } from "@/i18n";
import { PinnedEditor } from "@/components/app/PinnedEditor";
import type { PluginUpdate } from "@/plugins/api";
import { listNames } from "@/plugins/format";

function HomeToolCard({ tool, onSelect }: { tool: CatalogTool; onSelect: (tool: CatalogTool) => void }) {
  const t = useT();
  const name = toolName(tool);
  return (
    <button
      onClick={() => onSelect(tool)}
      className="home-tool-row" aria-label={name} data-tool={tool.id}
    >
      <div
        className="home-tool-icon" data-tint={toolTint(tool.id)}
      >
        <tool.icon className="w-4 h-4" />
      </div>
      <span className="font-medium text-foreground text-sm">
        {name}
      </span>
      {tool.source === "plugin" && <span className="ms-auto pe-1 text-2xs text-muted-foreground">{t("shell.tag.plugin")}</span>}
      {tool.source !== "plugin" && <ChevronRight size={14} className="home-tool-arrow rtl:-scale-x-100" aria-hidden="true" />}
    </button>
  );
}

function HomeSection({ title, tools, onSelect, action }: { title: string; tools: CatalogTool[]; onSelect: (tool: CatalogTool) => void; action?: React.ReactNode }) {
  return (
    <div>
      {action ? (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className="text-sm font-medium text-foreground mb-2">
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
}

export function UpdateBanner({ updates, onReview }: { updates: readonly PluginUpdate[]; onReview: () => void }) {
  const t = useT();
  return (
    <div className="mb-6 mt-2 flex items-center gap-3 rounded-lg bg-primary/[.14] px-3 py-2.5 text-sm text-foreground" role="status">
      <RefreshCw size={16} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">
        {t("shell.updates.banner", { count: updates.length, names: listNames(updates.map((update) => update.name)) })}
      </span>
      <Button type="button" variant="secondary" size="sm" className="h-7 px-3 text-sm" onClick={onReview}>{t("shell.updates.review")}</Button>
    </div>
  );
}

export function EmptyHome({ onBrowse, onInstall, className = "mx-auto h-full max-w-[420px]" }: { onBrowse: () => void; onInstall: () => void; className?: string }) {
  const t = useT();
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        <Puzzle size={22} aria-hidden="true" />
      </span>
      <h1 className="mt-1 text-lg font-semibold text-foreground">{t("shell.empty.title")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("shell.empty.body")}
      </p>
      <div className="mt-1.5 flex gap-2">
        <Button type="button" size="sm" className="h-[30px] gap-[7px] px-3 text-sm" onClick={onBrowse}>
          <Puzzle size={14} aria-hidden="true" />
          {t("shell.empty.browse")}
        </Button>
        <Button type="button" variant="secondary" size="sm" className="h-[30px] gap-[7px] px-3 text-sm" onClick={onInstall}>
          <Download size={14} aria-hidden="true" />
          {t("shell.empty.install")}
        </Button>
      </div>
    </div>
  );
}

export function Home({ recentTools, tools, pinned, pinnedTools, onPin, onUnpin, onMovePinned, onPinInstalled, onOpenPlugin, quickAccessTools, platform, paletteShortcutLabel, onSelect, onOpenPalette, updates, onReviewUpdates, empty, onBrowsePlugins, onInstallFromFile }: HomeProps) {
  const t = useT();
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
          {t("shell.home.title")}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          {t("shell.home.subtitle")}
        </p>
      </div>

      <button type="button" className={`home-search ${editing ? "opacity-50" : ""}`} disabled={editing} onClick={onOpenPalette}>
        <Search size={17} aria-hidden="true" />
        <span>{t("shell.home.find")}</span>
        {!editing && <kbd>{paletteShortcutLabel}</kbd>}
      </button>
      {!editing && (
        <p className="home-paste-hint">
          {t("shell.home.pasteHint", { shortcut: platform === "darwin" ? "⌘V" : "Ctrl+V" })}
        </p>
      )}
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
            title={t("shell.home.pinnedTools")}
            tools={pinnedTools}
            onSelect={onSelect}
            action={<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-sm text-muted-foreground" onClick={() => edit(false)}>{t("shell.home.edit")}</Button>}
          />
        ) : (
          <div>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("shell.home.pinnedTools")}</h2>
            <button
              type="button"
              onClick={() => edit(true)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-input text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Plus size={14} aria-hidden="true" />
              {t("shell.home.pinTools")}
            </button>
          </div>
        )}
        {!editing && recentTools.length > 0 && <HomeSection title={t("shell.home.recent")} tools={recentTools} onSelect={onSelect} />}
        {!editing && <HomeSection title={t("shell.home.quickAccess")} tools={quickAccessTools} onSelect={onSelect} />}
      </div>
    </div>
  );
}
