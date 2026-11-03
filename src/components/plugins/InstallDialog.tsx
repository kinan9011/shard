import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Archive, Check, Folder, Link, Puzzle, ShieldCheck, TriangleAlert, Upload, X } from "lucide-react";
import { useDialogFocus } from "@/components/app/useDialogFocus";
import { getDesktopBridge } from "@/lib/desktop";
import { isMobileApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  clearDroppedZip,
  inspectFolder,
  inspectZip,
  installFromUrl,
  installPluginFolder,
  installZip,
  lookupUrl,
  pickPluginFolder,
  pickPluginZip,
  repoSettings,
  stageDroppedZip,
  type FolderPreview,
  type UrlPreview,
  type ZipPreview,
} from "@/plugins/api";
import { formatSize, RUNTIME_LABEL } from "@/plugins/format";
import type { InstallJob } from "@/plugins/useInstallFlow";
import type { PluginManifest } from "@/plugins/types";

type Candidate =
  | { kind: "url"; url: string; preview: UrlPreview }
  | { kind: "zip"; path: string; name: string; dropped: boolean; preview: ZipPreview }
  | { kind: "folder"; path: string; name: string; preview: FolderPreview };

interface InstallDialogProps {
  onCancel: () => void;
  /** The plugin to install. The dialog closes itself from the page: the permission dialog comes next. */
  onContinue: (job: InstallJob) => void;
  /** The link in the note shown while installs from outside the repositories are off. */
  onOpenRepositories: () => void;
}

const asMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const buttonClass = "inline-flex items-center gap-[7px] whitespace-nowrap rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground disabled:opacity-60";

/** The job that installs what the user chose. A repository that is listed, or added with the plugin, is a repository install. */
function jobFor(candidate: Candidate, addRepo: boolean): InstallJob {
  const { manifest } = candidate.kind === "url" ? { manifest: candidate.preview } : candidate.preview;
  const entry = (repo: string) => ({ name: manifest.name, version: manifest.version, runtime: manifest.runtime, permissions: manifest.permissions, repo });
  const id = manifest.id;
  if (candidate.kind === "url") {
    const { url, preview } = candidate;
    const verified = preview.checksumMatches && (preview.repoAdded || addRepo);
    return { id, entry: entry(preview.repo), verified, run: () => installFromUrl(url, addRepo && !preview.repoAdded) };
  }
  if (candidate.kind === "zip") {
    const { path, preview, dropped } = candidate;
    return { id, entry: entry(candidate.name), verified: false, run: () => installZip(path, preview.sha256), discard: dropped ? clearDroppedZip : undefined };
  }
  return { id, entry: entry(candidate.name), verified: false, run: () => installPluginFolder(candidate.path) };
}

