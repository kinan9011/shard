import { useMemo, useRef, useState } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { useIsMobile } from "@/hooks/useIsMobile";
import { AlignLeft, CheckCircle2, Columns2, Clipboard, Rows2, ShieldCheck } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { describeJsonValue, getJsonPaths, renderJsonView, type JsonViewMode } from "@/utils/json";
import { errorExcerpt, readJson } from "@/utils/json-repair";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useWindowedRows } from "@/hooks/useWindowedRows";
import { toast } from "sonner";
import { readClipboardText } from "@/lib/desktop";
import { CopyButton } from "@/components/tools/CopyButton";
import { SendToMenu } from "@/components/tools/SendToMenu";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { t as translate, useLocale, useT, type TKey } from "@/i18n";

const LAYOUT_KEY = "shard-json-layout";
// Larger input waits for a pause in typing before it is read again.
const LIVE_LIMIT = 200_000;
/** `.code-output pre` is 14px/24px. Past this many lines only the rows near the viewport render. */
const OUTPUT_ROW_HEIGHT = 24;
const WINDOW_AFTER = 2000;
const INDENTS: Record<string, number | string> = { "2": 2, "4": 4, tab: "\t" };
const MODES: [JsonViewMode, TKey | null][] = [["format", "jsonViewer.mode.format"], ["minify", "jsonViewer.mode.minify"], ["sort", "jsonViewer.mode.sort"], ["yaml", null], ["xml", null]];

const FAQ_KEYS = ["input", "repair", "refuse", "undefined", "ndjson", "largeNumbers", "privacy"] as const;
const faqItems = (): ToolFaqItem[] => FAQ_KEYS.map((key) => ({ q: translate(`jsonViewer.faq.${key}.q`), a: translate(`jsonViewer.faq.${key}.a`) }));

function readLayout(): "side" | "below" {
  try { return localStorage.getItem(LAYOUT_KEY) === "below" ? "below" : "side"; }
  catch { return "side"; }
}

// React escapes every token; user content is never inserted as HTML.
function JsonCode({ value }: { value: string }) {
  const tokens = value.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
  return <>{tokens.map((token, index) => {
    const kind = token.startsWith('"') ? (token.trimEnd().endsWith(":") ? "key" : "string") : /^(true|false|null)$/.test(token) ? "literal" : /^-?\d/.test(token) ? "number" : "plain";
    return <span key={index} className={`json-${kind}`}>{token}</span>;
  })}</>;
}

