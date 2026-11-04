import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMemo, useState } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ArrowUpDown, GitCompare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { SendToMenu } from "@/components/tools/SendToMenu";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { t as translate, useLocale, useT, type TKey } from "@/i18n";
import {
  diffJson,
  formatChanges,
  formatPatch,
  parseSide,
  previewValue,
  valueType,
  type ArrayMode,
  type ChangeKind,
  type JsonChange,
} from "@/utils/json-diff";

const FAQ_KEYS = ["textCompare", "arrays", "input", "patch", "types"] as const;
const faqItems = (): ToolFaqItem[] => FAQ_KEYS.map((key) => ({ q: translate(`jsonDiff.faq.${key}.q`), a: translate(`jsonDiff.faq.${key}.a`) }));

const KINDS: { kind: ChangeKind; label: TKey; marker: string; className: string }[] = [
  { kind: "added", label: "jsonDiff.kind.added", marker: "+", className: "text-success" },
  { kind: "removed", label: "jsonDiff.kind.removed", marker: "-", className: "text-destructive" },
  { kind: "changed", label: "jsonDiff.kind.changed", marker: "~", className: "text-warning" },
  { kind: "type", label: "jsonDiff.kind.type", marker: "!", className: "text-warning" },
];
const KIND_STYLE = Object.fromEntries(KINDS.map((entry) => [entry.kind, entry])) as Record<ChangeKind, (typeof KINDS)[number]>;

/** Rows past this count are not drawn. Copy changes still copies all of them. */
const MAX_ROWS = 1000;

type Filter = ChangeKind | "all";

function ChangeRow({ change }: { change: JsonChange }) {
  const t = useT();
  const style = KIND_STYLE[change.kind];
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-2 border-b border-border/50 px-4 py-2 font-mono text-xs leading-[18px]" data-kind={change.kind}>
      <span className={`select-none font-semibold ${style.className}`} aria-label={t(style.label)}>{style.marker}</span>
      <span className="min-w-0 break-all text-foreground">{change.path}</span>
      <span aria-hidden="true" />
      <span className="min-w-0 break-all">
        {change.kind !== "added" && (
          <span className="text-destructive">
            {change.kind === "type" && `${valueType(change.oldValue)} `}
            {previewValue(change.oldValue)}
          </span>
        )}
        {(change.kind === "changed" || change.kind === "type") && <span className="text-muted-foreground"> → </span>}
        {change.kind !== "removed" && (
          <span className="text-success">
            {change.kind === "type" && `${valueType(change.newValue)} `}
            {previewValue(change.newValue)}
          </span>
        )}
      </span>
    </li>
  );
}

