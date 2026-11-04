import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { exportBackup } from "@/lib/settingsBackup";
import { Switch } from "@/components/ui/switch";
import { resetAppData, type UpdateState } from "@/lib/desktop";
import { COLOR_SCHEMES, type Layout, type OpenToolsIn, type SidebarCategoryMode, type ThemePreference } from "@/utils/theme";
import type { GlobalShortcut } from "@/utils/global-shortcut";
import type { ShortcutActionId, ShortcutBinding, ShortcutBindings } from "@/utils/shortcuts";
import { BuiltInToolSwitches } from "../BuiltInToolSwitches";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FontsApi } from "@/hooks/useFonts";
import { ACCENTS, type AccentId } from "@/utils/accent";
import { BackupRows } from "./BackupRows";
import { CustomThemesRow, type CustomThemes } from "./CustomThemes";
import { FontSettings } from "./FontSettings";
import { LayoutChoice } from "./LayoutChoice";
import { ActionButton, Heading, Row, Segmented } from "./Row";
import { GlobalShortcutSetting, ShortcutSettings } from "./ShortcutSettings";
import { updateButtonLabel, updateStatusLabel } from "./updateLabels";

export const SETTINGS_SECTIONS = [
  ["general", "General"],
  ["appearance", "Appearance"],
  ["tools", "Built-in tools"],
  ["plugins", "Plugins"],
  ["shortcuts", "Shortcuts"],
  ["about", "About"],
] as const;

const REPO_URL = "https://github.com/kinan9011/shard";

interface Props {
  section: string;
  onSection(id: string): void;
  preference: ThemePreference;
  onPreference(next: ThemePreference): void;
  scheme: string;
  onScheme(id: string): void;
  /** The app runs natively: on a desktop or a phone. Differs from `isDesktop` on a phone, which has plugins and themes but no updater. Defaults to `isDesktop`. */
  hasNative?: boolean;
  /** The accent color picked over the scheme (null: the scheme's own). Omitted: no accent row. */
  accent?: AccentId | null;
  onAccent?(id: AccentId | null): void;
  /** Font, zoom and field-text choices. Omitted: no font rows. */
  fonts?: FontsApi;
  /** The themes folder. Omitted in the browser preview, which has none. */
  customThemes?: CustomThemes;
  /** The mode in effect, after "system" is resolved. */
  dark: boolean;
  layout: Layout;
  onLayout(next: Layout): void;
  sidebarCategories: SidebarCategoryMode;
  onSidebarCategories(next: SidebarCategoryMode): void;
  openToolsIn: OpenToolsIn;
  onOpenToolsIn(next: OpenToolsIn): void;
  platform: string | undefined;
  /** False in the browser preview, which has no app updates. */
  isDesktop: boolean;
  appVersion: string;
  updateState: UpdateState;
  onUpdateAction(): void;
  autoUpdate: boolean;
  onAutoUpdateChange(next: boolean): void;
  /** The system-wide shortcut. Omitted in the browser preview, where it cannot work. */
  globalShortcut?: GlobalShortcut;
  globalShortcutError: string | null;
  onChangeGlobalShortcut(next: GlobalShortcut): void;
  shortcutBindings: ShortcutBindings;
  onUpdateShortcut(actionId: ShortcutActionId, binding: ShortcutBinding | null): void;
  onResetShortcuts(): void;
  /** True while a shortcut is being recorded, so the app ignores key presses meanwhile. */
  onRecordingShortcut(recording: boolean): void;
  /** The command palette or What's new is on top: a recording in progress is dropped. */
  recordingPaused: boolean;
  onOpenPlugins(tab: string): void;
  onCheckPluginUpdates(): void;
  hasReleaseNotes: boolean;
  onWhatsNew(): void;
}