export function JsonViewer() {
  const t = useT();
  const { locale } = useLocale();
  const [input, setInput] = usePersistedInput("json-viewer");
  const [indent, setIndent] = useState("2");
  const [chosen, setLayout] = useState(readLayout);
  // A phone is too narrow for two panes side by side: the result goes below, and the choice is not offered.
  const phone = useIsMobile();
  const layout: "side" | "below" = phone ? "below" : chosen;
  const [mode, setMode] = useState<JsonViewMode>("format");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The gutter follows the textarea scroll through a ref, so scrolling never re-renders the viewer.
  const gutterRef = useRef<HTMLDivElement>(null);
  const debouncedInput = useDebouncedValue(input, 300);
  const source = input.length > LIVE_LIMIT ? debouncedInput : input;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const read = useMemo(() => (source.trim() ? readJson(source) : null), [source, locale]);
  const value = read?.ok ? read.value : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const view = useMemo(() => (read?.ok ? renderJsonView(read.value, mode, INDENTS[indent], query) : null), [read, mode, indent, query, locale]);
  const stats = useMemo(() => (read?.ok ? describeJsonValue(read.value) : null), [read]);
  const suggestions = useMemo(() => (value === undefined || source.length > LIVE_LIMIT ? [] : getJsonPaths(value).slice(0, 100)), [value, source]);
  const output = view?.ok ? view.text : "";
  const inputLineCount = useMemo(() => input.split("\n").length, [input]);
  // One text node, not one element per line: a 50k-line paste would otherwise build 50k divs.
  const inputGutter = useMemo(() => Array.from({ length: inputLineCount }, (_, index) => index + 1).join("\n"), [inputLineCount]);
  const highlight = view?.ok && view.kind === "json";
  const outputLines = useMemo(() => output.split("\n"), [output]);
  // Long outputs render only the rows near the viewport; shorter ones render whole so find-in-page still works.
  const windowed = outputLines.length > WINDOW_AFTER;
  const { ref: outputRef, first, last } = useWindowedRows(outputLines.length, OUTPUT_ROW_HEIGHT, windowed);
  const outputRows = useMemo(
    () => outputLines.slice(first, last).map((line, i) => <div className="code-line" key={first + i}><span className="output-line-number" aria-hidden="true">{first + i + 1}</span><code>{highlight ? <JsonCode value={line} /> : line}</code></div>),
    [outputLines, first, last, highlight],
  );
  const outputBytes = useMemo(() => new TextEncoder().encode(output).length, [output]);
  const error = read && "error" in read ? read.error : null;
  const excerpt = error ? errorExcerpt(source, error.offset) : null;

  const changeLayout = (next: "side" | "below") => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* Session preference still works. */ }
  };
  const paste = async () => {
    try { setInput(await readClipboardText()); }
    catch { toast.error(t("jsonViewer.toast.clipboard")); }
  };
  const showError = () => {
    const textarea = inputRef.current;
    if (!textarea || !error) return;
    textarea.focus();
    textarea.setSelectionRange(error.offset, Math.min(error.offset + 1, source.length));
  };

  return <div className="json-workspace">
    <div className="editor-toolbar">
      <div className="toolbar-actions">
        <div className="layout-switch" role="group" aria-label={t("jsonViewer.output.group")}>
          {MODES.map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{id === "format" && <AlignLeft size={14} />}{label ? t(label) : id.toUpperCase()}</button>)}
        </div>
        <label className="indent-control">{t("jsonViewer.indent.label")} <select aria-label={t("jsonViewer.indent.aria")} value={indent} onChange={(event) => setIndent(event.target.value)}><option value="2">{t("jsonViewer.indent.spaces2")}</option><option value="4">{t("jsonViewer.indent.spaces4")}</option><option value="tab">{t("jsonViewer.indent.tab")}</option></select></label>
      </div>
      <div className="layout-switch hidden sm:flex" role="group" aria-label={t("jsonViewer.layout.group")}>
        <button type="button" aria-pressed={layout === "side"} onClick={() => changeLayout("side")}><Columns2 size={14} />{t("jsonViewer.layout.side")}</button>
        <button type="button" aria-pressed={layout === "below"} onClick={() => changeLayout("below")}><Rows2 size={14} />{t("jsonViewer.layout.below")}</button>
      </div>
    </div>
    <div className="editor-toolbar" role="search">
      <div className="toolbar-actions">
        <label className="indent-control" style={{ borderLeft: 0, paddingLeft: 0 }} htmlFor="json-query-input">{t("jsonViewer.query.label")}</label>
        <input id="json-query-input" dir="ltr" data-dir-lock data-code-placeholder type="text" list="json-query-paths" spellCheck={false} autoComplete="off" value={query} placeholder="$.tools[0]" aria-describedby="json-query-hint"
          style={{ minWidth: 220, padding: "4px 8px", border: "1px solid hsl(var(--input))", borderRadius: 6, background: "transparent", fontFamily: "monospace", fontSize: 12 }}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setMode("query"); } }} />
        <datalist id="json-query-paths">{suggestions.map((path) => <option key={path} value={path} />)}</datalist>
        <button type="button" className="toolbar-text-button" aria-pressed={mode === "query"} onClick={() => setMode("query")}>{t("jsonViewer.query.run")}</button>
        <span id="json-query-hint" className="indent-control" style={{ borderLeft: 0 }}>{t("jsonViewer.query.hint")}</span>
      </div>
    </div>
    {read?.ok && read.notice && <div className="json-info" role="status">{read.notice}</div>}
    {read?.ok && read.largeNumbers > 0 && <div className="json-info" role="status">{t("jsonViewer.largeNumbers", { count: read.largeNumbers })}</div>}
    {view && "message" in view && <div className="json-info" role="status">{view.message}</div>}
    {error && excerpt && <div className="json-error" role="alert">
      <strong>{t("jsonViewer.error.invalid")}</strong> {t("conversion.position", { line: error.line, column: error.column, message: error.message })}{" "}
      <button type="button" className="toolbar-text-button" style={{ color: "inherit", textDecoration: "underline" }} onClick={showError}>{t("jsonViewer.error.show")}</button>
      <pre aria-hidden="true" style={{ margin: "6px 0 0", fontFamily: "monospace", whiteSpace: "pre" }}>{excerpt.text}{"\n"}{" ".repeat(excerpt.caret)}^</pre>
    </div>}
    <div className="editor-panels" data-layout={layout}>
      <PanelGroup direction={layout === "side" ? "horizontal" : "vertical"} key={layout}>
        <Panel minSize={20} defaultSize={50}>
          <div className="editor-pane">
            <div className="editor-pane-header"><label htmlFor="json-workspace-input">{t("jsonViewer.input.title")}</label><button type="button" className="toolbar-text-button" onClick={paste}><Clipboard size={14} />{t("common.paste")}</button></div>
            <div className="code-input-wrap">
              <div className="line-numbers" aria-hidden="true"><div ref={gutterRef} style={{ whiteSpace: "pre" }}>{inputGutter}</div></div>
              <textarea ref={inputRef} id="json-workspace-input" dir="ltr" data-dir-lock spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" value={input} onScroll={(event) => { if (gutterRef.current) gutterRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`; }} onChange={(event) => setInput(event.target.value)} placeholder={t("jsonViewer.input.placeholder")} />
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="editor-resize" aria-label={t("jsonViewer.resize")} />
        <Panel minSize={20} defaultSize={50}>
          <div className="editor-pane">
            <div className="editor-pane-header"><span id="json-output-label">{t("jsonViewer.output.title")}</span><span className="flex items-center gap-1"><SendToMenu text={output} from="json-viewer" /><CopyButton value={output} /></span></div>
            <div ref={outputRef} className="code-output" tabIndex={0} role="region" aria-labelledby="json-output-label">
              {output ? <pre style={windowed ? { paddingTop: 16 + first * OUTPUT_ROW_HEIGHT, paddingBottom: 16 + (outputLines.length - last) * OUTPUT_ROW_HEIGHT } : undefined}>{outputRows}</pre> : <div className="editor-empty"><AlignLeft size={24} strokeWidth={1.3} /><p>{t("jsonViewer.output.empty")}</p><span>{t("jsonViewer.output.emptyHint")}</span></div>}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
    <div className="workspace-help"><ToolFaqSection items={faqItems()} /></div>
    <footer className="editor-status" aria-live="polite">
      <span>{read?.ok ? <><CheckCircle2 size={14} className="status-valid" />{read.notice ? t("jsonViewer.status.converted") : t("jsonViewer.status.valid")}</> : error ? t("jsonViewer.status.check") : t("jsonViewer.status.ready")}</span>
      {stats && <span>{t("jsonViewer.status.stats", { type: t(`jsonViewer.type.${stats.type}`), keys: stats.keys, depth: stats.depth })}</span>}
      {output && <span>{t("jsonViewer.status.size", { lines: outputLines.length, bytes: outputBytes })}</span>}
      <span className="ms-auto">UTF-8</span><span><ShieldCheck size={13} />{t("jsonViewer.status.local")}</span>
    </footer>
  </div>;
}