/** Screen 06 A: a zip, a folder or a repository URL, checked before the permission dialog. */
export function InstallDialog({ onCancel, onContinue, onOpenRepositories }: InstallDialogProps) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [url, setUrl] = useState("");
  const [addRepo, setAddRepo] = useState(true);
  const [busy, setBusy] = useState<"lookup" | "inspect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Null until the setting is read. Rust checks it again, so unknown counts as allowed.
  const [allowOutside, setAllowOutside] = useState<boolean | null>(null);
  const staged = useRef(false);
  const handedOff = useRef(false);
  const alive = useRef(true);
  // Only the latest request may show its result.
  const request = useRef(0);

  useEffect(() => {
    alive.current = true;
    repoSettings()
      .then((settings) => alive.current && setAllowOutside(settings.allowOutside))
      .catch(() => {});
    return () => {
      alive.current = false;
      // A dropped zip that no job took over is not needed any more.
      if (staged.current && !handedOff.current) void clearDroppedZip().catch(() => {});
    };
  }, []);

  const close = () => onCancel();
  const ref = useDialogFocus(true, close);
  const outsideOff = allowOutside === false;

  async function inspect<T>(work: () => Promise<T>, accept: (value: T) => Candidate): Promise<void> {
    const mine = ++request.current;
    setBusy("inspect");
    setError(null);
    try {
      const value = await work();
      if (mine === request.current) setCandidate(accept(value));
    } catch (failure) {
      if (mine === request.current) {
        setCandidate(null);
        setError(asMessage(failure));
      }
    } finally {
      if (mine === request.current) setBusy(null);
    }
  }

  const chooseZip = async () => {
    const path = await pickPluginZip().catch(() => null);
    if (path) await inspect(() => inspectZip(path), (preview) => ({ kind: "zip", path, name: baseName(path), dropped: false, preview }));
  };

  const chooseFolder = async () => {
    const path = await pickPluginFolder().catch(() => null);
    if (path) await inspect(() => inspectFolder(path), (preview) => ({ kind: "folder", path, name: baseName(path), preview }));
  };

  const takeZipPath = (path: string) =>
    inspect(() => inspectZip(path), (preview) => ({ kind: "zip", path, name: baseName(path), dropped: false, preview }));

  // Windows and macOS: the page gets the drop as a DOM event, with the File.
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (allowOutside !== true || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (event.dataTransfer.items?.[0]?.webkitGetAsEntry?.()?.isDirectory) return setError("Folders can't be dropped here. Use Choose folder.");
    if (!file || !/\.zip$/i.test(file.name)) return setError("Drop a plugin .zip file.");
    // ponytail: this reads the whole zip into memory. Turn on native drag-drop (real paths, as on Linux) if big drops hurt on Windows or macOS.
    await inspect(
      async () => {
        const path = await stageDroppedZip(file);
        staged.current = true;
        return { path, preview: await inspectZip(path) };
      },
      ({ path, preview }) => ({ kind: "zip", path, name: file.name, dropped: true, preview }),
    );
  };

  // Linux: WebKitGTK gives the page no File and no path for a file dragged from a file manager, so the window takes the drop
  // natively and sends the paths with the point they landed at. The zone is the only place that takes it.
  const zone = useRef<HTMLDivElement>(null);
  const latest = useRef({ allowOutside, busy, takeZipPath });
  latest.current = { allowOutside, busy, takeZipPath };
  useEffect(
    () =>
      getDesktopBridge()?.onFileDrop?.((paths, x, y) => {
        if (!zone.current?.contains(document.elementFromPoint(x, y))) return;
        const { allowOutside: allowed, busy: working, takeZipPath: take } = latest.current;
        if (allowed !== true || working) return;
        const path = paths[0];
        if (!path || !/\.zip$/i.test(path)) return setError("Drop a plugin .zip file.");
        void take(path);
      }),
    [],
  );

  const lookUp = async (event: FormEvent) => {
    event.preventDefault();
    const text = url.trim();
    if (!text || busy) return;
    const mine = ++request.current;
    setBusy("lookup");
    setError(null);
    setCandidate(null);
    try {
      const preview = await lookupUrl(text);
      if (mine === request.current) setCandidate({ kind: "url", url: text, preview });
    } catch (failure) {
      if (mine === request.current) setError(asMessage(failure));
    } finally {
      if (mine === request.current) setBusy(null);
    }
  };

  // A listed repository needs no checkbox. Otherwise the plugin is a sideload unless the repository is added with it.
  const needsCheckbox = candidate?.kind === "url" && !candidate.preview.repoAdded;
  const canContinue = !!candidate && !busy && (candidate.kind !== "url" || (candidate.preview.checksumMatches && (!outsideOff || candidate.preview.repoAdded || addRepo)));

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      // A file dropped beside the zone must not make the webview open it.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" className="modal-surface flex w-[560px] max-w-full flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-[18px]">
          <div className="flex flex-col gap-0.5">
            <h2 id="install-dialog-title" className="text-base font-semibold text-foreground">Install plugin</h2>
            <p className="text-xs text-muted-foreground">From a zip file, a folder, or a GitHub repository URL.</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex max-h-[70vh] flex-col gap-3.5 overflow-y-auto px-5 py-3.5">
          {outsideOff && (
            <p role="note" className="rounded-lg bg-secondary p-3 text-xs text-foreground">
              Installs from zip files, folders and URLs outside your repositories are turned off.{" "}
              <button type="button" onClick={onOpenRepositories} className="font-medium text-primary underline-offset-2 hover:underline">
                Change this in Repositories
              </button>
            </p>
          )}
          {/* A phone cannot hand over a path to unpack: only a repository address installs there. */}
          {!isMobileApp() && (
            <>
              <div
                ref={zone}
                data-testid="drop-zone"
                data-drop-zone
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!outsideOff) setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={onDrop}
                className={cn(
                  "flex h-[132px] flex-col items-center justify-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed text-sm",
                  dragging ? "border-primary bg-primary/10" : "border-input",
                  outsideOff && "opacity-60",
                )}
              >
                <Upload size={20} aria-hidden="true" className="text-muted-foreground" />
                <span className="font-medium text-foreground">Drop a plugin .zip or folder here</span>
                <div className="flex gap-2">
                  <button type="button" disabled={outsideOff || !!busy} onClick={() => void chooseZip()} className={cn(buttonClass, "h-7")}>
                    <Archive size={14} aria-hidden="true" />
                    Choose zip file
                  </button>
                  <button type="button" disabled={outsideOff || !!busy} onClick={() => void chooseFolder()} className={cn(buttonClass, "h-7")}>
                    <Folder size={14} aria-hidden="true" />
                    Choose folder
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or from a repository URL
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <form onSubmit={(event) => void lookUp(event)} className="flex gap-2">
            <label className="flex h-[34px] min-w-0 flex-1 items-center gap-[9px] rounded-[7px] border border-input bg-background px-[11px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
              <Link size={15} aria-hidden="true" className="shrink-0" />
              <input
                type="text"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  // The text no longer matches a lookup that is running or done.
                  if (busy === "lookup") {
                    request.current++;
                    setBusy(null);
                  }
                  if (candidate?.kind === "url") setCandidate(null);
                }}
                placeholder="https://github.com/owner/repo"
                aria-label="Repository URL"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <button type="submit" disabled={!url.trim() || !!busy} className={cn(buttonClass, "h-[34px]")}>
              {busy === "lookup" ? "Looking up…" : "Look up"}
            </button>
          </form>
          {error && (
            <p role="alert" className="whitespace-pre-line text-xs text-destructive">
              {error}
            </p>
          )}
          {candidate && <PreviewCard candidate={candidate} addRepo={addRepo} onAddRepo={setAddRepo} showCheckbox={needsCheckbox} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={close} className={cn(buttonClass, "h-[30px]")}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              if (!candidate) return;
              // Only a dropped zip is cleaned up by its job. Anything else leaves the drop folder to this dialog.
              handedOff.current = candidate.kind === "zip" && candidate.dropped;
              onContinue(jobFor(candidate, addRepo));
            }}
            className="inline-flex h-[30px] items-center whitespace-nowrap rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function summary(candidate: Candidate): { manifest: Pick<PluginManifest, "name" | "version" | "runtime">; detail: string } {
  if (candidate.kind === "url") {
    const { preview } = candidate;
    const from = preview.kind === "releases" ? `Latest GitHub release v${preview.version}` : `Listed in ${preview.repoName}`;
    return { manifest: preview, detail: `${from} · ${formatSize(preview.size)} · ${RUNTIME_LABEL[preview.runtime]}` };
  }
  const { manifest } = candidate.preview;
  return { manifest, detail: `${candidate.name} · ${RUNTIME_LABEL[manifest.runtime]}` };
}

