import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpDown, ChevronDown, ChevronUp, GitCompare } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { useT, type TKey } from "@/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { DirToggle } from "@/components/tools/DirToggle";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  areTextsEqual,
  calculateSimilarity,
  getChangeStarts,
  getCharDiff,
  getLineDiff,
  getTextStats,
  getUnifiedDiff,
  getWordDiff,
  mergeDiffResults,
  type CompareOptions,
  type DiffResult,
  type LineDiff,
} from "@/utils/text-compare";

const FAQ_KEYS: [TKey, TKey][] = [
  ["textCompare.faq.views.q", "textCompare.faq.views.a"],
  ["textCompare.faq.wordVsChar.q", "textCompare.faq.wordVsChar.a"],
  ["textCompare.faq.insertDelete.q", "textCompare.faq.insertDelete.a"],
  ["textCompare.faq.similarity.q", "textCompare.faq.similarity.a"],
  ["textCompare.faq.navigate.q", "textCompare.faq.navigate.a"],
  ["textCompare.faq.unifiedModified.q", "textCompare.faq.unifiedModified.a"],
];

type DiffView = "line" | "word" | "character" | "unified";

interface InlineDiffDetail {
  key: string;
  label: TKey;
  /** Line number shown in the label. */
  lineNumber: number;
  items: DiffResult[];
  /** Index of the change that starts at this line, if one does. */
  change?: number;
}

/** One entry per changed line, with the inline diff from the given function. */
function getInlineDetails(
  lineDiffs: LineDiff[],
  changeStarts: number[],
  diffLine: (oldLine: string, newLine: string) => DiffResult[]
): InlineDiffDetail[] {
  const changeAt = new Map(changeStarts.map((lineIndex, change) => [lineIndex, change]));
  return lineDiffs.flatMap((diff, index): InlineDiffDetail[] => {
    if (diff.type === "unchanged") return [];
    const base = { key: `${diff.type}-${index}`, change: changeAt.get(index) };
    if (diff.type === "modified") {
      return [{ ...base, label: "textCompare.inline.line", lineNumber: diff.lineNumber + 1, items: diffLine(diff.oldContent ?? "", diff.content) }];
    }
    if (diff.type === "added") {
      return [{ ...base, label: "textCompare.inline.addedLine", lineNumber: diff.lineNumber + 1, items: [{ type: "added", value: diff.content }] }];
    }
    return [{ ...base, label: "textCompare.inline.removedLine", lineNumber: diff.lineNumber + 1, items: [{ type: "removed", value: diff.content }] }];
  });
}

/** Index of the first line of each run of +/- lines in a unified diff. */
function getUnifiedChangeStarts(lines: string[]): number[] {
  const isChange = (line: string | undefined) =>
    line !== undefined && /^[+-]/.test(line) && !line.startsWith("---") && !line.startsWith("+++");
  return lines.flatMap((line, index) => (index >= 2 && isChange(line) && !(index > 2 && isChange(lines[index - 1])) ? [index] : []));
}

const LINE_STYLES: Record<LineDiff["type"], { marker: string; className: string }> = {
  added: { marker: "+", className: "bg-success/10 text-success" },
  removed: { marker: "-", className: "bg-destructive/10 text-destructive" },
  modified: { marker: "~", className: "bg-warning/10 text-warning" },
  unchanged: { marker: " ", className: "text-foreground" },
};

const CURRENT_CHANGE_CLASS = "ring-1 ring-inset ring-ring";

const getInlineClassName = (type: DiffResult["type"]) => {
  switch (type) {
    case "added":
      return "rounded bg-success/20 px-0.5 text-success";
    case "removed":
      return "rounded bg-destructive/20 px-0.5 text-destructive line-through";
    default:
      return "text-foreground";
  }
};

const getUnifiedDiffLineClass = (line: string) => {
  if (line.startsWith("@@")) return "bg-info/10 text-info";
  if (line.startsWith("---") || line.startsWith("+++")) return "text-muted-foreground";
  if (line.startsWith("+")) return "bg-success/10 text-success";
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive";
  return "text-foreground";
};

