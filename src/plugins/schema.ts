import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { PERMISSION_NAMES, PLUGIN_RUNTIMES, type PluginIndex, type PluginManifest, type ValidationResult } from "./types";

const ID_PATTERN = "^[a-z0-9][a-z0-9-]{1,63}$";
const HOST_PATTERN = "^(\\*\\.)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?$";
// Official semver.org pattern. Build metadata is allowed; a "v" prefix and partial versions are not (same as the Rust crate).
const SEMVER_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
const str = { type: "string", minLength: 1 } as const;

const permissionSchema = {
  type: "object",
  required: ["name", "reason"],
  properties: {
    name: { enum: [...PERMISSION_NAMES] },
    hosts: { type: "array", items: { type: "string", pattern: HOST_PATTERN } },
    reason: str,
    optional: { type: "boolean" },
  },
  // Only `network` takes hosts, and it needs at least one.
  if: { properties: { name: { const: "network" } }, required: ["name"] },
  then: { required: ["hosts"], properties: { hosts: { minItems: 1 } } },
  else: { not: { required: ["hosts"] } },
} as const;

const permissions = { type: "array", items: permissionSchema } as const;
const version = { type: "string", pattern: SEMVER_PATTERN } as const;
const runtime = { enum: [...PLUGIN_RUNTIMES] } as const;
const idString = { type: "string", pattern: ID_PATTERN } as const;

export const manifestSchema = {
  type: "object",
  required: ["id", "name", "version", "description", "entry", "runtime"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN },
    name: str,
    version,
    description: str,
    longDescription: { type: "string" },
    category: str,
    keywords: { type: "array", items: { type: "string" } },
    icon: str,
    entry: str,
    runtime,
    permissions,
    minAppVersion: version,
    license: str,
    source: { type: "string", pattern: "^https?://" },
    screenshots: { type: "array", items: str },
    changelog: str,
  },
} as const;

export const indexSchema = {
  type: "object",
  required: ["schema", "name", "plugins"],
  properties: {
    schema: { const: 1 },
    name: str,
    // Optional: named sets of plugins the first-run screen offers (Launcher layout).
    bundles: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "plugins"],
        properties: {
          id: idString,
          name: str,
          plugins: { type: "array", minItems: 1, items: idString },
        },
      },
    },
    // Optional: color themes. `url` is the theme's JSON file (see docs/themes.md), at most 64 KB.
    themes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "version", "url", "sha256", "size"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
          name: str,
          version,
          description: { type: "string" },
          url: { type: "string", format: "uri" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          size: { type: "integer", minimum: 1, maximum: 65536 },
        },
      },
    },
    plugins: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "version", "description", "runtime", "url", "sha256", "size"],
        properties: {
          id: { type: "string", pattern: ID_PATTERN },
          name: str,
          version,
          description: str,
          category: str,
          runtime,
          permissions,
          minAppVersion: version,
          url: { type: "string", format: "uri" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          size: { type: "integer", minimum: 0 },
          released: { type: "string", format: "date" },
          changelog: { type: "string" },
          icon: str,
        },
      },
    },
  },
} as const;

// Unknown properties are allowed (forward compatible), matching the Rust side.
const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);

const checkManifest = ajv.compile(manifestSchema);
const checkIndex = ajv.compile(indexSchema);

/** `/permissions/0/name` -> `permissions[0].name` */
function pathOf(instancePath: string): string {
  return instancePath
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((out, part) => (/^\d+$/.test(part) ? `${out}[${part}]` : out ? `${out}.${part}` : part), "");
}

function describe(error: ErrorObject): string {
  const where = pathOf(error.instancePath);
  const prefix = where ? `${where}: ` : "";
  const p = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "required":
      return `${where ? `${where}.` : ""}${p.missingProperty}: is required`;
    case "enum":
      return `${prefix}must be one of ${(p.allowedValues as unknown[]).join(", ")}`;
    case "const":
      return `${prefix}must be ${JSON.stringify(p.allowedValue)}`;
    case "pattern":
      return `${prefix}"${error.data}" does not match ${p.pattern}`;
    case "format":
      return `${prefix}"${error.data}" is not a valid ${p.format}`;
    case "type":
      return `${prefix}must be ${p.type === "object" || p.type === "array" ? "an" : "a"} ${p.type}`;
    case "minItems":
      return `${prefix}needs at least ${p.limit} item${p.limit === 1 ? "" : "s"}`;
    case "not":
      return `${prefix}is not allowed here (only the network permission takes hosts)`;
    case "if":
      return ""; // the useful error is the one from then/else
    default:
      return `${prefix}${error.message ?? "is invalid"}`;
  }
}

function readable(errors: ErrorObject[] | null | undefined): string[] {
  return [...new Set((errors ?? []).map(describe).filter(Boolean))];
}

export function validateManifest(data: unknown): ValidationResult<PluginManifest> {
  return checkManifest(data) ? { ok: true, value: data as PluginManifest } : { ok: false, errors: readable(checkManifest.errors) };
}

export function validateIndex(data: unknown): ValidationResult<PluginIndex> {
  if (!checkIndex(data)) return { ok: false, errors: readable(checkIndex.errors) };
  const index = data as PluginIndex;
  const seen = new Set<string>();
  const errors: string[] = [];
  index.plugins.forEach((plugin, i) => {
    if (seen.has(plugin.id)) errors.push(`plugins[${i}].id: "${plugin.id}" is listed more than once`);
    seen.add(plugin.id);
  });
  const themeIds = new Set<string>();
  index.themes?.forEach((theme, i) => {
    if (themeIds.has(theme.id)) errors.push(`themes[${i}].id: "${theme.id}" is listed more than once`);
    themeIds.add(theme.id);
  });
  const listed = new Set(index.plugins.map((plugin) => plugin.id));
  const bundleIds = new Set<string>();
  index.bundles?.forEach((bundle, i) => {
    if (bundleIds.has(bundle.id)) errors.push(`bundles[${i}].id: "${bundle.id}" is listed more than once`);
    bundleIds.add(bundle.id);
    const inBundle = new Set<string>();
    bundle.plugins.forEach((id, j) => {
      if (!listed.has(id)) errors.push(`bundles[${i}].plugins[${j}]: "${id}" is not listed in plugins`);
      else if (inBundle.has(id)) errors.push(`bundles[${i}].plugins[${j}]: "${id}" is listed more than once`);
      inBundle.add(id);
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: index };
}
