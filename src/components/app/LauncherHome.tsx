import { useState } from "react";
import { Plus, Puzzle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toolTint, type CatalogTool } from "@/app/catalog";
import { categoryName, toolName } from "@/app/toolNames";
import { useReorder } from "@/app/useReorder";
import { useT } from "@/i18n";
import { EmptyHome, UpdateBanner } from "@/components/app/Home";
import { PinnedEditor } from "@/components/app/PinnedEditor";
import type { PluginUpdate } from "@/plugins/api";

interface LauncherHomeProps {
  /** Every tool in the catalog: the pin picker lists them. */
  tools: CatalogTool[];
  categories: { name: string; tools: CatalogTool[] }[];
  pinned: readonly string[];
  pinnedTools: CatalogTool[];
  onPin: (id: string) => boolean;
  onUnpin: (id: string) => void;
  onMovePinned: (id: string, targetId: string) => void;
  onPinInstalled: (id: string) => void;
  onOpenPlugin: (id: string) => void;
  platform: string | undefined;
  paletteShortcutLabel: string;
  onSelect: (tool: CatalogTool) => void;
  onOpenPalette: () => void;
  updates: readonly PluginUpdate[];
  onReviewUpdates: () => void;
  /** Every built-in is hidden and no plugin is installed. */
  empty: boolean;
  onBrowsePlugins: () => void;
  onInstallFromFile: () => void;
}

const sectionLabel = "text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground";

/** Home in the Launcher layout (design screen 01 B): search hero, pinned tiles, category chips. */
export function LauncherHome(props: LauncherHomeProps) {
  const t = useT();
  const { tools, categories, pinned, pinnedTools, onPin, onUnpin, onMovePinned, onPinInstalled, onOpenPlugin, platform, paletteShortcutLabel, onSelect, onOpenPalette, updates, onReviewUpdates, empty, onBrowsePlugins, onInstallFromFile } = props;
  const [editing, setEditing] = useState(false);
  const [pickerFirst, setPickerFirst] = useState(false);
  const { dragging, announcement, tileProps, gridProps } = useReorder({ tools: pinnedTools, onMove: onMovePinned, horizontal: true });
  const edit = (picker: boolean) => {
    setPickerFirst(picker);
    setEditing(true);
  };
  // 09 B: no tools at all. The search hero stays, the dashed box holds the ways to add some.
  if (empty) {
    return (
      <div className="flex h-full flex-col items-center gap-7 px-12 py-11">
        <div className="w-full max-w-[640px]">
          <button type="button" onClick={onOpenPalette} className="launcher-search h-[46px] w-full">
            <Search size={15} aria-hidden="true" />
            <span className="flex-1 truncate text-start">{t("shell.launcher.find")}</span>
            <kbd>{paletteShortcutLabel}</kbd>
          </button>
        </div>
        <div className="grid min-h-0 w-full max-w-[1040px] flex-1 place-items-center rounded-[14px] border-[1.5px] border-dashed border-input">
          <EmptyHome className="max-w-[440px]" onBrowse={onBrowsePlugins} onInstall={onInstallFromFile} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center gap-7 overflow-y-auto px-12 pb-10 pt-11">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-2">
        <button type="button" disabled={editing} onClick={onOpenPalette} className={`launcher-search h-[46px] w-full ${editing ? "opacity-50" : ""}`}>
          <Search size={15} aria-hidden="true" />
          <span className="flex-1 truncate text-start">{t("shell.launcher.findOrPaste")}</span>
          {!editing && <kbd>{paletteShortcutLabel}</kbd>}
        </button>
        {/* A phone has no Ctrl+V; it pastes from the keyboard's own menu, which Shard also sees. */}
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t("shell.launcher.pasteHint", { shortcut: platform === "darwin" ? "⌘V" : "Ctrl+V" })}
        </span>
      </div>

      {updates.length > 0 && !editing && (
        <div className="w-full max-w-[1040px] [&>div]:mb-0 [&>div]:mt-0">
          {updates.length > 0 && <UpdateBanner updates={updates} onReview={onReviewUpdates} />}
        </div>
      )}

      <section aria-label={t("shell.launcher.pinned")} className="flex w-full max-w-[1040px] flex-col gap-3">
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
          <>
            <div className="flex items-center justify-between">
              <h2 className={sectionLabel}>{t("shell.launcher.pinned")}</h2>
              <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
                {t("shell.pinnedEditor.dragHint")}
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => edit(false)}>{t("shell.home.edit")}</Button>
              </span>
            </div>
            <div {...gridProps} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {pinnedTools.map((tool, index) => (
                <button
                  key={tool.id}
                  type="button"
                  aria-label={toolName(tool)}
                  data-tool={tool.id}
                  onClick={() => onSelect(tool)}
                  {...tileProps(tool, index)}
                  className={`launcher-tile flex h-[104px] flex-col items-center justify-center gap-2.5 rounded-md border border-border bg-background transition-[transform,box-shadow,border-color] hover:border-primary/50 ${
                    dragging === tool.id ? "z-[1] -translate-y-[3px] border-primary/60 shadow-[0_8px_24px_rgba(0,0,0,.35)]" : ""
                  }`}
                >
                  <span data-tint={toolTint(tool.id)} className="tint-tile h-10 w-10" aria-hidden="true">
                    <tool.icon size={20} />
                  </span>
                  <span className="max-w-full truncate px-2 text-sm font-medium text-foreground">{toolName(tool)}</span>
                </button>
              ))}
            </div>
            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
          </>
        ) : (
          <>
            <h2 className={sectionLabel}>{t("shell.launcher.pinned")}</h2>
            <button
              type="button"
              onClick={() => edit(true)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-input text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Plus size={14} aria-hidden="true" />
              {t("shell.home.pinTools")}
            </button>
          </>
        )}
      </section>

      {!editing && (
        <div className="flex w-full max-w-[1040px] flex-col gap-4">
          {categories.map((category) => (
            <section key={category.name} aria-label={categoryName(category.name)} className="flex flex-col gap-2">
              <h2 className={sectionLabel}>{categoryName(category.name)}</h2>
              <div className="flex flex-wrap gap-2">
                {category.tools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    data-tool={tool.id}
                    onClick={() => onSelect(tool)}
                    className="inline-flex h-[38px] items-center gap-[9px] whitespace-nowrap rounded border border-border bg-background ps-[5px] pe-3.5 text-sm text-foreground transition-colors hover:border-primary/50"
                  >
                    <span data-tint={toolTint(tool.id)} className="tint-tile h-7 w-7 rounded" aria-hidden="true">
                      <tool.icon size={15} />
                    </span>
                    {toolName(tool)}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div>
            <button
              type="button"
              onClick={onBrowsePlugins}
              className="inline-flex h-[38px] items-center gap-[9px] rounded-lg border border-dashed border-input px-3.5 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Puzzle size={15} aria-hidden="true" />
              {t("shell.launcher.getMore")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
