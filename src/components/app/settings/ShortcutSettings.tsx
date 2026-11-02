import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
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
  ["general", "General", "Core app actions available from anywhere in the app."],
  ["favorites", "Pinned tools", "These follow the current order of your pinned tools on Home."],
] as const;

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
        setErrorMessage("That shortcut is reserved by the app or operating system.");
        return;
      }
      const conflict = getShortcutConflict(bindings, candidate, recordingActionId);
      if (conflict) {
        setErrorMessage(`That shortcut is already assigned to ${getShortcutActionDefinition(conflict).label}.`);
        return;
      }
      onUpdateBinding(recordingActionId, candidate);
      setRecordingActionId(null);
      setErrorMessage("");
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [bindings, onUpdateBinding, platform, recordingActionId]);

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
            aria-label={isRecording ? `Cancel recording for ${action.label}` : `Record ${action.label}`}
            onClick={() => {
              setRecordingActionId(isRecording ? null : actionId);
              setErrorMessage("");
            }}
          >
            {isRecording ? "Press keys…" : formatShortcutBinding(bindings[actionId], platform)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-xs text-muted-foreground"
            aria-label={`Clear ${action.label}`}
            onClick={() => onUpdateBinding(actionId, null)}
            disabled={bindings[actionId] === null}
          >
            Clear
          </Button>
          {defaultBindings[actionId] === null ? <span /> : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2 text-xs text-muted-foreground"
              aria-label={`Reset ${action.label}`}
              onClick={() => onUpdateBinding(actionId, defaultBindings[actionId])}
            >
              Reset
            </Button>
          )}
        </div>
      </Row>
    );
  };

  const mod = platform === "darwin" ? "⌘" : "Ctrl+";
  const fixedTabs = [
    ["Close tab", "Close the tool you are using.", `${mod}W`],
    ["Next tab", "Move to the next open tool.", "Ctrl+Tab"],
    ["Previous tab", "Move to the previous open tool.", "Ctrl+Shift+Tab"],
    ["Move between tabs", "Use when a tab has focus. Delete closes it.", "← → Home End"],
  ];

  return (
    <div className="flex flex-col gap-6">
      {errorMessage ? (
        <Status tone="error">{errorMessage}</Status>
      ) : recordingActionId ? (
        <Status tone="info">
          Recording for {getShortcutActionDefinition(recordingActionId).label}. Press <strong>Esc</strong> to cancel.
        </Status>
      ) : null}
      {GROUPS.map(([group, title, hint]) => (
        <Section key={group} title={title} hint={hint}>
          {SHORTCUT_ACTIONS.filter((action) => action.group === group).map((action) => actionRow(action.id))}
        </Section>
      ))}
      <Section title="Tabs" hint="These shortcuts are fixed. They work when a tool tab is open.">
        {fixedTabs.map(([label, description, keys]) => (
          <Row key={label} title={label} hint={description}>
            <kbd className="shrink-0 whitespace-nowrap rounded-[5px] border border-input bg-muted px-2 py-1 font-sans text-xs text-foreground">{keys}</kbd>
          </Row>
        ))}
      </Section>
      <div>
        <Button type="button" variant="ghost" onClick={onResetDefaults}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset All Defaults
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
      <Row title="Show Shard" htmlFor="global-shortcut-enabled" hint="Works in every app while Shard runs. Opens Shard with the command palette. Press it again to hide Shard.">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            className="h-[30px] min-w-[105px] text-xs"
            aria-pressed={recording}
            variant={recording ? "default" : "outline"}
            size="sm"
            disabled={!shortcut.enabled}
            aria-label={recording ? "Cancel recording for Show Shard" : "Record Show Shard"}
            onClick={() => setRecording((value) => !value)}
          >
            {recording ? "Press keys…" : formatGlobalShortcut(shortcut, platform)}
          </Button>
          <Switch
            id="global-shortcut-enabled"
            checked={shortcut.enabled}
            aria-label="Use the Show Shard shortcut"
            onCheckedChange={(enabled) => onChange({ ...shortcut, enabled })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-xs text-muted-foreground"
            aria-label="Reset Show Shard"
            onClick={() => onChange(getDefaultGlobalShortcut(platform))}
          >
            Reset
          </Button>
        </div>
      </Row>
      {recording ? (
        <Status tone="info">
          Press a combination with Cmd, Ctrl, or {platform === "darwin" ? "Option" : "Alt"}. Press <strong>Esc</strong> to cancel.
        </Status>
      ) : error ? (
        <Status tone="error">
          {formatGlobalShortcut(shortcut, platform)} could not be registered. Another app may use it, or this desktop does not support global shortcuts. Choose a different combination.
        </Status>
      ) : null}
    </>
  );
}
