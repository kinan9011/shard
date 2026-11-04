import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useT, type TKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  SHORTCUT_ACTIONS,
  bindingFromKeyboardEvent,
  formatShortcutBinding,
  getDefaultShortcutBindings,
  getShortcutActionDefinition,
  getShortcutConflict,
  isReservedShortcut,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutBindings,
} from "@/utils/shortcuts";
import {
  formatGlobalShortcut,
  getDefaultGlobalShortcut,
  globalShortcutFromEvent,
  type GlobalShortcut,
} from "@/utils/global-shortcut";
import { Row } from "./Row";

const GROUPS = [
  ["general", "settings.shortcuts.groupGeneral", "settings.shortcuts.groupGeneralHint"],
  ["favorites", "settings.shortcuts.groupPinned", "settings.shortcuts.groupPinnedHint"],
] as const satisfies readonly (readonly [string, TKey, TKey])[];

/** Text with one `{key}` slot, around a node (a key name in bold). */
const KEY_SLOT = "\u0001";
function withKey(text: string, node: ReactNode): ReactNode {
  const [before = "", after = ""] = text.split(KEY_SLOT);
  return <>{before}{node}{after}</>;
}

/** While a shortcut is being recorded, the app must not act on key presses (or the system-wide shortcut). */
function useReportRecording(recording: boolean, onRecordingChange: (recording: boolean) => void) {
  useEffect(() => {
    if (!recording) return undefined;
    onRecordingChange(true);
    return () => onRecordingChange(false);
  }, [recording, onRecordingChange]);
}

const Status = ({ tone, children }: { tone: "info" | "error"; children: ReactNode }) => (
  <div
    role={tone === "error" ? "alert" : "status"}
    className={`rounded-lg border px-3 py-2 text-sm ${
      tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-primary/5 text-foreground"
    }`}
  >
    {children}
  </div>
);

const Section = ({ title, hint, children }: { title: string; hint: string; children: ReactNode }) => (
  <section className="flex max-w-[820px] flex-col gap-1">
    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    <p className="mb-1 text-xs text-muted-foreground">{hint}</p>
    <div className="flex flex-col">{children}</div>
  </section>
);

interface ShortcutSettingsProps {
  platform: string | undefined;
  bindings: ShortcutBindings;
  onUpdateBinding(actionId: ShortcutActionId, binding: ShortcutBinding | null): void;
  onResetDefaults(): void;
  onRecordingChange(recording: boolean): void;
  /** An overlay is on top: drop a recording in progress, so it cannot swallow the overlay's keys. */
  paused: boolean;
}

