import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type UIEvent } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { Regex } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { CopyButton } from "@/components/tools/CopyButton";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  INVALID_PATTERN_PREFIX,
  MATCH_LIMIT,
  REGEX_FLAGS,
  compileRegex,
  highlightSegments,
  parseRegexLiteral,
  toggleFlag,
  type RegexFlag,
  type RegexMatch,
  type RegexResult,
} from "@/utils/regex";
import { runRegexInWorker, TIMEOUT_ERROR, REGEX_TIMEOUT_MS } from "@/utils/regex-runner";
import { useT, formatNumber, type TKey } from "@/i18n";

type Mode = "match" | "replace";

interface Preset {
  /** The English name: the select value and the identity of the preset. */
  name: string;
  label: TKey;
  pattern: string;
  sample: string;
}

// Presets match whole lines, so applying one also turns on g and m.
const PRESETS: Preset[] = [
  { name: "Email", label: "regex.preset.email", pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", sample: "ann@example.com\nnot-an-email\nbob.smith+tag@mail.co" },
  { name: "URL", label: "regex.preset.url", pattern: "^https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+[/#?]?.*$", sample: "https://example.com/path?q=1\nftp://example.com\nhttp://localhost" },
  { name: "IPv4", label: "regex.preset.ipv4", pattern: "^((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}$", sample: "192.168.0.1\n256.1.1.1\n10.0.0.255" },
  { name: "Hex color", label: "regex.preset.hexColor", pattern: "^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$", sample: "#1e90ff\n#abc\n#12345g" },
  { name: "Date (YYYY-MM-DD)", label: "regex.preset.date", pattern: "^(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])$", sample: "2024-05-17\n2024-13-01\n1999-12-31" },
  { name: "Username", label: "regex.preset.username", pattern: "^[a-zA-Z0-9_]{3,16}$", sample: "dev_user\nab\nthis_name_is_far_too_long" },
  { name: "Strong password", label: "regex.preset.strongPassword", pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$", sample: "Secr3t!pass\npassword\nSHORT1!a" },
  { name: "Credit card", label: "regex.preset.creditCard", pattern: "^\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}$", sample: "4111 1111 1111 1111\n4111-1111-1111-1111\n1234" },
  { name: "Phone (US)", label: "regex.preset.phoneUs", pattern: "^\\+1\\s?\\(\\d{3}\\)\\s?\\d{3}[- ]?\\d{4}$", sample: "+1 (555) 123-4567\n555-1234" },
  { name: "Time (24h)", label: "regex.preset.time24", pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$", sample: "09:30\n23:59\n24:00" },
];

const FLAG_LABELS: Record<RegexFlag, TKey> = {
  g: "regex.flag.global",
  i: "regex.flag.ignoreCase",
  m: "regex.flag.multiline",
  s: "regex.flag.dotAll",
  u: "regex.flag.unicode",
};

const CHEAT_SHEET: [string, TKey][] = [
  [".", "regex.cheat.any"],
  ["\\d \\w \\s", "regex.cheat.digitWordSpace"],
  ["\\D \\W \\S", "regex.cheat.notDigitWordSpace"],
  ["[abc] [^abc]", "regex.cheat.oneOf"],
  ["^ $", "regex.cheat.startEnd"],
  ["\\b", "regex.cheat.wordBoundary"],
  ["* + ?", "regex.cheat.quantifiers"],
  ["{2,5}", "regex.cheat.range"],
  ["*? +?", "regex.cheat.lazy"],
  ["(…)", "regex.cheat.group"],
  ["(?<name>…)", "regex.cheat.namedGroup"],
  ["(?:…)", "regex.cheat.nonCapture"],
  ["a|b", "regex.cheat.alternation"],
  ["(?=…) (?!…)", "regex.cheat.lookahead"],
  ["(?<=…) (?<!…)", "regex.cheat.lookbehind"],
  ["\\1 \\k<name>", "regex.cheat.backref"],
  ["$1 $<name>", "regex.cheat.replaceGroup"],
  ["$&", "regex.cheat.replaceWhole"],
  ["$` $'", "regex.cheat.replaceAround"],
  ["$$", "regex.cheat.replaceDollar"],
];

const FAQ_KEYS: [TKey, TKey][] = [
  ["regex.faq.syntax.q", "regex.faq.syntax.a"],
  ["regex.faq.flags.q", "regex.faq.flags.a"],
  ["regex.faq.replacement.q", "regex.faq.replacement.a"],
  ["regex.faq.unmatchedGroup.q", "regex.faq.unmatchedGroup.a"],
  ["regex.faq.slow.q", "regex.faq.slow.a"],
  ["regex.faq.literal.q", "regex.faq.literal.a"],
  ["regex.faq.presets.q", "regex.faq.presets.a"],
];

function MatchList({ matches }: { matches: RegexMatch[] }) {
  const t = useT();
  return (
    <ol className="regex-matches" aria-label={t("regex.matches")}>
      {matches.map((match, i) => (
        <li key={`${match.index}-${i}`}>
          <div className="regex-match-head">
            <span>{t("regex.match.number", { n: i + 1 })}</span>
            <span>{match.index === match.end ? t("regex.match.at", { index: match.index }) : `${match.index}–${match.end}`}</span>
          </div>
          <code className="regex-match-value">{match.value || <span className="regex-empty-value">{t("regex.empty")}</span>}</code>
          {match.groups.length > 0 && (
            <dl className="regex-groups">
              {match.groups.map((group) => (
                <div key={group.number} className="contents">
                  <dt>{group.name ? `${group.number} ${group.name}` : group.number}</dt>
                  <dd>
                    {group.value === undefined ? (
                      <span className="regex-empty-value">{t("regex.group.notMatched")}</span>
                    ) : (
                      group.value || <span className="regex-empty-value">{t("regex.empty")}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

function CheatSheet() {
  const t = useT();
  return (
    <details className="tool-help">
      <summary>{t("regex.cheatSheet")}</summary>
      <dl className="tool-help-content regex-cheatsheet">
        {CHEAT_SHEET.map(([token, meaning]) => (
          <div key={token}>
            <dt>{token}</dt>
            <dd>{t(meaning)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function RegexGenerator() {
  const t = useT();
  const [pattern, setPattern] = usePersistedInput("regex-pattern");
  const [flags, setFlags] = useState("g");
  const [input, setInput] = usePersistedInput("regex-input");
  const [mode, setMode] = useState<Mode>("match");
  const [replacement, setReplacement] = useState("");
  const [result, setResult] = useState<RegexResult | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const livePattern = useDebouncedValue(pattern);
  const text = useDebouncedValue(input);
  const liveReplacement = useDebouncedValue(replacement);
  const replacing = mode === "replace";

  useEffect(() => {
    if (!livePattern) {
      setResult(null);
      return;
    }
    let current = true;
    runRegexInWorker({ pattern: livePattern, flags, text, replacement: replacing ? liveReplacement : undefined }).then((next) => {
      if (current && next) setResult(next);
    });
    return () => {
      current = false;
    };
  }, [livePattern, flags, text, replacing, liveReplacement]);

  const matches = useMemo(() => (result && "matches" in result ? result.matches : []), [result]);
  const error = result && "error" in result ? result.error : "";
  const segments = useMemo(() => highlightSegments(input, matches), [input, matches]);
  const groupCount = matches[0]?.groups.length ?? 0;

  // The copied literal escapes "/" so it works in source code.
  const compiled = compileRegex(pattern, flags);
  const literal = `/${compiled.ok ? compiled.regex.source : pattern}/${flags}`;

  const applyPreset = (name: string) => {
    const preset = PRESETS.find((p) => p.name === name);
    if (!preset) return;
    setPattern(preset.pattern);
    setFlags("gm");
    if (!input) setInput(preset.sample);
  };

  // A pasted literal such as /\d+/gi fills the pattern and the flags.
  const pastePattern = (event: ClipboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if (field.selectionStart !== 0 || field.selectionEnd !== field.value.length) return;
    const parsed = parseRegexLiteral(event.clipboardData.getData("text"));
    if (!parsed) return;
    event.preventDefault();
    setPattern(parsed.pattern);
    setFlags(parsed.flags);
  };

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (!highlightRef.current) return;
    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  const matchCount = (count: number) => t("regex.matchCount", { count, n: formatNumber(count) });
  const errorText = error.startsWith(INVALID_PATTERN_PREFIX)
    ? t("regex.error.invalidPattern", { reason: error.slice(INVALID_PATTERN_PREFIX.length) })
    : error === TIMEOUT_ERROR
      ? t("regex.error.timeout", { seconds: REGEX_TIMEOUT_MS / 1000 })
      : error;

  const truncatedNotice =
    result?.ok && result.truncated === "limit"
      ? t("regex.notice.limit", { limit: formatNumber(MATCH_LIMIT) })
      : result?.ok && result.truncated === "time"
        ? t("regex.notice.time", { matches: matchCount(matches.length) })
        : "";

  const notice = error ? (
    <div className="workspace-notice" data-tone="error" role="alert">{errorText}</div>
  ) : truncatedNotice ? (
    <div className="workspace-notice" role="status">{truncatedNotice}</div>
  ) : undefined;

  const matchesText = matches.map((m) => m.value).join("\n");

  let second;
  if (!pattern) {
    second = <PaneEmpty icon={<Regex size={20} aria-hidden="true" />} title={t("regex.empty.pattern.title")} hint={t("regex.empty.pattern.hint")} />;
  } else if (replacing) {
    second = result?.ok && result.replaced !== undefined ? (
      <CodeTextarea id="regex-output" value={result.replaced} readOnly />
    ) : (
      <PaneEmpty title={t("regex.empty.replaced")} />
    );
  } else if (result?.ok && matches.length > 0) {
    second = <MatchList matches={matches} />;
  } else {
    second = <PaneEmpty title={error ? t("regex.empty.fix") : t("regex.empty.none")} />;
  }

  return (
    <ToolWorkspace
      id="regex-generator"
      toolbar={
        <>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList aria-label={t("regex.mode")}>
              <TabsTrigger value="match">{t("regex.mode.match")}</TabsTrigger>
              <TabsTrigger value="replace">{t("regex.mode.replace")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="layout-switch" role="group" aria-label={t("regex.flags")}>
            {REGEX_FLAGS.map((flag) => (
              <button
                key={flag}
                type="button"
                className="font-mono"
                aria-pressed={flags.includes(flag)}
                aria-label={t(FLAG_LABELS[flag])}
                title={t(FLAG_LABELS[flag])}
                onClick={() => setFlags(toggleFlag(flags, flag))}
              >
                {flag}
              </button>
            ))}
          </div>
          <label className="indent-control">
            {t("regex.preset")}
            <select aria-label={t("regex.preset")} value="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="" disabled>{t("regex.preset.choose")}</option>
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{t(p.label)}</option>
              ))}
            </select>
          </label>
        </>
      }
      secondaryToolbar={
        <div className="regex-fields">
          <div className="regex-field">
            <label htmlFor="regex-pattern" className="sr-only">{t("regex.pattern")}</label>
            <span aria-hidden="true">/</span>
            <Input
              id="regex-pattern"
              className="h-7 text-xs font-mono"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onPaste={pastePattern}
              placeholder={t("regex.pattern.placeholder")}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              spellCheck={false}
            />
            <span aria-hidden="true">/{flags}</span>
            <CopyButton value={pattern ? literal : ""} label={t("common.copy")} ariaLabel={t("regex.copyLiteral")} iconOnly />
          </div>
          {replacing && (
            <label className="regex-field" htmlFor="regex-replacement">
              <span className="whitespace-nowrap">{t("regex.replaceWith")}</span>
              <Input
                id="regex-replacement"
                className="h-7 text-xs font-mono"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("regex.replacement.placeholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
        </div>
      }
      notice={notice}
      first={
        <EditorPane
          title={t("regex.testText")}
          htmlFor="regex-input"
          scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}
        >
          <div className="regex-editor">
            <div ref={highlightRef} className="code-textarea regex-highlights" aria-hidden="true" data-testid="regex-highlights">
              {segments.map((segment, i) =>
                segment.match === undefined ? (
                  segment.text
                ) : (
                  <mark key={i} className="regex-mark" data-alt={segment.match % 2 === 1}>{segment.text}</mark>
                ),
              )}
              {/* A trailing line break needs a character after it to take up a line. */}
              {"​"}
            </div>
            <CodeTextarea
              id="regex-input"
              placeholder={t("regex.testText.placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onScroll={syncScroll}
            />
          </div>
        </EditorPane>
      }
      second={
        <EditorPane
          title={replacing ? t("regex.replacedText") : `${t("regex.matches")}${result?.ok ? ` (${formatNumber(matches.length)})` : ""}`}
          htmlFor={replacing && result?.ok ? "regex-output" : undefined}
          scroll={!replacing}
          actions={
            replacing ? (
              <CopyButton value={result?.ok ? (result.replaced ?? "") : ""} label={t("common.copy")} ariaLabel={t("regex.copyReplaced")} />
            ) : (
              <CopyButton value={matchesText} label={t("common.copy")} ariaLabel={t("regex.copyMatches")} />
            )
          }
        >
          {second}
        </EditorPane>
      }
      status={
        pattern && result?.ok ? (
          <span>
            {matchCount(matches.length)}
            {groupCount > 0 && ` · ${t("regex.groupCount", { count: groupCount, n: formatNumber(groupCount) })}`}
          </span>
        ) : (
          <span>{t("regex.ready")}</span>
        )
      }
      help={
        <>
          <CheatSheet />
          <ToolFaqSection items={FAQ_KEYS.map(([q, a]) => ({ q: t(q), a: t(a) }))} />
        </>
      }
    />
  );
}
