import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { LanguageSelect } from "@/components/app/LanguageSelect";
import { exportBackup } from "@/lib/settingsBackup";
import { Switch } from "@/components/ui/switch";
import { closeAfterReset, resetAppData, type UpdateState } from "@/lib/desktop";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { COLOR_SCHEMES, schemeName, type Layout, type OpenToolsIn, type SidebarCategoryMode, type ThemePreference } from "@/utils/theme";
import type { GlobalShortcut } from "@/utils/global-shortcut";
import type { ShortcutActionId, ShortcutBinding, ShortcutBindings } from "@/utils/shortcuts";
import { BuiltInToolSwitches } from "../BuiltInToolSwitches";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FontsApi } from "@/hooks/useFonts";
import { clearRememberedInputs, REMEMBER_INPUTS_KEY, rememberInputsEnabled } from "@/hooks/usePersistedInput";
import { ACCENTS, type AccentId } from "@/utils/accent";
import { BackupRows } from "./BackupRows";
import { CustomThemesRow, type CustomThemes } from "./CustomThemes";
import { FontSettings } from "./FontSettings";
import { LayoutChoice } from "./LayoutChoice";
import { ActionButton, Heading, Row, Segmented } from "./Row";
import { GlobalShortcutSetting, ShortcutSettings } from "./ShortcutSettings";
import { updateButtonLabel, updateStatusLabel } from "./updateLabels";

