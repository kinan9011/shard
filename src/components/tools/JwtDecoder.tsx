import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToolActive } from "@/hooks/useToolActive";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePersistedInput } from "@/hooks/usePersistedInput";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyRound, PenLine } from "lucide-react";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { t, useLocale, useT, type TKey } from "@/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { SendToMenu } from "@/components/tools/SendToMenu";
import { CodeTextarea, EditorPane, PaneEmpty, ToolWorkspace } from "@/components/tools/ToolWorkspace";
import {
  JWT_ALGORITHMS,
  decodeJwt,
  defaultJwtPayload,
  derivePublicKey,
  describeTimeClaims,
  generateJwtKeyPair,
  isAsymmetricAlgorithm,
  refreshTimeClaims,
  setHeaderAlgorithm,
  signJwt,
  verifyJwtSignature,
  type JwtTimeState,
  type JwtVerifyResult,
} from "@/utils/jwt";

const FAQ_KEYS: [TKey, TKey][] = [
  ["jwt.faq.what.q", "jwt.faq.what.a"],
  ["jwt.faq.authentic.q", "jwt.faq.authentic.a"],
  ["jwt.faq.keyFormats.q", "jwt.faq.keyFormats.a"],
  ["jwt.faq.create.q", "jwt.faq.create.a"],
  ["jwt.faq.timeClaims.q", "jwt.faq.timeClaims.a"],
  ["jwt.faq.encrypted.q", "jwt.faq.encrypted.a"],
  ["jwt.faq.validates.q", "jwt.faq.validates.a"],
];

const PLACEHOLDER =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const DEFAULT_HEADER = JSON.stringify({ alg: "HS256", typ: "JWT" }, null, 2);

const VERIFY_TONE: Record<JwtVerifyResult["status"], string> = {
  valid: "text-success",
  invalid: "text-destructive",
  unsupported: "text-warning",
  error: "text-destructive",
};

const TIME_TONE: Record<JwtTimeState, string> = {
  active: "text-success",
  expired: "text-destructive",
  "not-yet-valid": "text-warning",
  "no-expiry": "text-warning",
};

type Mode = "decode" | "encode";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The current time, updated every second while `active` is true, so relative times stay correct. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Parses JSON text that must hold an object, for the encoder fields. */
function parseObject(text: string, name: "header" | "payload"): { value?: Record<string, unknown>; error?: string } {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: t(name === "header" ? "jwt.encode.headerNotObject" : "jwt.encode.payloadNotObject") };
    return { value };
  } catch (error) {
    return { error: t(name === "header" ? "jwt.encode.headerBadJson" : "jwt.encode.payloadBadJson", { message: (error as Error).message }) };
  }
}

