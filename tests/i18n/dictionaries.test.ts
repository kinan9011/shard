import { describe, expect, it } from "vitest";
import en from "@/i18n/en";
import { LOCALES, type Dict } from "@/i18n";

const SUFFIX = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(SUFFIX, "");
const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

const english = en as Dict;
const familyOf = new Map<string, string[]>();
for (const key of Object.keys(english)) {
  const name = base(key);
  familyOf.set(name, [...(familyOf.get(name) ?? []), key]);
}
const isPlural = (name: string) => (familyOf.get(name) ?? []).some((key) => SUFFIX.test(key));

const others = LOCALES.filter((l) => l.id !== "en");

describe.each(others)("translations: $id", ({ id }) => {
  let dict: Dict;
  it("loads", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    expect(Object.keys(dict).length).toBeGreaterThan(0);
  });

  it("translates every key of the English dictionary", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    const missing: string[] = [];
    for (const name of familyOf.keys()) {
      // A plural family needs at least its `_other` form, a plain key needs itself.
      const need = isPlural(name) ? `${name}_other` : name;
      if (!dict[need]) missing.push(need);
    }
    expect(missing).toEqual([]);
  });

  it("has no key the English dictionary lacks", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    const extra = Object.keys(dict).filter((key) => !(key in english) && !(SUFFIX.test(key) && isPlural(base(key))));
    expect(extra).toEqual([]);
  });

  it("only uses the plural forms of the language", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    const allowed = new Set(new Intl.PluralRules(LOCALES.find((l) => l.id === id)!.tag).resolvedOptions().pluralCategories);
    const wrong = Object.keys(dict).filter((key) => SUFFIX.test(key) && !allowed.has(key.match(SUFFIX)![1] as never));
    expect(wrong).toEqual([]);
  });

  it("keeps the {placeholders} of the English text", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    const bad: string[] = [];
    for (const [key, text] of Object.entries(dict)) {
      const name = base(key);
      const family = familyOf.get(name) ?? [];
      const want = new Set(family.flatMap((k) => [...placeholders(english[k])]));
      const got = placeholders(text);
      const plural = SUFFIX.test(key) && isPlural(name);
      // A plural form may leave out {count} ("one day"); a plain text must match exactly.
      const ok = plural ? [...got].every((p) => want.has(p)) : got.size === want.size && [...got].every((p) => want.has(p));
      if (!ok) bad.push(`${key}: ${[...got].join(",")} vs ${[...want].join(",")}`);
    }
    expect(bad).toEqual([]);
  });

  it("has no empty text", async () => {
    dict = (await import(`../../src/i18n/locales/${id}.ts`)).default;
    expect(Object.entries(dict).filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
  });
});