export const SETTINGS_SECTIONS = [
  ["general", "settings.section.general"],
  ["appearance", "settings.section.appearance"],
  ["tools", "settings.section.tools"],
  ["plugins", "settings.section.plugins"],
  ["shortcuts", "settings.section.shortcuts"],
  ["about", "settings.section.about"],
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
  const t = useT();
  const phone = useIsMobile(props.platform);
  // Key shortcuts are for a keyboard.
  const sections = SETTINGS_SECTIONS.filter(([id]) => !(phone && id === "shortcuts"));
  const current = sections.find(([id]) => id === props.section) ?? sections[0];
  return (
    <div className="flex h-full min-h-0 flex-col bg-background sm:flex-row">
      <nav aria-label={t("settings.nav.label")} className="flex w-full shrink-0 flex-row gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:w-[200px] sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:border-b-0 sm:border-e sm:py-5">
        {sections.map(([id, name]) => (
          <button
            key={id}
            type="button"
            aria-current={current[0] === id ? "page" : undefined}
            onClick={() => props.onSection(id)}
            className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-start text-sm sm:h-8 text-muted-foreground transition-colors hover:bg-foreground/[.055] hover:text-foreground aria-[current=page]:bg-foreground/[.09] aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {t(name)}
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
            <Heading title={t("settings.section.shortcuts")} hint={t("settings.shortcuts.hint")} />
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

/** Whether tool inputs and open tabs come back after a restart. Off also forgets what is stored. */
function RememberInputsRow() {
  const t = useT();
  const [on, setOn] = useState(rememberInputsEnabled);
  const change = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(REMEMBER_INPUTS_KEY, String(next));
    } catch {
      // Storage blocked: the switch just won't stick.
    }
    if (!next) clearRememberedInputs();
  };
  return (
    <Row title={t("settings.rememberInputs.title")} htmlFor="remember-inputs" hint={t("settings.rememberInputs.hint")}>
      <Switch id="remember-inputs" checked={on} onCheckedChange={change} />
    </Row>
  );
}

function General(p: Props) {
  const t = useT();
  const status = updateStatusLabel(p.updateState);
  const busy = p.updateState.status === "checking" || p.updateState.status === "downloading";
  return (
    <>
      <Heading title={t("settings.section.general")} hint={t("settings.general.hint")} />
      <div className="flex max-w-[820px] flex-col">
        <Row title={t("language.label")} hint={t("language.hint")}>
          <LanguageSelect />
        </Row>
        {p.isDesktop && p.updateState.status !== "unsupported" && (
          <Row title={t("settings.general.autoUpdate")} htmlFor="auto-update" hint={t("settings.general.autoUpdateHint")}>
            <Switch id="auto-update" checked={p.autoUpdate} onCheckedChange={p.onAutoUpdateChange} />
          </Row>
        )}
        <RememberInputsRow />
        <Row title={t("settings.general.updates")} hint={status || (p.appVersion ? t("settings.general.version", { version: p.appVersion }) : t("settings.general.updatesDesktopOnly"))}>
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
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const reset = () => resetAppData().then(setClosing, (error) => toast.error(t("settings.reset.failed", { message: error instanceof Error ? error.message : String(error) })));
  return (
    <>
    {closing && <ResetDoneDialog />}
    <Row
      title={t("settings.reset.title")}
      hint={
        confirming
          ? t("settings.reset.hintConfirm")
          : t("settings.reset.hint")
      }
    >
      {confirming ? (
        <div className="flex gap-2">
          <ActionButton onClick={() => void exportBackup(native).then((saved) => saved && toast.success(t("settings.backup.exported")), (error) => toast.error(t("settings.backup.exportFailed"), { description: String(error) }))}>{t("settings.reset.exportFirst")}</ActionButton>
          <ActionButton onClick={() => setConfirming(false)}>{t("common.cancel")}</ActionButton>
          <ActionButton onClick={() => void reset()} className="text-destructive">{t("settings.reset.removeAll")}</ActionButton>
        </div>
      ) : (
        <ActionButton onClick={() => setConfirming(true)}>{t("settings.reset.button")}</ActionButton>
      )}
    </Row>
    </>
  );
}

/** Tells that the reset is done and Shard closes. It cannot be dismissed: the app has no data left to run on. */
function ResetDoneDialog() {
  const t = useT();
  const ref = useDialogFocus(true, () => {});
  const title = t("settings.reset.doneTitle");
  return (
    <div className="modal-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div ref={ref} role="alertdialog" aria-modal="true" aria-label={title} className="modal-surface flex w-[400px] max-w-full flex-col">
        <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.reset.doneBody")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={() => void closeAfterReset()} className="inline-flex h-7 items-center whitespace-nowrap rounded-md border border-primary-solid bg-primary-solid px-3 text-sm font-medium text-primary-solid-foreground">
            {t("settings.reset.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function BuiltInTools() {
  const t = useT();
  return (
    <>
      <Heading title={t("settings.section.tools")} hint={t("settings.tools.hint")} />
      <div className="max-w-[820px] overflow-hidden rounded-lg bg-secondary">
        <BuiltInToolSwitches />
      </div>
    </>
  );
}

function PluginsSection(p: Props) {
  const t = useT();
  return (
    <>
      <Heading title={t("settings.section.plugins")} hint={t("settings.plugins.hint")} />
      <div className="flex max-w-[820px] flex-col">
        <Row title={t("settings.plugins.installed")} hint={t("settings.plugins.installedHint")}>
          <ActionButton onClick={() => p.onOpenPlugins("installed")}>{t("settings.plugins.openInstalled")}</ActionButton>
        </Row>
        <Row
          title={t("settings.plugins.repositories")}
          hint={t("settings.plugins.repositoriesHint")}
        >
          <ActionButton onClick={() => p.onOpenPlugins("repositories")}>{t("settings.plugins.openRepositories")}</ActionButton>
        </Row>
        <Row title={t("settings.plugins.updates")} hint={t("settings.plugins.updatesHint")}>
          <ActionButton onClick={p.onCheckPluginUpdates}>{t("settings.plugins.checkNow")}</ActionButton>
        </Row>
      </div>
    </>
  );
}

function About(p: Props) {
  const t = useT();
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
      {text}
    </a>
  );
  return (
    <>
      <Heading title={t("settings.section.about")} />
      <div className="flex max-w-[820px] flex-col">
        <Row title="Shard" hint={p.appVersion ? t("settings.about.versionLine", { version: p.appVersion }) : (p.hasNative ?? p.isDesktop) ? t("settings.about.loading") : t("settings.about.browserPreview")} />
        {p.hasReleaseNotes && (
          <Row title={t("settings.about.whatsNew")} hint={t("settings.about.whatsNewHint")}>
            <ActionButton onClick={p.onWhatsNew}>{t("settings.about.whatsNew")}</ActionButton>
          </Row>
        )}
        <Row title={t("settings.about.source")} hint={t("settings.about.sourceHint")}>{link(REPO_URL, t("settings.about.sourceLink"))}</Row>
        <Row title={t("settings.about.releases")} hint={t("settings.about.releasesHint")}>{link(`${REPO_URL}/releases`, t("settings.about.releasesLink"))}</Row>
        <Row title={t("settings.about.feedback")} hint={t("settings.about.feedbackHint")}>{link(`${REPO_URL}/issues`, t("settings.about.feedbackLink"))}</Row>
      </div>
    </>
  );
}

function Appearance(p: Props) {
  const t = useT();
  const mode = p.dark ? "dark" : "light";
  const schemes = [...COLOR_SCHEMES, ...(p.customThemes?.schemes ?? [])].filter((s) => s.modes.includes(mode));
  return (
    <>
      <Heading title={t("settings.section.appearance")} hint={t("settings.appearance.hint")} />
      <div className="flex flex-col gap-2.5">
        <span className="text-2xs font-semibold uppercase tracking-[.06em] text-muted-foreground">{t("settings.appearance.layout")}</span>
        <LayoutChoice layout={p.layout} onLayout={p.onLayout} />
      </div>
      <div className="mt-1 flex max-w-[820px] flex-col">
        <Row title={t("settings.appearance.theme")} hint={t("settings.appearance.themeHint")}>
          <Segmented
            label={t("settings.appearance.theme")}
            value={p.preference}
            onChange={p.onPreference}
            options={[["system", t("settings.theme.system")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]]}
          />
        </Row>
        <Row title={t("settings.appearance.colorScheme")} hint={t("settings.appearance.colorSchemeHint")}>
          <div role="group" aria-label={t("settings.appearance.colorScheme")} className="grid w-full grid-cols-2 gap-2 sm:w-[420px] sm:grid-cols-3">
            {schemes.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={p.scheme === s.id}
                // The card carries its own scheme, so it previews it whatever the app shows.
                data-scheme={s.id}
                className={`${p.dark ? "dark " : ""}rounded-md border px-2.5 py-2 text-start text-xs`}
                style={{
                  background: "var(--surface-editor)",
                  color: "hsl(var(--foreground))",
                  borderColor: p.scheme === s.id ? "hsl(var(--primary))" : "hsl(var(--border))",
                  boxShadow: p.scheme === s.id ? "0 0 0 1px hsl(var(--primary))" : "none",
                }}
                onClick={() => p.onScheme(s.id)}
              >
                <span className="block font-medium">{schemeName(s)}</span>
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
          <Row title={t("settings.appearance.accent")} hint={t("settings.appearance.accentHint")}>
            <div role="group" aria-label={t("settings.appearance.accent")} className="flex items-center gap-2">
              <button type="button" aria-pressed={!p.accent} onClick={() => p.onAccent?.(null)} className={`h-7 rounded-md border px-2.5 text-xs ${!p.accent ? "border-primary" : "border-input"}`}>
                {t("settings.appearance.accentScheme")}
              </button>
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  aria-label={t(accent.nameKey)}
                  aria-pressed={p.accent === accent.id}
                  title={t(accent.nameKey)}
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
        <Row title={t("settings.appearance.sidebarCategories")} hint={t("settings.appearance.sidebarCategoriesHint")}>
          <Segmented
            label={t("settings.appearance.sidebarCategories")}
            value={p.sidebarCategories}
            onChange={p.onSidebarCategories}
            options={[["remember", t("settings.sidebarCategories.remember")], ["open", t("settings.sidebarCategories.open")], ["closed", t("settings.sidebarCategories.closed")]]}
          />
        </Row>
        <Row title={t("settings.appearance.openToolsIn")} hint={t("settings.appearance.openToolsInHint")}>
          <Segmented
            label={t("settings.appearance.openToolsIn")}
            value={p.openToolsIn}
            onChange={p.onOpenToolsIn}
            options={[["new", t("settings.openToolsIn.new")], ["current", t("settings.openToolsIn.current")]]}
          />
        </Row>
      </div>
    </>
  );
}