function PreviewCard({ candidate, addRepo, onAddRepo, showCheckbox }: { candidate: Candidate; addRepo: boolean; onAddRepo: (value: boolean) => void; showCheckbox: boolean }) {
  const { manifest, detail } = summary(candidate);
  const verified = candidate.kind === "url" ? candidate.preview.checksumMatches : null;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-secondary p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-accent text-primary">
          <Puzzle size={18} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-foreground">{`${manifest.name} ${manifest.version}`}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </div>
        {verified === true && (
          <span className="flex items-center gap-[5px] whitespace-nowrap text-xs text-success">
            <ShieldCheck size={14} aria-hidden="true" />
            Checksum matches
          </span>
        )}
        {verified === false && (
          <span className="flex items-center gap-[5px] whitespace-nowrap text-xs text-destructive">
            <TriangleAlert size={14} aria-hidden="true" />
            Checksum doesn't match
          </span>
        )}
        {verified === null && (
          <span className="flex items-center gap-[5px] whitespace-nowrap text-xs text-warning">
            <TriangleAlert size={14} aria-hidden="true" />
            Unverified
          </span>
        )}
      </div>
      {showCheckbox && (
        <button type="button" role="checkbox" aria-checked={addRepo} onClick={() => onAddRepo(!addRepo)} className="flex items-center gap-2 text-left text-xs text-foreground">
          <span aria-hidden="true" className={cn("grid size-4 shrink-0 place-items-center rounded border", addRepo ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
            {addRepo && <Check size={11} strokeWidth={3} />}
          </span>
          Add this repository so the plugin gets updates
        </button>
      )}
    </div>
  );
}
