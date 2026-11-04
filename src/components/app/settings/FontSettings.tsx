import { useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import type { FontsApi } from "@/hooks/useFonts";
import { BUILT_IN_FONTS, FIELD_SIZE_MAX, FIELD_SIZE_MIN, ZOOM_STEPS, sanitizeFamily } from "@/utils/fonts";
import { ActionButton, Row, Segmented } from "./Row";

const TYPE_NEW = "\u0000installed";
const SELECT = "h-[30px] min-w-[180px] rounded-md border border-input bg-card px-2.5 text-sm text-foreground";
const SIZES = Array.from({ length: FIELD_SIZE_MAX - FIELD_SIZE_MIN + 1 }, (_, i) => FIELD_SIZE_MIN + i);

/** A family picker: the bundled fonts, the ones the user added, and a field for the name of any font installed on the system. */
function FontPicker({ label, value, onChange, custom, defaultLabel }: {
  label: string;
  value: string | null;
  onChange(next: string | null): void;
  custom: string[];
  defaultLabel: string;
}) {
  const t = useT();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const listed = new Set([...BUILT_IN_FONTS.map((font) => font.family), ...custom]);

  const use = () => {
    const name = sanitizeFamily(draft);
    setInvalid(!name);
    if (!name) return;
    onChange(name);
    setTyping(false);
    setDraft("");
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <select
        aria-label={label}
        className={SELECT}
        value={typing ? TYPE_NEW : value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          setTyping(next === TYPE_NEW);
          if (next !== TYPE_NEW) onChange(next || null);
        }}
      >
        <option value="">{defaultLabel}</option>
        {BUILT_IN_FONTS.map((font) => <option key={font.family} value={font.family}>{font.labelKey ? t(font.labelKey) : font.label}</option>)}
        {custom.map((family) => <option key={family} value={family}>{family}</option>)}
        {value && !listed.has(value) && <option value={value}>{t("settings.fonts.installedSuffix", { font: value })}</option>}
        <option value={TYPE_NEW}>{t("settings.fonts.installedFont")}</option>
      </select>
      {typing && (
        <div className="flex items-center gap-2">
          <input
            aria-label={t("settings.fonts.installedName", { label })}
            aria-invalid={invalid}
            autoFocus
            className="h-[30px] w-[180px] rounded-md border border-input bg-transparent px-2.5 text-sm"
            placeholder={t("settings.fonts.installedPlaceholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && use()}
          />
          <ActionButton onClick={use}>{t("settings.fonts.use")}</ActionButton>
        </div>
      )}
      {typing && invalid && <span role="alert" className="text-xs text-destructive">{t("settings.fonts.invalidName")}</span>}
    </div>
  );
}

export function FontSettings({ fonts }: { fonts: FontsApi }) {
  const t = useT();
  const { prefs, custom, setPrefs } = fonts;
  const input = useRef<HTMLInputElement>(null);

  const add = async (file: File | undefined) => {
    if (!file) return;
    try {
      const family = await fonts.addFont(file);
      toast.success(t("settings.fonts.added", { family }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <Row title={t("settings.fonts.ui")} hint={t("settings.fonts.uiHint")}>
        <FontPicker label={t("settings.fonts.ui")} value={prefs.ui} onChange={(ui) => setPrefs({ ui })} custom={custom} defaultLabel={t("settings.fonts.default", { font: "Inter" })} />
      </Row>
      <Row title={t("settings.fonts.zoom")} hint={t("settings.fonts.zoomHint")}>
        <Segmented
          label={t("settings.fonts.zoom")}
          value={String(prefs.zoom)}
          onChange={(zoom) => setPrefs({ zoom: Number(zoom) })}
          options={ZOOM_STEPS.map((step) => [String(step), `${Math.round(step * 100)}%`] as const)}
        />
      </Row>
      <Row title={t("settings.fonts.field")} hint={t("settings.fonts.fieldHint")}>
        <FontPicker label={t("settings.fonts.field")} value={prefs.field} onChange={(field) => setPrefs({ field })} custom={custom} defaultLabel={t("settings.fonts.default", { font: "JetBrains Mono" })} />
      </Row>
      <Row title={t("settings.fonts.fieldSize")} hint={t("settings.fonts.fieldSizeHint")}>
        <select aria-label={t("settings.fonts.fieldSize")} className={SELECT} value={prefs.fieldSize} onChange={(event) => setPrefs({ fieldSize: Number(event.target.value) })}>
          {SIZES.map((size) => <option key={size} value={size}>{t("settings.fonts.sizePx", { size })}</option>)}
        </select>
      </Row>
      <Row title={t("settings.fonts.yours")} hint={t("settings.fonts.yoursHint")}>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {custom.map((family) => (
            <div key={family} className="flex items-center gap-3 text-sm">
              <span style={{ fontFamily: `"${family}"` }}>{family}</span>
              <button
                type="button"
                aria-label={t("settings.fonts.remove", { family })}
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => void fonts.removeFont(family).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
              >
                {t("settings.fonts.removeButton")}
              </button>
            </div>
          ))}
          <input
            ref={input}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            aria-label={t("settings.fonts.fileLabel")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void add(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <ActionButton onClick={() => input.current?.click()}>{t("settings.fonts.addFile")}</ActionButton>
        </div>
      </Row>
    </>
  );
}
