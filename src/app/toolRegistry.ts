import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  AlignLeft,
  Code,
  Coins,
  FileCheck,
  FileDiff,
  FileJson,
  GitMerge,
  FileVideo,
  Image as ImageIcon,
  ScanLine,
  Shield,
  ShieldAlert,
  ShieldOff,
  Sparkles,
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
  { icon: ImageIcon, name: "Image Converter", id: "image-converter", category: "Media", keywords: ["image", "png", "jpg", "webp", "avif", "mozjpeg", "oxipng", "palette", "compress", "resize", "crop", "rotate", "flip"], kind: "legacy" },
  { icon: ScanLine, name: "QR Reader", id: "qr-reader", category: "Media", keywords: ["qr", "scan", "decode", "read"], kind: "legacy" },
  { icon: GitMerge, name: "Diff & Merge", id: "diff-merge", category: "Text Tools", keywords: ["diff", "merge", "compare", "side by side", "jetbrains", "patch", "folder compare", "directory diff"], kind: "core" },
  { icon: AlignLeft, name: "Text Compare", id: "text-compare", category: "Text Tools", keywords: ["diff", "compare", "difference"], kind: "core" },
  { icon: Shield, name: "JWT Decoder", id: "jwt-decoder", category: "Text Tools", keywords: ["jwt", "token", "bearer", "decode", "verify"], kind: "core" },
  { icon: ShieldOff, name: "Image Metadata Cleaner", id: "image-metadata", category: "AI Tools", keywords: ["exif", "metadata", "remove metadata", "gps", "c2pa", "content credentials", "ai generated", "stable diffusion prompt", "privacy", "strip exif"], kind: "legacy" },
  { icon: FileVideo, name: "Video Metadata Cleaner", id: "video-metadata", category: "AI Tools", keywords: ["video metadata", "remove metadata", "mp4", "mov", "mkv", "webm", "c2pa", "content credentials", "ai video", "sora", "veo", "runway", "gps", "gopro", "iphone video", "exif", "privacy", "strip metadata"], kind: "legacy" },
  { icon: ShieldAlert, name: "Secret & PII Redactor", id: "secret-redactor", category: "AI Tools", keywords: ["redact", "secrets", "api key", "token", "password", "pii", "mask", "sanitize", "chatgpt", "privacy"], kind: "legacy" },
  { icon: Coins, name: "Token Counter", id: "token-counter", category: "AI Tools", keywords: ["tokens", "tokenizer", "gpt", "openai", "o200k", "llm", "prompt", "cost", "context window", "claude"], kind: "legacy" },
  { icon: Sparkles, name: "AI Text Cleaner", id: "ai-text-cleaner", category: "AI Tools", keywords: ["clean text", "invisible characters", "zero width", "smart quotes", "em dash", "citations", "markdown", "chatgpt", "normalize"], kind: "legacy" },
] as const;

export type ToolDefinition = (typeof ALL_TOOLS)[number];
export type BuiltinToolId = ToolDefinition["id"];
/** @deprecated Use BuiltinToolId. Kept as an alias until plugin tools land. */
export type ToolId = BuiltinToolId;

export const TOOL_COMPONENTS: Record<BuiltinToolId, LazyExoticComponent<ComponentType>> = {
  "json-schema": lazyNamed(() => import("@/components/tools/JsonSchemaValidator"), "JsonSchemaValidator"),
  "video-metadata": lazyNamed(() => import("@/components/tools/VideoMetadataCleaner"), "VideoMetadataCleaner"),
  "image-metadata": lazyNamed(() => import("@/components/tools/ImageMetadataCleaner"), "ImageMetadataCleaner"),
  "secret-redactor": lazyNamed(() => import("@/components/tools/SecretRedactor"), "SecretRedactor"),
  "token-counter": lazyNamed(() => import("@/components/tools/TokenCounter"), "TokenCounter"),
  "ai-text-cleaner": lazyNamed(() => import("@/components/tools/AiTextCleaner"), "AiTextCleaner"),
  "qr-reader": lazyNamed(() => import("@/components/tools/QrReader"), "QrReader"),
  "json-viewer": lazyNamed(() => import("@/components/tools/JsonViewer"), "JsonViewer"),
  "code-playground": lazyNamed(() => import("@/components/tools/CodePlayground"), "CodePlayground"),
  "regex-generator": lazyNamed(() => import("@/components/tools/RegexGenerator"), "RegexGenerator"),
  "json-typescript": lazyNamed(() => import("@/components/tools/JsonToTypeScript"), "JsonToTypeScript"),
  "image-converter": lazyNamed(() => import("@/components/tools/ImageConverter"), "ImageConverter"),
  "text-compare": lazyNamed(() => import("@/components/tools/TextCompare"), "TextCompare"),
  "diff-merge": lazyNamed(() => import("@/components/tools/DiffMerge"), "DiffMerge"),
  "jwt-decoder": lazyNamed(() => import("@/components/tools/JwtDecoder"), "JwtDecoder"),
  "json-diff": lazyNamed(() => import("@/components/tools/JsonDiff"), "JsonDiff"),
};
