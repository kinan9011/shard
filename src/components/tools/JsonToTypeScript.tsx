import { useMemo, useState } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { t as translate, useLocale, useT } from "@/i18n";
import { CODE_LANGUAGES, jsonToCode, type CodeLanguage, type CodeOptions } from "@/utils/json-to-code";

interface Result {
  output: string;
  typeCount: number;
  error: string;
}

const EMPTY: Result = { output: "", typeCount: 0, error: "" };

const FAQ_KEYS = ["upload", "arrays", "unknown", "names"] as const;
const faqItems = (): ToolFaqItem[] => FAQ_KEYS.map((key) => ({ q: translate(`jsonToCode.faq.${key}.q`), a: translate(`jsonToCode.faq.${key}.a`) }));

const LABELS = Object.fromEntries(CODE_LANGUAGES.map((l) => [l.id, l.label])) as Record<CodeLanguage, string>;

export function JsonToTypeScript() {
  const t = useT();
  const { locale } = useLocale();
  const [input, setInput] = usePersistedInput("json-to-code");
  const [language, setLanguage] = useState<CodeLanguage>("typescript");
  const [rootName, setRootName] = useState("Root");
  const [tsStyle, setTsStyle] = useState<NonNullable<CodeOptions["tsStyle"]>>("interface");
  const [tsReadonly, setTsReadonly] = useState(false);
  const [pythonStyle, setPythonStyle] = useState<NonNullable<CodeOptions["pythonStyle"]>>("dataclass");

  const pendingInput = useDebouncedValue(input);
  const pendingRoot = useDebouncedValue(rootName);

  const result = useMemo<Result>(() => {
    if (!pendingInput.trim()) return EMPTY;
    try {
      return { ...jsonToCode(pendingInput, language, { rootName: pendingRoot, tsStyle, tsReadonly, pythonStyle }), error: "" };
    } catch (error) {
      return { ...EMPTY, error: error instanceof Error ? error.message : t("jsonToCode.error.unreadable") };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  }, [pendingInput, pendingRoot, language, tsStyle, tsReadonly, pythonStyle, t, locale]);

  const current = input.trim() ? result : EMPTY;
  const label = LABELS[language];

  const status = () => {
    if (current.error) return <span className="text-destructive">{t("jsonToCode.status.invalid")}</span>;
    if (!current.output) return <span>{t("jsonToCode.status.ready")}</span>;
    return <span>{t("jsonToCode.status.types", { count: current.typeCount, label })}</span>;
  };

  return (
    <ToolWorkspace
      id="json-typescript"
      toolbar={
        <Tabs value={language} onValueChange={(v) => setLanguage(v as CodeLanguage)}>
          <TabsList aria-label={t("jsonToCode.language")}>
            {CODE_LANGUAGES.map((l) => (
              <TabsTrigger key={l.id} value={l.id}>{l.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      secondaryToolbar={
        <>
          <label className="indent-control !border-l-0 !pl-0">
            {t("jsonToCode.rootName")}
            <input
              dir="ltr"
              data-dir-lock
              className="w-32 rounded-[5px] border border-input bg-transparent px-1.5 py-[3px] font-mono text-xs text-foreground"
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              placeholder="Root"
              spellCheck={false}
            />
          </label>
          {language === "typescript" && (
            <>
              <label className="indent-control">
                {t("jsonToCode.style")}
                <select aria-label={t("jsonToCode.style.typescript")} value={tsStyle} onChange={(e) => setTsStyle(e.target.value as typeof tsStyle)}>
                  <option value="interface">{t("jsonToCode.style.interfaces")}</option>
                  <option value="type">{t("jsonToCode.style.aliases")}</option>
                </select>
              </label>
              <label className="indent-control">
                <input type="checkbox" checked={tsReadonly} onChange={(e) => setTsReadonly(e.target.checked)} />
                {t("jsonToCode.readonly")}
              </label>
            </>
          )}
          {language === "python" && (
            <label className="indent-control">
              {t("jsonToCode.style")}
              <select aria-label={t("jsonToCode.style.python")} value={pythonStyle} onChange={(e) => setPythonStyle(e.target.value as typeof pythonStyle)}>
                <option value="dataclass">{t("jsonToCode.style.dataclasses")}</option>
                <option value="pydantic">{t("jsonToCode.style.pydantic")}</option>
              </select>
            </label>
          )}
        </>
      }
      notice={
        current.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{current.error}</div>
        ) : undefined
      }
      first={
        <EditorPane title={t("jsonToCode.input.title")} htmlFor="json-code-input" scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
          <CodeTextarea
            id="json-code-input"
            placeholder={'{"id": 1, "name": "Ada", "tags": ["admin"]}'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane title={t("jsonToCode.output.title", { label })} htmlFor={current.output ? "json-code-output" : undefined} scroll={false}
          actions={<CopyButton value={current.output} label={t("jsonToCode.copy", { label })} />}>
          {current.output ? (
            <CodeTextarea id="json-code-output" value={current.output} readOnly />
          ) : (
            <PaneEmpty title={t("jsonToCode.output.empty", { label })} hint={t("jsonToCode.output.emptyHint")} />
          )}
        </EditorPane>
      }
      status={status()}
      help={<ToolFaqSection items={faqItems()} />}
    />
  );
}
