import { afterEach, describe, expect, it } from "vitest";
import en from "@/i18n/en";
import { formatNumber, getDir, getLanguagePref, getLocale, LANGUAGE_STORAGE_KEY, resolveSystemLocale, setLanguage, t, type TKey } from "@/i18n";

const PLURAL = /_(zero|one|two|few|many|other)$/;
const pluralBase = Object.keys(en).find((key) => key.endsWith("_one"))!.replace(PLURAL, "") as TKey;

afterEach(async () => {
  await setLanguage("en");
});

describe("language", () => {
  it("starts in English, left to right", () => {
    expect(getLocale()).toBe("en");
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("switches the document language and direction, and saves the choice", async () => {
    await setLanguage("ar");
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(getDir()).toBe("rtl");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ar");
    expect(t("common.cancel")).not.toBe("Cancel");

    await setLanguage("he");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");

    await setLanguage("zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");

    await setLanguage("en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("follows the system when asked", async () => {
    await setLanguage("system");
    expect(getLanguagePref()).toBe("system");
    expect(getLocale()).toBe("en"); // jsdom reports en-US
  });

  it("matches the system's languages in order, with Hebrew's old code, and falls back to English", () => {
    expect(resolveSystemLocale(["de-DE", "en"])).toBe("de");
    expect(resolveSystemLocale(["pt-BR", "fr-CA"])).toBe("fr");
    expect(resolveSystemLocale(["zh-TW"])).toBe("zh");
    expect(resolveSystemLocale(["iw"])).toBe("he");
    expect(resolveSystemLocale(["xx", "yy"])).toBe("en");
    expect(resolveSystemLocale([])).toBe("en");
  });
});

describe("t", () => {
  it("fills {placeholders}, and leaves an unknown one as it is", () => {
    expect(t("dir.toggle", { mode: "Auto" })).toBe("Text direction: Auto");
    expect(t("dir.toggle", {})).toBe("Text direction: {mode}");
  });

  it("falls back to the key when nothing has it", () => {
    expect(t("no.such.key" as TKey)).toBe("no.such.key");
  });

  it("picks the plural form of the language", async () => {
    const one = t(pluralBase, { count: 1 });
    const many = t(pluralBase, { count: 5 });
    expect(one).not.toBe(many);

    await setLanguage("ar");
    const forms = [0, 1, 2, 5, 11, 100].map((count) => t(pluralBase, { count }));
    expect(forms.every((text) => text && text !== pluralBase)).toBe(true);
    // Arabic has a form for 0, 1, 2, a few, many and the rest.
    expect(new Set(forms).size).toBeGreaterThanOrEqual(5);

    await setLanguage("ja");
    expect(t(pluralBase, { count: 1 })).toBe(t(pluralBase, { count: 5 }).replace("5", "1"));
  });
});

describe("numbers", () => {
  it("always uses Latin digits, even in Arabic", async () => {
    await setLanguage("ar");
    expect(formatNumber(1234)).toMatch(/^1.?234$/);
    expect(formatNumber(1234)).not.toMatch(/[٠-٩]/);
  });
});