/** The app's keyboard shortcuts: click one to record a new key combination. */
export function ShortcutSettings({ platform, bindings, onUpdateBinding, onResetDefaults, onRecordingChange, paused }: ShortcutSettingsProps) {
  const t = useT();
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const defaultBindings = useMemo(() => getDefaultShortcutBindings(platform), [platform]);
  useReportRecording(recordingActionId !== null, onRecordingChange);
  useEffect(() => {
    if (paused) setRecordingActionId(null);
  }, [paused]);

  useEffect(() => {
    if (!recordingActionId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingActionId(null);
        setErrorMessage("");
        return;
      }
      const candidate = bindingFromKeyboardEvent(event);
      if (!candidate) return;
      if (isReservedShortcut(candidate, platform)) {
        setErrorMessage(t("settings.shortcuts.reserved"));
        return;
      }
      const conflict = getShortcutConflict(bindings, candidate, recordingActionId);
      if (conflict) {
        setErrorMessage(t("settings.shortcuts.conflict", { action: getShortcutActionDefinition(conflict).label }));
        return;
      }
      onUpdateBinding(recordingActionId, candidate);
      setRecordingActionId(null);
      setErrorMessage("");
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [bindings, onUpdateBinding, platform, recordingActionId, t]);

  const actionRow = (actionId: ShortcutActionId) => {
    const action = getShortcutActionDefinition(actionId);
    const isRecording = recordingActionId === actionId;
    return (
      <Row key={action.id} title={action.label} hint={action.description}>
        <div className="grid shrink-0 grid-cols-[120px_48px_52px] items-center gap-1">
          <Button
            type="button"
            className="h-[30px] text-xs"
            aria-pressed={isRecording}
            variant={isRecording ? "default" : "outline"}
            size="sm"
            aria-label={isRecording ? t("settings.shortcuts.cancelRecording", { action: action.label }) : t("settings.shortcuts.record", { action: action.label })}
            onClick={() => {
              setRecordingActionId(isRecording ? null : actionId);
              setErrorMessage("");
            }}
          >
            {isRecording ? t("settings.shortcuts.pressKeys") : formatShortcutBinding(bindings[actionId], platform)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-xs text-muted-foreground"
            aria-label={t("settings.shortcuts.clear", { action: action.label })}
            onClick={() => onUpdateBinding(actionId, null)}
            disabled={bindings[actionId] === null}
          >
            {t("settings.shortcuts.clearButton")}
          </Button>
          {defaultBindings[actionId] === null ? <span /> : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2 text-xs text-muted-foreground"
              aria-label={t("settings.shortcuts.reset", { action: action.label })}
              onClick={() => onUpdateBinding(actionId, defaultBindings[actionId])}
            >
              {t("settings.shortcuts.resetButton")}
            </Button>
          )}
        </div>
      </Row>
    );
  };

  const mod = platform === "darwin" ? "⌘" : "Ctrl+";
  const fixedTabs = [
    [t("settings.shortcuts.closeTab"), t("settings.shortcuts.closeTabHint"), `${mod}W`],
    [t("settings.shortcuts.nextTab"), t("settings.shortcuts.nextTabHint"), "Ctrl+Tab"],
    [t("settings.shortcuts.previousTab"), t("settings.shortcuts.previousTabHint"), "Ctrl+Shift+Tab"],
    [t("settings.shortcuts.moveTabs"), t("settings.shortcuts.moveTabsHint"), "← → Home End"],
  ];

  return (
    <div className="flex flex-col gap-6">
      {errorMessage ? (
        <Status tone="error">{errorMessage}</Status>
      ) : recordingActionId ? (
        <Status tone="info">
          {withKey(t("settings.shortcuts.recordingFor", { action: getShortcutActionDefinition(recordingActionId).label, esc: KEY_SLOT }), <strong>Esc</strong>)}
        </Status>
      ) : null}
      {GROUPS.map(([group, title, hint]) => (
        <Section key={group} title={t(title)} hint={t(hint)}>
          {SHORTCUT_ACTIONS.filter((action) => action.group === group).map((action) => actionRow(action.id))}
        </Section>
      ))}
      <Section title={t("settings.shortcuts.tabs")} hint={t("settings.shortcuts.tabsHint")}>
        {fixedTabs.map(([label, description, keys]) => (
          <Row key={label} title={label} hint={description}>
            <kbd className="shrink-0 whitespace-nowrap rounded-[5px] border border-input bg-muted px-2 py-1 font-sans text-xs text-foreground">{keys}</kbd>
          </Row>
        ))}
      </Section>
      <div>
        <Button type="button" variant="ghost" onClick={onResetDefaults}>
          <RotateCcw className="me-2 h-4 w-4" />
          {t("settings.shortcuts.resetAll")}
        </Button>
      </div>
    </div>
  );
}

interface GlobalShortcutProps {
  platform: string | undefined;
  shortcut: GlobalShortcut;
  error: string | null;
  onChange(shortcut: GlobalShortcut): void;
  onRecordingChange(recording: boolean): void;
  paused: boolean;
}

/** The system-wide "Show Shard" shortcut. */
export function GlobalShortcutSetting({ platform, shortcut, error, onChange, onRecordingChange, paused }: GlobalShortcutProps) {
  const t = useT();
  const title = t("settings.globalShortcut.title");
  const [recording, setRecording] = useState(false);
  useReportRecording(recording, onRecordingChange);
  useEffect(() => {
    if (paused) setRecording(false);
  }, [paused]);

  useEffect(() => {
    if (!recording) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const candidate = globalShortcutFromEvent(event);
      if (!candidate) return;
      onChange(candidate);
      setRecording(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onChange, recording]);

  return (
    <>
      <Row title={title} htmlFor="global-shortcut-enabled" hint={t("settings.globalShortcut.hint")}>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            className="h-[30px] min-w-[105px] text-xs"
            aria-pressed={recording}
            variant={recording ? "default" : "outline"}
            size="sm"
            disabled={!shortcut.enabled}
            aria-label={recording ? t("settings.shortcuts.cancelRecording", { action: title }) : t("settings.shortcuts.record", { action: title })}
            onClick={() => setRecording((value) => !value)}
          >
            {recording ? t("settings.shortcuts.pressKeys") : formatGlobalShortcut(shortcut, platform)}
          </Button>
          <Switch
            id="global-shortcut-enabled"
            checked={shortcut.enabled}
            aria-label={t("settings.globalShortcut.use")}
            onCheckedChange={(enabled) => onChange({ ...shortcut, enabled })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-xs text-muted-foreground"
            aria-label={t("settings.shortcuts.reset", { action: title })}
            onClick={() => onChange(getDefaultGlobalShortcut(platform))}
          >
            {t("settings.shortcuts.resetButton")}
          </Button>
        </div>
      </Row>
      {recording ? (
        <Status tone="info">
          {withKey(t("settings.globalShortcut.recordingHint", { key: platform === "darwin" ? "Option" : "Alt", esc: KEY_SLOT }), <strong>Esc</strong>)}
        </Status>
      ) : error ? (
        <Status tone="error">
          {t("settings.globalShortcut.error", { shortcut: formatGlobalShortcut(shortcut, platform) })}
        </Status>
      ) : null}
    </>
  );
}
