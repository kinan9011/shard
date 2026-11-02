import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  AlignLeft,
  Code,
  FileCheck,
  FileDiff,
  FileJson,
  GitMerge,
  Shield,
  Terminal,
  Type,
} from "lucide-react";

const lazyNamed = <T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) => lazy(() => loader().then((module) => ({ default: module[exportName] })));

// keywords: extra search terms, so "sha" finds Checksum. The command palette, the sidebar
// filter, and launchers such as Raycast (through the tool manifest) use them.
export const ALL_TOOLS = [
  { icon: FileJson, name: "JSON Viewer", id: "json-viewer", category: "Development Tools", keywords: ["json", "format", "pretty", "minify", "validate", "jsonpath", "query", "python dict", "ruby hash", "js object", "json5", "jsonc", "ndjson", "jsonl", "repair"], kind: "core" },
  { icon: Code, name: "Code Playground", id: "code-playground", category: "Development Tools", keywords: ["javascript", "js", "html", "css", "run", "editor"], kind: "core" },
  { icon: Terminal, name: "Regex Tester", id: "regex-generator", category: "Development Tools", keywords: ["regex", "regexp", "pattern", "match", "replace", "capture group", "regex generator"], kind: "core" },
  { icon: Type, name: "JSON to Code", id: "json-typescript", category: "Development Tools", keywords: ["typescript", "ts", "interface", "types", "go", "golang", "struct", "rust", "serde", "python", "dataclass", "pydantic", "swift", "codable", "kotlin", "json schema", "codegen", "model"], kind: "core" },
  { icon: FileCheck, name: "JSON Schema Validator", id: "json-schema", category: "Development Tools", keywords: ["json schema", "validate", "validator", "ajv", "draft 2020-12", "draft-07", "openapi", "kubernetes", "yaml"], kind: "core" },
  { icon: FileDiff, name: "JSON Diff", id: "json-diff", category: "Development Tools", keywords: ["json diff", "compare", "difference", "json patch", "rfc 6902", "structural", "yaml", "jsonpath"], kind: "core" },
  { icon: GitMerge, name: "Diff & Merge", id: "diff-merge", category: "Text Tools", keywords: ["diff", "merge", "compare", "side by side", "jetbrains", "patch", "folder compare", "directory diff"], kind: "core" },
  { icon: AlignLeft, name: "Text Compare", id: "text-compare", category: "Text Tools", keywords: ["diff", "compare", "difference"], kind: "core" },
  { icon: Shield, name: "JWT Decoder", id: "jwt-decoder", category: "Text Tools", keywords: ["jwt", "token", "bearer", "decode", "verify"], kind: "core" },
] as const;

export type ToolDefinition = (typeof ALL_TOOLS)[number];
export type BuiltinToolId = ToolDefinition["id"];
/** @deprecated Use BuiltinToolId. Kept as an alias until plugin tools land. */
export type ToolId = BuiltinToolId;

export const TOOL_COMPONENTS: Record<BuiltinToolId, LazyExoticComponent<ComponentType>> = {
  "json-schema": lazyNamed(() => import("@/components/tools/JsonSchemaValidator"), "JsonSchemaValidator"),
  "json-viewer": lazyNamed(() => import("@/components/tools/JsonViewer"), "JsonViewer"),
  "code-playground": lazyNamed(() => import("@/components/tools/CodePlayground"), "CodePlayground"),
  "regex-generator": lazyNamed(() => import("@/components/tools/RegexGenerator"), "RegexGenerator"),
  "json-typescript": lazyNamed(() => import("@/components/tools/JsonToTypeScript"), "JsonToTypeScript"),
  "text-compare": lazyNamed(() => import("@/components/tools/TextCompare"), "TextCompare"),
  "diff-merge": lazyNamed(() => import("@/components/tools/DiffMerge"), "DiffMerge"),
  "jwt-decoder": lazyNamed(() => import("@/components/tools/JwtDecoder"), "JwtDecoder"),
  "json-diff": lazyNamed(() => import("@/components/tools/JsonDiff"), "JsonDiff"),
};