export function TextCompare() {
  const t = useT();
  const [text1, setText1] = usePersistedInput("text-compare-1");
  const [text2, setText2] = usePersistedInput("text-compare-2");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [view, setView] = useState<DiffView>("line");
  const [currentChange, setCurrentChange] = useState(0);
  const diffRef = useRef<HTMLDivElement>(null);
  const original = useDebouncedValue(text1);
  const modified = useDebouncedValue(text2);

  const result = useMemo(() => {
    if (!original && !modified) return null;
    const options: CompareOptions = { ignoreWhitespace, ignoreCase };
    const lineDiffs = getLineDiff(original, modified, options);
    const changeStarts = getChangeStarts(lineDiffs);
    const count = (type: LineDiff["type"]) => lineDiffs.filter((diff) => diff.type === type).length;
    const unifiedDiff = getUnifiedDiff(original, modified, 3, options);
    return {
      lineDiffs,
      changeStarts,
      added: count("added"),
      removed: count("removed"),
      modified: count("modified"),
      unchanged: count("unchanged"),
      similarity: Math.round(calculateSimilarity(original, modified, options)),
      equal: areTextsEqual(original, modified, options),
      unifiedDiff,
      unifiedChangeStarts: getUnifiedChangeStarts(unifiedDiff),
      wordDetails: getInlineDetails(lineDiffs, changeStarts, (a, b) => getWordDiff(a, b, options)),
      characterDetails: getInlineDetails(lineDiffs, changeStarts, (a, b) => mergeDiffResults(getCharDiff(a, b))),
    };
  }, [original, modified, ignoreWhitespace, ignoreCase]);

  const changeCount = result?.changeStarts.length ?? 0;
  const activeChange = Math.min(currentChange, Math.max(0, changeCount - 1));

  // A new comparison starts at the first change.
  useEffect(() => setCurrentChange(0), [result]);

  const goToChange = (step: number) => {
    if (changeCount === 0) return;
    const next = (activeChange + step + changeCount) % changeCount;
    setCurrentChange(next);
    diffRef.current?.querySelector(`[data-change="${next}"]`)?.scrollIntoView?.({ block: "center" });
  };

  const swap = () => {
    setText1(text2);
    setText2(text1);
  };

  const changeProps = (change: number | undefined) =>
    change === undefined ? {} : { "data-change": change };
  const currentClass = (change: number | undefined) => (change !== undefined && change === activeChange ? CURRENT_CHANGE_CLASS : "");

  const statsJson = result
    ? JSON.stringify(
        {
          similarity: result.similarity,
          equal: result.equal,
          added: result.added,
          removed: result.removed,
          modified: result.modified,
          unchanged: result.unchanged,
          original: getTextStats(original),
          modifiedText: getTextStats(modified),
        },
        null,
        2
      )
    : "";

  const inputPane = (id: string, title: string, value: string, onChange: (next: string) => void, placeholder: string) => (
    <EditorPane
      title={title}
      htmlFor={id}
      scroll={false}
      actions={
        value ? (
          <>
            <DirToggle target={id} />
            <span className="text-xs font-normal text-muted-foreground">{t("textCompare.lineCount", { count: value.split("\n").length })}</span>
            <button type="button" className="toolbar-text-button" onClick={() => onChange("")}>{t("common.clear")}</button>
          </>
        ) : undefined
      }
    >
      <CodeTextarea text id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </EditorPane>
  );

  const renderLineView = (lineDiffs: LineDiff[], changeStarts: number[]) => {
    const changeAt = new Map(changeStarts.map((lineIndex, change) => [lineIndex, change]));
    return (
      <div className="py-2 font-mono text-sm leading-[22px]">
        {lineDiffs.map((diff, index) => {
          const style = LINE_STYLES[diff.type];
          const change = changeAt.get(index);
          return (
            <div key={`${diff.lineNumber}-${index}`} className={`${style.className} ${currentClass(change)}`} {...changeProps(change)}>
              {diff.type === "modified" && diff.oldContent !== undefined && (
                <div className="grid grid-cols-[3rem_1.5rem_1fr] bg-destructive/10 text-destructive">
                  <span className="select-none pe-2 text-end text-foreground/75">{(diff.oldLineNumber ?? diff.lineNumber) + 1}</span>
                  <span className="select-none" aria-hidden="true">-</span>
                  <span className="whitespace-pre-wrap break-words pe-4">{diff.oldContent}</span>
                </div>
              )}
              <div className={`grid grid-cols-[3rem_1.5rem_1fr] ${diff.type === "modified" ? "bg-success/10 text-success" : ""}`}>
                <span className="select-none pe-2 text-end text-foreground/75">{diff.lineNumber + 1}</span>
                <span className="select-none" aria-hidden="true">{diff.type === "modified" ? "+" : style.marker}</span>
                <span className="whitespace-pre-wrap break-words pe-4">{diff.content}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderUnifiedView = (lines: string[], changeStarts: number[]) => {
    if (lines.length === 0) return <PaneEmpty title={t("textCompare.empty.noDifferences")} hint={t("textCompare.empty.identical")} />;
    const changeAt = new Map(changeStarts.map((lineIndex, change) => [lineIndex, change]));
    return (
      <div className="py-2 font-mono text-sm leading-[22px]">
        {lines.map((line, index) => {
          const change = changeAt.get(index);
          return (
            <div
              key={`${line}-${index}`}
              className={`whitespace-pre px-4 ${getUnifiedDiffLineClass(line)} ${currentClass(change)}`}
              {...changeProps(change)}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  };

  const renderInlineView = (details: InlineDiffDetail[], hint: string) =>
    details.length > 0 ? (
      <div className="result-list">
        {details.map((detail) => (
          <div key={detail.key} className={`border-b border-border/50 px-4 py-2 ${currentClass(detail.change)}`} {...changeProps(detail.change)}>
            <div className="result-row-label mb-1">{t(detail.label, { n: detail.lineNumber })}</div>
            <div className="whitespace-pre-wrap break-words font-mono text-sm leading-[22px]">
              {detail.items.map((item, index) => (
                <span key={`${detail.key}-${index}`} data-diff={item.type} className={getInlineClassName(item.type)}>
                  {item.value || " "}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <PaneEmpty title={t("textCompare.empty.noDifferences")} hint={hint} />
    );

  let diffContent: ReactNode = null;
  if (result) {
    if (view === "line") diffContent = renderLineView(result.lineDiffs, result.changeStarts);
    else if (view === "word") diffContent = renderInlineView(result.wordDetails, t("textCompare.empty.noWord"));
    else if (view === "character") diffContent = renderInlineView(result.characterDetails, t("textCompare.empty.noChar"));
    else diffContent = renderUnifiedView(result.unifiedDiff, result.unifiedChangeStarts);
  }

  return (
    <ToolWorkspace
      id="text-compare"
      toolbar={
        <>
          <Tabs value={view} onValueChange={(v) => setView(v as DiffView)}>
            <TabsList aria-label={t("textCompare.view")}>
              <TabsTrigger value="line">{t("textCompare.view.line")}</TabsTrigger>
              <TabsTrigger value="word">{t("textCompare.view.word")}</TabsTrigger>
              <TabsTrigger value="character">{t("textCompare.view.character")}</TabsTrigger>
              <TabsTrigger value="unified">{t("textCompare.view.unified")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!text1 && !text2}>
            <ArrowUpDown size={14} aria-hidden="true" />
            {t("textCompare.swap")}
          </button>
          <label className="option-switch indent-control" htmlFor="text-compare-ignore-whitespace">
            {t("textCompare.ignoreWhitespace")}
            <Switch id="text-compare-ignore-whitespace" checked={ignoreWhitespace} onCheckedChange={setIgnoreWhitespace} />
          </label>
          <label className="option-switch indent-control" htmlFor="text-compare-ignore-case">
            {t("textCompare.ignoreCase")}
            <Switch id="text-compare-ignore-case" checked={ignoreCase} onCheckedChange={setIgnoreCase} />
          </label>
        </>
      }
      first={
        <PanelGroup direction="vertical">
          <Panel minSize={20} defaultSize={50}>
            {inputPane("text-compare-original", t("textCompare.original"), text1, setText1, t("textCompare.original.placeholder"))}
          </Panel>
          <PanelResizeHandle className="editor-resize" aria-label={t("textCompare.resize")} />
          <Panel minSize={20} defaultSize={50}>
            {inputPane("text-compare-modified", t("textCompare.modified"), text2, setText2, t("textCompare.modified.placeholder"))}
          </Panel>
        </PanelGroup>
      }
      second={
        <EditorPane
          title={t("textCompare.differences")}
          actions={
            result ? (
              <>
                {changeCount > 0 && (
                  <>
                    <span className="text-xs font-normal text-muted-foreground" aria-live="polite">
                      {t("textCompare.changeOf", { current: activeChange + 1, total: changeCount })}
                    </span>
                    <button type="button" className="toolbar-text-button" onClick={() => goToChange(-1)} aria-label={t("textCompare.prevChange")}>
                      <ChevronUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="toolbar-text-button" onClick={() => goToChange(1)} aria-label={t("textCompare.nextChange")}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  </>
                )}
                {view === "unified" && <CopyButton value={result.unifiedDiff.join("\n")} label={t("textCompare.copyPatch")} />}
                <CopyButton value={statsJson} label={t("textCompare.copyStats")} />
              </>
            ) : undefined
          }
        >
          {!result ? (
            <PaneEmpty
              icon={<GitCompare size={20} aria-hidden="true" />}
              title={t("textCompare.empty.title")}
              hint={t("textCompare.empty.hint")}
            />
          ) : (
            <div ref={diffRef} className="contents">{diffContent}</div>
          )}
        </EditorPane>
      }
      status={
        result ? (
          <>
            <span className={result.equal ? "text-success" : undefined}>{result.equal ? t("textCompare.identical") : t("textCompare.different")}</span>
            <span>{t("textCompare.similar", { percent: result.similarity })}</span>
            <span>
              <span className="text-success">{t("textCompare.added", { count: result.added })}</span>·
              <span className="text-destructive">{t("textCompare.removed", { count: result.removed })}</span>·
              <span className="text-warning">{t("textCompare.modifiedCount", { count: result.modified })}</span>
            </span>
          </>
        ) : (
          <span>{t("textCompare.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map(([q, a]) => ({ q: t(q), a: t(a) }))} />}
    />
  );
}
