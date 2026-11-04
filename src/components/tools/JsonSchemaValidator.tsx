import { useEffect, useMemo, useState } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ToolFaqSection, type ToolFaqItem } from "@/components/tools/ToolFaq";
import { CodeTextarea, EditorPane, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { t as translate, useLocale, useT } from "@/i18n";
import {
  compileSchema,
  DRAFT_LABELS,
  generateSchema,
  loadValidator,
  locate,
  parseDocument,
  type ParsedDocument,
  type SchemaIssue,
  type ValidatorModules,
} from "@/utils/json-schema";

const FAQ_KEYS = ["drafts", "ref", "locate", "yaml", "formats", "generate"] as const;
const faqItems = (): ToolFaqItem[] => FAQ_KEYS.map((key) => ({ q: translate(`jsonSchema.faq.${key}.q`), a: translate(`jsonSchema.faq.${key}.a`) }));

/** Selects a range in a text area and scrolls it into view. */
const selectRange = (fieldId: string, doc: ParsedDocument | undefined, issue: SchemaIssue) => {
  const field = document.getElementById(fieldId);
  if (!(field instanceof HTMLTextAreaElement) || !doc?.ok) return;
  const range = locate(doc, issue.pointer, issue.key);
  if (!range) return;
  field.focus();
  field.setSelectionRange(range.start, range.end);
  const line = field.value.slice(0, range.start).split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 22;
  field.scrollTop = Math.max(0, line * lineHeight - field.clientHeight / 3);
};

function IssueList({ issues, onSelect }: { issues: SchemaIssue[]; onSelect: (issue: SchemaIssue) => void }) {
  return (
    <ul className="schema-issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue.pointer}-${issue.keyword}-${index}`}>
          <button type="button" className="schema-issue" onClick={() => onSelect(issue)}>
            <code className="schema-issue-path">{issue.path}</code>
            <span className="schema-issue-message">{issue.message}</span>
            <code className="schema-issue-keyword">{issue.keyword}</code>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function JsonSchemaValidator() {
  const t = useT();
  const { locale } = useLocale();
  const [schemaInput, setSchemaInput] = usePersistedInput("json-schema-schema");
  const [dataInput, setDataInput] = usePersistedInput("json-schema-data");
  const [modules, setModules] = useState<ValidatorModules>();
  const [loadError, setLoadError] = useState("");
  const schemaText = useDebouncedValue(schemaInput);
  const dataText = useDebouncedValue(dataInput);

  useEffect(() => {
    let active = true;
    loadValidator()
      .then((loaded) => active && setModules(loaded))
      .catch(() => active && setLoadError(translate("jsonSchema.error.load")));
    return () => {
      active = false;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const schemaDoc = useMemo(() => (schemaText.trim() ? parseDocument(schemaText) : undefined), [schemaText, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const dataDoc = useMemo(() => (dataText.trim() ? parseDocument(dataText) : undefined), [dataText, locale]);
  // Compile only when the schema changes, so typing in the data stays fast.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const compiled = useMemo(() => (modules && schemaDoc?.ok ? compileSchema(modules, schemaDoc.value) : undefined), [modules, schemaDoc, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-runs this so its messages follow the language
  const issues = useMemo(() => (compiled?.ok && dataDoc?.ok ? compiled.validate(dataDoc.value) : undefined), [compiled, dataDoc, locale]);

  const generate = () => {
    if (dataDoc?.ok) setSchemaInput(generateSchema(dataDoc.value));
  };

  const errors: string[] = [];
  if (loadError) errors.push(loadError);
  if (schemaDoc && "error" in schemaDoc) errors.push(t("jsonSchema.error.schema", { message: schemaDoc.error }));
  if (compiled && "error" in compiled) errors.push(compiled.error);
  if (dataDoc && "error" in dataDoc) errors.push(t("jsonSchema.error.data", { message: dataDoc.error }));
  const schemaIssues = compiled && "issues" in compiled ? compiled.issues : undefined;

  const notice = (
    <>
      {errors.length > 0 && (
        <div className="workspace-notice" data-tone="error" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
          {schemaIssues && schemaIssues.length > 0 && (
            <IssueList issues={schemaIssues} onSelect={(issue) => selectRange("json-schema-input", schemaDoc, issue)} />
          )}
        </div>
      )}
      {compiled?.ok && compiled.notice && <div className="workspace-notice">{compiled.notice}</div>}
      {issues && issues.length === 0 && (
        <div className="workspace-notice" data-tone="success" role="status">{t("jsonSchema.valid")}</div>
      )}
      {issues && issues.length > 0 && (
        <div className="workspace-notice schema-issues" data-tone="error">
          <p role="status">{t("jsonSchema.issuesSummary", { count: issues.length, formatted: issues.length.toLocaleString() })}</p>
          <IssueList issues={issues} onSelect={(issue) => selectRange("json-schema-data", dataDoc, issue)} />
        </div>
      )}
    </>
  );

  return (
    <ToolWorkspace
      id="json-schema"
      notice={notice}
      first={
        <EditorPane
          title={t("jsonSchema.schema.title")}
          htmlFor="json-schema-input"
          scroll={false}
          actions={
            <>
              {!schemaInput.trim() && dataDoc?.ok && (
                <button type="button" className="toolbar-text-button" onClick={generate}>{t("jsonSchema.generate")}</button>
              )}
              {schemaInput && <button type="button" className="toolbar-text-button" onClick={() => setSchemaInput("")}>{t("common.clear")}</button>}
            </>
          }
        >
          <CodeTextarea
            id="json-schema-input"
            placeholder={t("jsonSchema.schema.placeholder")}
            value={schemaInput}
            onChange={(e) => setSchemaInput(e.target.value)}
          />
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("jsonSchema.data.title")}
          htmlFor="json-schema-data"
          scroll={false}
          actions={dataInput ? <button type="button" className="toolbar-text-button" onClick={() => setDataInput("")}>{t("common.clear")}</button> : undefined}
        >
          <CodeTextarea
            id="json-schema-data"
            placeholder={t("jsonSchema.data.placeholder")}
            value={dataInput}
            onChange={(e) => setDataInput(e.target.value)}
          />
        </EditorPane>
      }
      status={
        <>
          {compiled?.ok && <span>{DRAFT_LABELS[compiled.draft]}</span>}
          {dataDoc?.ok && <span>{dataDoc.format === "yaml" ? t("jsonSchema.status.yamlData") : t("jsonSchema.status.jsonData")}</span>}
          {errors.length > 0 ? (
            <span className="text-destructive">{t("jsonSchema.status.invalid")}</span>
          ) : issues ? (
            issues.length ? <span className="text-destructive">{t("jsonSchema.issues", { count: issues.length, formatted: issues.length.toLocaleString() })}</span> : <span>{t("jsonSchema.status.valid")}</span>
          ) : !modules && !loadError ? (
            <span>{t("jsonSchema.status.loading")}</span>
          ) : (
            <span>{t("jsonSchema.status.ready")}</span>
          )}
        </>
      }
      help={<ToolFaqSection items={faqItems()} />}
    />
  );
}