/** A labeled block inside a pane, such as the key field under the token. */
function PaneSection({ label, htmlFor, actions, grow, children }: { label: string; htmlFor?: string; actions?: ReactNode; grow?: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-h-0 flex-col border-t border-border/50 first:border-t-0 ${grow ? "flex-1" : "flex-none"}`}>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <label htmlFor={htmlFor} className="result-row-label">{label}</label>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function SecretField({ id, value, onChange, base64, onBase64Change }: { id: string; value: string; onChange: (v: string) => void; base64: boolean; onBase64Change: (v: boolean) => void }) {
  const t = useT();
  return (
    <PaneSection
      label={t("jwt.secret")}
      htmlFor={id}
      actions={
        <label className="option-switch" htmlFor={`${id}-base64`}>
          {t("jwt.base64Secret")}
          <Switch id={`${id}-base64`} checked={base64} onCheckedChange={onBase64Change} />
        </label>
      }
    >
      <div className="px-4 pb-3 pt-1">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("jwt.secret.placeholder")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full font-mono text-xs"
        />
      </div>
    </PaneSection>
  );
}

function KeyField({ id, label, value, onChange, placeholder, actions }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; actions?: ReactNode }) {
  return (
    <PaneSection label={label} htmlFor={id} actions={actions}>
      <CodeTextarea id={id} className="h-28 !flex-none" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </PaneSection>
  );
}

export function JwtDecoder() {
  const t = useT();
  const { locale } = useLocale();
  const [mode, setMode] = useState<Mode>("decode");

  // Decode
  const [input, setInput] = usePersistedInput("jwt-token");
  const [secret, setSecret] = useState("");
  const [secretIsBase64, setSecretIsBase64] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [verify, setVerify] = useState<JwtVerifyResult | null>(null);
  const token = useDebouncedValue(input);
  const debouncedSecret = useDebouncedValue(secret);
  const debouncedPublicKey = useDebouncedValue(publicKey);

  // Encode
  const [headerText, setHeaderText] = useState(DEFAULT_HEADER);
  const [payloadText, setPayloadText] = useState(() => defaultJwtPayload(nowSeconds()));
  const [signSecret, setSignSecret] = useState("");
  const [signSecretIsBase64, setSignSecretIsBase64] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [signed, setSigned] = useState<{ token?: string; error?: string } | null>(null);
  const [derived, setDerived] = useState<{ pem: string; jwk: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const debouncedHeader = useDebouncedValue(headerText);
  const debouncedPayload = useDebouncedValue(payloadText);
  const debouncedSignSecret = useDebouncedValue(signSecret);
  const debouncedPrivateKey = useDebouncedValue(privateKey);

  // The messages are built when the token is decoded, so a new language decodes it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decoded = useMemo(() => (token.trim() ? decodeJwt(token) : null), [token, locale]);
  const valid = decoded && !decoded.error ? decoded : null;
  const alg = valid && typeof valid.header.alg === "string" ? valid.header.alg : "";
  const asymmetric = isAsymmetricAlgorithm(alg);
  const verifyKey = asymmetric ? debouncedPublicKey : debouncedSecret;
  const toolActive = useToolActive();
  const now = useNow(Boolean(valid) && mode === "decode" && toolActive);
  const time = valid ? describeTimeClaims(valid.payload, now) : null;

  useEffect(() => {
    if (!valid) {
      setVerify(null);
      return;
    }
    // Without a key there is nothing to check. Unsigned and unknown algorithms still report why.
    if (!verifyKey && (asymmetric || /^HS(256|384|512)$/.test(alg))) {
      setVerify(null);
      return;
    }
    let cancelled = false;
    verifyJwtSignature(token, verifyKey, { secretIsBase64 }).then((result) => {
      if (!cancelled) setVerify(result);
    });
    return () => {
      cancelled = true;
    };
  }, [valid, token, alg, asymmetric, verifyKey, secretIsBase64, locale]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const header = useMemo(() => parseObject(debouncedHeader, "header"), [debouncedHeader, locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payload = useMemo(() => parseObject(debouncedPayload, "payload"), [debouncedPayload, locale]);
  const signAlg = typeof header.value?.alg === "string" ? header.value.alg : "";
  const signAsymmetric = isAsymmetricAlgorithm(signAlg);
  const signKey = signAsymmetric ? debouncedPrivateKey : debouncedSignSecret;
  const liveSignAlg = (() => {
    const parsed = parseObject(headerText, "header").value?.alg;
    return typeof parsed === "string" ? parsed : "";
  })();

  useEffect(() => {
    if (header.error || payload.error || !signKey.trim()) {
      setSigned(header.error || payload.error ? { error: header.error ?? payload.error } : null);
      return;
    }
    let cancelled = false;
    signJwt(header.value!, payload.value!, signKey, { secretIsBase64: signSecretIsBase64 }).then(
      (tokenText) => !cancelled && setSigned({ token: tokenText }),
      (error: Error) => !cancelled && setSigned({ error: error.message })
    );
    return () => {
      cancelled = true;
    };
  }, [header, payload, signKey, signSecretIsBase64, locale]);

  const kid = typeof header.value?.kid === "string" ? header.value.kid : undefined;
  useEffect(() => {
    if (!signAsymmetric || !debouncedPrivateKey.trim()) {
      setDerived(null);
      return;
    }
    let cancelled = false;
    derivePublicKey(signAlg, debouncedPrivateKey, { kid }).then(
      (result) => !cancelled && setDerived({ pem: result.pem, jwk: JSON.stringify(result.jwk, null, 2) }),
      () => !cancelled && setDerived(null)
    );
    return () => {
      cancelled = true;
    };
  }, [signAsymmetric, signAlg, debouncedPrivateKey, kid]);

  const editAndSign = () => {
    if (!valid) return;
    setHeaderText(JSON.stringify(valid.header, null, 2));
    setPayloadText(JSON.stringify(valid.payload, null, 2));
    if (!asymmetric && secret) {
      setSignSecret(secret);
      setSignSecretIsBase64(secretIsBase64);
    }
    setMode("encode");
  };

  const openInDecoder = () => {
    if (!signed?.token) return;
    setInput(signed.token);
    if (signAsymmetric) {
      if (derived) setPublicKey(derived.pem);
    } else {
      setSecret(signSecret);
      setSecretIsBase64(signSecretIsBase64);
    }
    setMode("decode");
  };

  const generateKeyPair = async () => {
    setGenerating(true);
    try {
      setPrivateKey((await generateJwtKeyPair(liveSignAlg)).privateKeyPem);
    } catch (error) {
      setSigned({ error: (error as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  const renderJson = (obj: Record<string, unknown>, kind: "header" | "payload") => {
    const title = t(kind === "header" ? "jwt.header" : "jwt.payload");
    const json = JSON.stringify(obj, null, 2);
    return (
      <section className="border-b border-border/50" aria-label={title}>
        <div className="flex items-center justify-between px-4 pt-2">
          <span className="result-row-label">{title}</span>
          <span className="flex items-center gap-1">
            <SendToMenu text={json} from="jwt-decoder" label={t(kind === "header" ? "jwt.sendHeader" : "jwt.sendPayload")} />
            <CopyButton value={json} iconOnly label={t(kind === "header" ? "jwt.copyHeader" : "jwt.copyPayload")} />
          </span>
        </div>
        <pre className="overflow-x-auto px-4 pb-3 pt-1 font-mono text-sm leading-[22px]">
          <code>{json}</code>
        </pre>
      </section>
    );
  };

  const renderRow = (key: string, label: string, value: ReactNode, copyValue: string, extra?: ReactNode) => (
    <div key={key} className="result-row">
      <span className="result-row-label">{label}</span>
      <span className="result-row-value">
        {value}
        {extra}
      </span>
      <CopyButton value={copyValue} iconOnly label={t("jwt.copyLabel", { label })} />
    </div>
  );

  const modeTabs = (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
      <TabsList aria-label={t("jwt.mode")}>
        <TabsTrigger value="decode">{t("jwt.mode.decode")}</TabsTrigger>
        <TabsTrigger value="encode">{t("jwt.mode.encode")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (mode === "encode") {
    const algValue = (JWT_ALGORITHMS as readonly string[]).includes(liveSignAlg) ? liveSignAlg : "";
    const liveAsymmetric = isAsymmetricAlgorithm(liveSignAlg);
    const missingKey = !signed && !header.error && !payload.error;
    return (
      <ToolWorkspace
        id="jwt-decoder"
        toolbar={
          <>
            {modeTabs}
            <label className="indent-control">
              {t("jwt.algorithm")}
              <select aria-label={t("jwt.algorithm")} value={algValue} onChange={(e) => setHeaderText(setHeaderAlgorithm(headerText, e.target.value))}>
                {!algValue && <option value="">{liveSignAlg || t("jwt.algorithm.choose")}</option>}
                {JWT_ALGORITHMS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <button type="button" className="toolbar-text-button indent-control" onClick={() => setPayloadText(refreshTimeClaims(payloadText, nowSeconds()))}>
              {t("jwt.refreshTimes")}
            </button>
          </>
        }
        notice={
          signed?.error ? (
            <div className="workspace-notice" data-tone="error" role="alert">{signed.error}</div>
          ) : undefined
        }
        first={
          <EditorPane title={t("jwt.claims")} scroll={false}>
            <PaneSection label={t("jwt.header")} htmlFor="jwt-header">
              <CodeTextarea id="jwt-header" aria-label={t("jwt.headerJson")} className="h-28 !flex-none" value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
            </PaneSection>
            <PaneSection label={t("jwt.payload")} htmlFor="jwt-payload" grow>
              <CodeTextarea id="jwt-payload" aria-label={t("jwt.payloadJson")} value={payloadText} onChange={(e) => setPayloadText(e.target.value)} />
            </PaneSection>
            {liveAsymmetric ? (
              <KeyField
                id="jwt-private-key"
                label={t("jwt.privateKey")}
                value={privateKey}
                onChange={setPrivateKey}
                placeholder={t("jwt.privateKey.placeholder")}
                actions={
                  <button type="button" className="toolbar-text-button" onClick={generateKeyPair} disabled={generating}>
                    {generating ? t("jwt.generating") : t("jwt.generateKeyPair")}
                  </button>
                }
              />
            ) : (
              <SecretField id="jwt-sign-secret" value={signSecret} onChange={setSignSecret} base64={signSecretIsBase64} onBase64Change={setSignSecretIsBase64} />
            )}
          </EditorPane>
        }
        second={
          <EditorPane
            title={t("jwt.token")}
            actions={
              signed?.token ? (
                <>
                  <button type="button" className="toolbar-text-button" onClick={openInDecoder}>{t("jwt.mode.decode")}</button>
                  <CopyButton value={signed.token} label={t("jwt.copyToken")} />
                </>
              ) : undefined
            }
          >
            {signed?.token ? (
              <div className="result-list">
                <pre className="whitespace-pre-wrap break-all border-b border-border/50 px-4 py-3 font-mono text-sm leading-[22px]" aria-label={t("jwt.signedToken")}>
                  <code>{signed.token}</code>
                </pre>
                {signAsymmetric && derived && (
                  <>
                    <section className="border-b border-border/50" aria-label={t("jwt.publicKey")}>
                      <div className="flex items-center justify-between px-4 pt-2">
                        <span className="result-row-label">{t("jwt.publicKeyPem")}</span>
                        <CopyButton value={derived.pem} iconOnly label={t("jwt.copyPublicKey")} />
                      </div>
                      <pre className="overflow-x-auto px-4 pb-3 pt-1 font-mono text-xs leading-[18px]"><code>{derived.pem}</code></pre>
                    </section>
                    <section className="border-b border-border/50" aria-label={t("jwt.publicJwk")}>
                      <div className="flex items-center justify-between px-4 pt-2">
                        <span className="result-row-label">{t("jwt.publicJwk")}</span>
                        <CopyButton value={derived.jwk} iconOnly label={t("jwt.copyPublicJwk")} />
                      </div>
                      <pre className="overflow-x-auto px-4 pb-3 pt-1 font-mono text-xs leading-[18px]"><code>{derived.jwk}</code></pre>
                    </section>
                  </>
                )}
              </div>
            ) : (
              <PaneEmpty
                icon={<PenLine size={20} aria-hidden="true" />}
                title={missingKey ? (liveAsymmetric ? t("jwt.empty.privateKey") : t("jwt.empty.secret")) : t("jwt.empty.fix")}
                hint={t("jwt.empty.hint")}
              />
            )}
          </EditorPane>
        }
        status={
          <>
            {liveSignAlg && <span>{liveSignAlg}</span>}
            <span>{signed?.token ? t("jwt.characters", { count: signed.token.length }) : t("jwt.notSigned")}</span>
          </>
        }
        help={<ToolFaqSection items={FAQ_KEYS.map(([q, a]) => ({ q: t(q), a: t(a) }))} />}
      />
    );
  }

  return (
    <ToolWorkspace
      id="jwt-decoder"
      toolbar={modeTabs}
      notice={
        decoded?.error ? (
          <div className="workspace-notice" data-tone="error" role="alert">{decoded.error}</div>
        ) : undefined
      }
      first={
        <EditorPane title={t("jwt.token")} htmlFor="jwt-input" scroll={false}
          actions={input ? <button type="button" className="toolbar-text-button" onClick={() => setInput("")}>{t("common.clear")}</button> : undefined}>
          <CodeTextarea
            id="jwt-input"
            className="break-all"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDER}
          />
          {valid && alg !== "none" && (asymmetric ? (
            <KeyField
              id="jwt-public-key"
              label={t("jwt.publicKey")}
              value={publicKey}
              onChange={setPublicKey}
              placeholder={t("jwt.publicKey.placeholder")}
            />
          ) : (
            <SecretField id="jwt-secret" value={secret} onChange={setSecret} base64={secretIsBase64} onBase64Change={setSecretIsBase64} />
          ))}
        </EditorPane>
      }
      second={
        <EditorPane
          title={t("jwt.decoded")}
          actions={valid ? <button type="button" className="toolbar-text-button" onClick={editAndSign}>{t("jwt.editAndSign")}</button> : undefined}
        >
          {valid && time ? (
            <div className="result-list">
              <div className="result-row">
                <span className="result-row-label">{t("jwt.status")}</span>
                <span className={`result-row-value ${TIME_TONE[time.state]}`}>{time.summary}</span>
                <span />
              </div>
              {time.claims.map((claim) =>
                renderRow(
                  claim.claim,
                  claim.label,
                  claim.date ? `${claim.date.toLocaleString()} (${claim.relative})` : String(claim.value),
                  String(claim.value),
                  claim.warning && <span className="block text-warning">{claim.warning}</span>
                )
              )}
              {renderJson(valid.header, "header")}
              {renderJson(valid.payload, "payload")}
              {renderRow("signature", t("jwt.signature"), valid.signature, valid.signature)}
            </div>
          ) : (
            <PaneEmpty
              icon={<KeyRound size={20} aria-hidden="true" />}
              title={t("jwt.empty.decodeTitle")}
              hint={t("jwt.empty.decodeHint")}
            />
          )}
        </EditorPane>
      }
      status={
        valid && time ? (
          <>
            {alg && <span>{alg}</span>}
            <span className={TIME_TONE[time.state]}>{time.summary}</span>
            <span role="status" className={verify ? VERIFY_TONE[verify.status] : undefined}>
              {verify ? verify.message : t("jwt.notChecked")}
            </span>
          </>
        ) : (
          <span>{decoded?.error ? t("jwt.invalidToken") : t("jwt.ready")}</span>
        )
      }
      help={<ToolFaqSection items={FAQ_KEYS.map(([q, a]) => ({ q: t(q), a: t(a) }))} />}
    />
  );
}