/** Settings: a section nav on the left, the selected section on the right. Changes apply as they are made. */
export function SettingsPage(props: Props) {
  const phone = useIsMobile(props.platform);
  // Key shortcuts are for a keyboard.
  const sections = SETTINGS_SECTIONS.filter(([id]) => !(phone && id === "shortcuts"));
  const current = sections.find(([id]) => id === props.section) ?? sections[1];
  return (
    <div className="flex h-full min-h-0 flex-col bg-background sm:flex-row">
      <nav aria-label="Settings sections" className="flex w-full shrink-0 flex-row gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:w-[200px] sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:border-b-0 sm:border-r sm:py-5">
        {sections.map(([id, name]) => (
          <button
            key={id}
            type="button"
            aria-current={current[0] === id ? "page" : undefined}
            onClick={() => props.onSection(id)}
            className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-left text-sm sm:h-8 text-muted-foreground transition-colors hover:bg-foreground/[.055] hover:text-foreground aria-[current=page]:bg-foreground/[.09] aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-4 sm:px-9 sm:py-6">
        {current[0] === "appearance" ? (
          <Appearance {...props} />
        ) : current[0] === "general" ? (
          <General {...props} />
        ) : current[0] === "tools" ? (
          <BuiltInTools />
        ) : current[0] === "plugins" ? (
          <PluginsSection {...props} />
        ) : current[0] === "shortcuts" ? (
          <>
            <Heading title="Shortcuts" hint="Click a shortcut to record a new key combination." />
            <ShortcutSettings
              platform={props.platform}
              bindings={props.shortcutBindings}
              onUpdateBinding={props.onUpdateShortcut}
              onResetDefaults={props.onResetShortcuts}
              onRecordingChange={props.onRecordingShortcut}
              paused={props.recordingPaused}
            />
          </>
        ) : (
          <About {...props} />
        )}
      </div>
    </div>
  );
}

function General(p: Props) {
  const status = updateStatusLabel(p.updateState);
  const busy = p.updateState.status === "checking" || p.updateState.status === "downloading";
  return (
    <>
      <Heading title="General" hint="How Shard updates and how you reach it from anywhere." />
      <div className="flex max-w-[820px] flex-col">
        {p.isDesktop && p.updateState.status !== "unsupported" && (
          <Row title="Update automatically" htmlFor="auto-update" hint="Download updates in the background. They install when you quit Shard.">
            <Switch id="auto-update" checked={p.autoUpdate} onCheckedChange={p.onAutoUpdateChange} />
          </Row>
        )}
        <Row title="Updates" hint={status || (p.appVersion ? `You have version ${p.appVersion}.` : "Updates are available in the desktop app.")}>
          {p.isDesktop && (
            <ActionButton onClick={p.onUpdateAction} disabled={busy || p.updateState.status === "unsupported"}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
              {updateButtonLabel(p.updateState)}
            </ActionButton>
          )}
        </Row>
        {p.globalShortcut && (
          <GlobalShortcutSetting
            platform={p.platform}
            shortcut={p.globalShortcut}
            error={p.globalShortcutError}
            onChange={p.onChangeGlobalShortcut}
            onRecordingChange={p.onRecordingShortcut}
            paused={p.recordingPaused}
          />
        )}
        <BackupRows native={p.hasNative ?? p.isDesktop} />
        <ResetRow native={p.isDesktop} />
      </div>
    </>
  );
}

/** Wipes every trace of Shard. Two steps, so a stray click cannot do it. */
function ResetRow({ native }: { native: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Row
      title="Reset Shard"
      hint={
        confirming
          ? "This can't be undone. All settings, plugins, themes, repositories, caches and backups are removed, then Shard restarts."
          : "Remove all settings, plugins, themes, repositories, caches and backups. Shard restarts as if newly installed."
      }
    >
      {confirming ? (
        <div className="flex gap-2">
          <ActionButton onClick={() => void exportBackup(native).then((saved) => saved && toast.success("Settings exported"), (error) => toast.error("Couldn't export the settings", { description: String(error) }))}>Export settings first…</ActionButton>
          <ActionButton onClick={() => setConfirming(false)}>Cancel</ActionButton>
          <ActionButton onClick={() => resetAppData().catch((error) => toast.error(`Reset failed: ${error instanceof Error ? error.message : String(error)}`))} className="text-destructive">Remove all data</ActionButton>
        </div>
      ) : (
        <ActionButton onClick={() => setConfirming(true)}>Reset…</ActionButton>
      )}
    </Row>
  );
}

function BuiltInTools() {
  return (
    <>
      <Heading title="Built-in tools" hint="Turn off the tools you don't use. They disappear from the sidebar, Home and search, and you can turn them back on here." />
      <div className="max-w-[820px] overflow-hidden rounded-lg bg-secondary">
        <BuiltInToolSwitches />
      </div>
    </>
  );
}

function PluginsSection(p: Props) {
  return (
    <>
      <Heading title="Plugins" hint="Where plugins come from and how they are kept up to date." />
      <div className="flex max-w-[820px] flex-col">
        <Row title="Installed plugins" hint="Turn plugins on or off, change their permissions, or uninstall them.">
          <ActionButton onClick={() => p.onOpenPlugins("installed")}>Open Installed</ActionButton>
        </Row>
        <Row
          title="Repositories"
          hint="Add repositories, choose when to check them for updates, and allow installs from zip files, folders and URLs outside them."
        >
          <ActionButton onClick={() => p.onOpenPlugins("repositories")}>Open Repositories</ActionButton>
        </Row>
        <Row title="Plugin updates" hint="Sync your repositories and look for newer versions.">
          <ActionButton onClick={p.onCheckPluginUpdates}>Check now</ActionButton>
        </Row>
      </div>
    </>
  );
}

function About(p: Props) {
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
      {text}
    </a>
  );
  return (
    <>
      <Heading title="About" />
      <div className="flex max-w-[820px] flex-col">
        <Row title="Shard" hint={p.appVersion ? `Version ${p.appVersion}` : (p.hasNative ?? p.isDesktop) ? "Loading…" : "Browser preview"} />
        {p.hasReleaseNotes && (
          <Row title="What's new" hint="The highlights of this version.">
            <ActionButton onClick={p.onWhatsNew}>What's new</ActionButton>
          </Row>
        )}
        <Row title="Source code" hint="Shard is open source.">{link(REPO_URL, "GitHub")}</Row>
        <Row title="Releases" hint="Every version and its notes.">{link(`${REPO_URL}/releases`, "View releases")}</Row>
        <Row title="Feedback" hint="Found a bug or have an idea?">{link(`${REPO_URL}/issues`, "Open an issue")}</Row>
      </div>
    </>
  );
}

function Appearance(p: Props) {
  const mode = p.dark ? "dark" : "light";
  const schemes = [...COLOR_SCHEMES, ...(p.customThemes?.schemes ?? [])].filter((s) => s.modes.includes(mode));
  return (
    <>
      <Heading title="Appearance" hint="Changes apply right away." />
      <div className="flex flex-col gap-2.5">
        <span className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">Layout</span>
        <LayoutChoice layout={p.layout} onLayout={p.onLayout} />
      </div>
      <div className="mt-1 flex max-w-[820px] flex-col">
        <Row title="Theme" hint="Follows your system unless you pick one.">
          <Segmented
            label="Theme"
            value={p.preference}
            onChange={p.onPreference}
            options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]}
          />
        </Row>
        <Row title="Color scheme" hint="Colors for the app and its editors.">
          <div role="group" aria-label="Color scheme" className="grid w-full grid-cols-2 gap-2 sm:w-[420px] sm:grid-cols-3">
            {schemes.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={p.scheme === s.id}
                // The card carries its own scheme, so it previews it whatever the app shows.
                data-scheme={s.id}
                className={`${p.dark ? "dark " : ""}rounded-md border px-2.5 py-2 text-left text-xs`}
                style={{
                  background: "var(--surface-editor)",
                  color: "hsl(var(--foreground))",
                  borderColor: p.scheme === s.id ? "hsl(var(--primary))" : "hsl(var(--border))",
                  boxShadow: p.scheme === s.id ? "0 0 0 1px hsl(var(--primary))" : "none",
                }}
                onClick={() => p.onScheme(s.id)}
              >
                <span className="block font-medium">{s.name}</span>
                <span className="mt-1 block font-mono text-[11px]" aria-hidden="true">
                  <span style={{ color: "var(--syntax-kw)" }}>fn</span>{" "}
                  <span style={{ color: "var(--syntax-str)" }}>&quot;a&quot;</span>{" "}
                  <span style={{ color: "var(--syntax-num)" }}>42</span>
                </span>
              </button>
            ))}
          </div>
        </Row>
        {p.onAccent && (
          <Row title="Accent color" hint="The color of buttons and focus rings. Applies over any color scheme.">
            <div role="group" aria-label="Accent color" className="flex items-center gap-2">
              <button type="button" aria-pressed={!p.accent} onClick={() => p.onAccent?.(null)} className={`h-7 rounded-md border px-2.5 text-xs ${!p.accent ? "border-primary" : "border-input"}`}>
                Scheme
              </button>
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  aria-label={accent.name}
                  aria-pressed={p.accent === accent.id}
                  title={accent.name}
                  onClick={() => p.onAccent?.(accent.id)}
                  className={`size-7 rounded-full border-2 ${p.accent === accent.id ? "border-foreground" : "border-transparent"}`}
                  style={{ background: `hsl(${accent.hue} ${accent.saturation}% ${p.dark ? 62 : 42}%)` }}
                />
              ))}
            </div>
          </Row>
        )}
        {p.fonts && <FontSettings fonts={p.fonts} />}
        {p.customThemes && <CustomThemesRow themes={p.customThemes} onBrowse={() => p.onOpenPlugins("themes")} dark={p.dark} onApply={p.onScheme} />}
        <Row title="Sidebar categories" hint="Collapse categories you don’t use. Applies to the sidebar layout.">
          <Segmented
            label="Sidebar categories"
            value={p.sidebarCategories}
            onChange={p.onSidebarCategories}
            options={[["remember", "Remember"], ["open", "All open"], ["closed", "All closed"]]}
          />
        </Row>
        <Row title="Open tools in" hint="A new tab, or replace the current tab.">
          <Segmented
            label="Open tools in"
            value={p.openToolsIn}
            onChange={p.onOpenToolsIn}
            options={[["new", "New tab"], ["current", "Current tab"]]}
          />
        </Row>
      </div>
    </>
  );
}

