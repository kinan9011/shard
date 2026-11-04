export const FONT_STORAGE_KEY = "shard-fonts";

/** Whole-UI zoom steps. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const FIELD_SIZE_MIN = 10;
export const FIELD_SIZE_MAX = 24;
export const DEFAULT_FIELD_SIZE = 13;

export interface FontPrefs {
  /** Family of the app text (null: the bundled default). */
  ui: string | null;
  /** Zoom of the whole UI, one of `ZOOM_STEPS`. */
  zoom: number;
  /** Family of the text inside fields and editors (null: the bundled monospace). */
  field: string | null;
  /** Size in px of the text inside fields and editors. */
  fieldSize: number;
}

export const DEFAULT_FONT_PREFS: FontPrefs = { ui: null, zoom: 1, field: null, fieldSize: DEFAULT_FIELD_SIZE };

/** The families that ship with the app, and the system's own. `system-ui` is a CSS keyword, not a family name. */
export const BUILT_IN_FONTS: readonly { family: string; label: string }[] = [
  { family: "Inter", label: "Inter" },
  { family: "JetBrains Mono", label: "JetBrains Mono" },
  { family: "system-ui", label: "System UI" },
];

const FAMILY = /^[\p{L}\p{N} ._-]{1,64}$/u;

/** A family name that is safe to put into a stylesheet, or null. It is user input, so only plain name characters pass. */
export function sanitizeFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return FAMILY.test(name) ? name : null;
}

const quote = (family: string) => (family === "system-ui" ? family : `"${family}"`);

const clampSize = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= FIELD_SIZE_MIN && value <= FIELD_SIZE_MAX ? value : DEFAULT_FIELD_SIZE;

export function getStoredFonts(storage?: Pick<Storage, "getItem"> | null): FontPrefs {
  try {
    const raw = storage?.getItem(FONT_STORAGE_KEY);
    if (!raw) return DEFAULT_FONT_PREFS;
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      ui: sanitizeFamily(data.ui),
      zoom: ZOOM_STEPS.find((step) => step === data.zoom) ?? 1,
      field: sanitizeFamily(data.field),
      fieldSize: clampSize(data.fieldSize),
    };
  } catch {
    return DEFAULT_FONT_PREFS;
  }
}

// Text-like fields only: a checkbox or a slider has no text to restyle.
const FIELDS = [
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit])",
  "textarea",
  "pre",
  ".cm-editor .cm-scroller",
  ".line-numbers",
  ".output-line-number",
].join(",");

/**
 * The stylesheet for the font choices. Empty for the defaults, so an untouched app renders as before.
 * The field rule is `!important` because it is an explicit override of every size the tools set themselves.
 */
export function fontCss(prefs: FontPrefs): string {
  const rules: string[] = [];
  if (prefs.ui) rules.push(`:root{--font-ui:${quote(prefs.ui)},var(--font-ui-stack)}`);
  const declarations: string[] = [];
  if (prefs.field) declarations.push(`font-family:${quote(prefs.field)},var(--font-code-stack) !important`);
  if (prefs.fieldSize !== DEFAULT_FIELD_SIZE) {
    // One line height for every field keeps a textarea and its line-number gutter on the same rows.
    declarations.push(`font-size:${prefs.fieldSize}px !important`, `line-height:${prefs.fieldSize + 7}px !important`);
  }
  if (declarations.length) rules.push(`${FIELDS}{${declarations.join(";")}}`);
  return rules.join("\n");
}