export function JsonDiff() {
  const t = useT();
  const { locale } = useLocale();
  const [left, setLeft] = usePersistedInput("json-diff-left");
  const [right, setRight] = usePersistedInput("json-diff-right");
  const [arrayMode, setArrayMode] = useState<ArrayMode>("index");
  const [matchKey, setMatchKey] = useState("id");
  const [ignoreOrder, setIgnoreOrder] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const leftText = useDebouncedValue(left);
  const rightText = useDebouncedValue(right);
  const keyText = useDebouncedValue(matchKey);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const leftSide = useMemo(() => (leftText.trim() ? parseSide(leftText) : undefined), [leftText, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const rightSide = useMemo(() => (rightText.trim() ? parseSide(rightText) : undefined), [rightText, locale]);
  const result = useMemo(
    () =>
      leftSide?.ok && rightSide?.ok
        ? diffJson(leftSide.value, rightSide.value, { arrayMode, matchKey: keyText, ignoreOrder, ignoreWhitespace })
        : undefined,
    [leftSide, rightSide, arrayMode, keyText, ignoreOrder, ignoreWhitespace],
  );

  const shown = useMemo(() => (result ? (filter === "all" ? result.changes : result.changes.filter((c) => c.kind === filter)) : []), [result, filter]);
  const changesText = useMemo(() => formatChanges(shown), [shown]);
  const patchText = useMemo(() => (result ? formatPatch(result.patch) : ""), [result]);

  const swap = () => {
    setLeft(right);
    setRight(left);
  };

  const errors: string[] = [];
  if (leftSide && "error" in leftSide) errors.push(t("jsonDiff.error.original", { message: leftSide.error }));
  if (rightSide && "error" in rightSide) errors.push(t("jsonDiff.error.modified", { message: rightSide.error }));
  const notices: string[] = [];
  if (leftSide?.ok && leftSide.notice) notices.push(t("jsonDiff.notice.original", { message: leftSide.notice }));
  if (rightSide?.ok && rightSide.notice) notices.push(t("jsonDiff.notice.modified", { message: rightSide.notice }));
  if (result && result.keyFallbacks > 0) {
    const key = keyText.trim() || "id";
    notices.push(t("jsonDiff.notice.keyFallback", { count: result.keyFallbacks, formatted: result.keyFallbacks.toLocaleString(), key }));
  }

  const notice = (
    <>
      {errors.length > 0 && (
        <div className="workspace-notice" data-tone="error" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      {notices.length > 0 && (
        <div className="workspace-notice" role="status">
          {notices.map((text) => <p key={text}>{text}</p>)}
        </div>
      )}
    </>
  );

  const total = result?.changes.length ?? 0;

  const inputPane = (id: string, title: string, value: string, onChange: (next: string) => void, placeholder: string) => (
    <EditorPane
      title={title}
      htmlFor={id}
      scroll={false}
      actions={value ? <button type="button" className="toolbar-text-button" onClick={() => onChange("")}>{t("common.clear")}</button> : undefined}
    >
      <CodeTextarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </EditorPane>
  );

  return (
    <ToolWorkspace
      id="json-diff"
      toolbar={
        <>
          <Tabs value={arrayMode} onValueChange={(v) => setArrayMode(v as ArrayMode)}>
            <TabsList aria-label={t("jsonDiff.arrayItems")}>
              <TabsTrigger value="index">{t("jsonDiff.byIndex")}</TabsTrigger>
              <TabsTrigger value="key">{t("jsonDiff.byKey")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {arrayMode === "key" && (
            <Input
              dir="ltr"
              data-dir-lock
              className="h-7 w-24 text-xs"
              aria-label={t("jsonDiff.matchKey")}
              value={matchKey}
              onChange={(e) => setMatchKey(e.target.value)}
              placeholder="id"
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <label className="option-switch indent-control" htmlFor="json-diff-ignore-order">
            {t("jsonDiff.ignoreOrder")}
            <Switch id="json-diff-ignore-order" checked={ignoreOrder} onCheckedChange={setIgnoreOrder} />
          </label>
          <label className="option-switch indent-control" htmlFor="json-diff-ignore-whitespace">
            {t("jsonDiff.ignoreWhitespace")}
            <Switch id="json-diff-ignore-whitespace" checked={ignoreWhitespace} onCheckedChange={setIgnoreWhitespace} />
          </label>
          <button type="button" className="toolbar-text-button" onClick={swap} disabled={!left && !right}>
            <ArrowUpDown size={14} aria-hidden="true" />
            {t("jsonDiff.swap")}
          </button>
        </>
      }
      secondaryToolbar={
        total > 0 ? (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList aria-label={t("jsonDiff.showChanges")}>
              <TabsTrigger value="all">{t("jsonDiff.tab.all", { count: total.toLocaleString() })}</TabsTrigger>
              {KINDS.map(({ kind, label }) => (
                <TabsTrigger key={kind} value={kind} disabled={!result?.counts[kind]}>
                  {t("jsonDiff.tab.kind", { label: t(label), count: result?.counts[kind].toLocaleString() ?? "" })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : undefined
      }
      notice={notice}
      first={
        <PanelGroup direction="vertical">
          <Panel minSize={20} defaultSize={50}>
            {inputPane("json-diff-original", t("jsonDiff.original"), left, setLeft, t("jsonDiff.original.placeholder"))}
          </Panel>
          <PanelResizeHandle className="editor-resize" aria-label={t("jsonDiff.resize")} />
          <Panel minSize={20} defaultSize={50}>
            {inputPane("json-diff-modified", t("jsonDiff.modified"), right, setRight, t("jsonDiff.modified.placeholder"))}
          </Panel>
        </PanelGroup>
      }
      second={
        <EditorPane
          title={t("jsonDiff.changes")}
          actions={
            total > 0 ? (
              <>
                <CopyButton value={changesText} label={t("jsonDiff.copyChanges")} />
                <CopyButton value={patchText} label={t("jsonDiff.copyPatch")} />
                <SendToMenu text={patchText} from="json-diff" label={t("jsonDiff.sendPatch")} />
              </>
            ) : undefined
          }
        >
          {!result ? (
            <PaneEmpty icon={<GitCompare size={20} aria-hidden="true" />} title={t("jsonDiff.empty.title")} hint={t("jsonDiff.empty.hint")} />
          ) : total === 0 ? (
            <PaneEmpty title={t("jsonDiff.none.title")} hint={t("jsonDiff.none.hint")} />
          ) : (
            <>
              <ul aria-label={t("jsonDiff.changes")}>
                {shown.slice(0, MAX_ROWS).map((change, index) => <ChangeRow key={`${change.path}-${index}`} change={change} />)}
              </ul>
              {shown.length > MAX_ROWS && (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  {t("jsonDiff.truncated", { max: MAX_ROWS.toLocaleString(), total: shown.length.toLocaleString() })}
                </p>
              )}
            </>
          )}
        </EditorPane>
      }
      status={
        <>
          {leftSide?.ok && rightSide?.ok && <span>{leftSide.format === rightSide.format ? leftSide.format.toUpperCase() : t("jsonDiff.status.formats", { left: leftSide.format.toUpperCase(), right: rightSide.format.toUpperCase() })}</span>}
          {errors.length > 0 ? (
            <span className="text-destructive">{t("jsonDiff.status.invalid")}</span>
          ) : result ? (
            total === 0 ? (
              <span className="text-success">{t("jsonDiff.none.title")}</span>
            ) : (
              <span>
                <span className="text-success">{t("jsonDiff.status.added", { count: result.counts.added })}</span>·
                <span className="text-destructive">{t("jsonDiff.status.removed", { count: result.counts.removed })}</span>·
                <span className="text-warning">{t("jsonDiff.status.changed", { count: result.counts.changed })}</span>·
                <span className="text-warning">{t("jsonDiff.status.type", { count: result.counts.type })}</span>
              </span>
            )
          ) : (
            <span>{t("jsonDiff.status.ready")}</span>
          )}
        </>
      }
      help={<ToolFaqSection items={faqItems()} />}
    />
  );
}
