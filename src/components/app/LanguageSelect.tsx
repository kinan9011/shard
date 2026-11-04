import { useState } from "react";
import { LOCALES, getLanguagePref, setLanguage, useLocale, useT, type LanguagePref } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The language of the app: the system's, or one of `LOCALES` under its own native name. */
export function LanguageSelect({ id, className = "w-[180px]" }: { id?: string; className?: string }) {
  const t = useT();
  // Subscribes to language changes. Picking "system" or the language the system already has does not change the locale, so the choice is kept here too.
  useLocale();
  const [pref, setPref] = useState<LanguagePref>(getLanguagePref);
  const change = (value: string) => {
    setPref(value as LanguagePref);
    void setLanguage(value as LanguagePref);
  };
  return (
    <Select value={pref} onValueChange={change}>
      <SelectTrigger id={id} aria-label={t("language.label")} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">{t("language.system")}</SelectItem>
        {LOCALES.map((locale) => (
          // The native name is never translated, so a person can find their own language.
          <SelectItem key={locale.id} value={locale.id} lang={locale.tag} dir={locale.dir}>
            {locale.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
