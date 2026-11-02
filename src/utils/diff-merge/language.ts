import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export function languageForFile(name: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, name);
}

/** Cheap content sniffing; the first matching rule wins. Returns a `languages[].name`. */
export function detectLanguageName(text: string): string | null {
  const trimmed = text.trim();
  const shebang = /^#!.*/.exec(text)?.[0];
  if (shebang && /\b(ba|z|da|k)?sh\b/.test(shebang)) return "Shell";
  if (shebang && /python/.test(shebang)) return "Python";
  if (text.includes("<?php")) return "PHP";
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "JSON";
    } catch {
      /* not JSON */
    }
  }
  if (/^<\?xml/.test(trimmed)) return "XML";
  if (/^\s*<(!doctype html|html)/i.test(text)) return "HTML";
  if (/^package \w+/m.test(text) && text.includes("func ")) return "Go";
  // `import x from 'y'` is an ES module, not Python.
  if (/^(def |import |from \S+ import )/m.test(text) && !/^import .+ from ['"]/m.test(text)) return "Python";
  return null;
}

export function languageLabel(name: string | null): string {
  return name ?? "Plain text";
}

/** True if the first 8,000 bytes contain a NUL byte. */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}
