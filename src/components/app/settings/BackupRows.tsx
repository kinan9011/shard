import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { BatchPermissionDialog } from "@/components/plugins/BatchPermissionDialog";
import { exportBackup, restoreBackup, type Restored } from "@/lib/settingsBackup";
import { permissionRows } from "@/plugins/permissions";
import { setPluginEnabled } from "@/plugins/api";
import { repoJob, useInstallFlow } from "@/plugins/useInstallFlow";
import { usePluginCatalog, type CatalogRow } from "@/plugins/usePluginCatalog";
import { refreshPlugins } from "@/plugins/usePlugins";
import { parseBackup, type Backup } from "@/utils/settings-backup";
import { ActionButton, Row } from "./Row";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Export and import of what the user set up. See `src/utils/settings-backup.ts` for what a backup holds. */
export function BackupRows({ native }: { native: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [wanted, setWanted] = useState<Backup["plugins"]>([]);
  const [needsReload, setNeedsReload] = useState(false);

  const doExport = async () => {
    try {
      if (await exportBackup(native)) toast.success(t("settings.backup.exported"));
    } catch (error) {
      toast.error(t("settings.backup.exportFailed"), { description: message(error) });
    }
  };

  const doImport = async (file: File) => {
    setLines([]);
    setWanted([]);
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) return setLines([(parsed as { error: string }).error]);
    try {
      const done: Restored = await restoreBackup(parsed.backup, native);
      setLines([...done.lines, ...parsed.skipped.map((line) => t("settings.backup.skipped", { line })), ...(done.lines.length === 0 && done.plugins.length === 0 ? [t("settings.backup.nothing")] : [])]);
      setWanted(done.plugins);
      setNeedsReload(done.needsReload);
    } catch (error) {
      setLines([t("settings.backup.importStopped", { message: message(error) })]);
    }
  };

  return (
    <>
      <Row title={t("settings.backup.export")} hint={native ? t("settings.backup.exportHintNative") : t("settings.backup.exportHint")}>
        <ActionButton onClick={() => void doExport()}>{t("settings.backup.exportButton")}</ActionButton>
      </Row>
      <Row title={t("settings.backup.import")} hint={t("settings.backup.importHint")}>
        <ActionButton onClick={() => input.current?.click()}>{t("settings.backup.importButton")}</ActionButton>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label={t("settings.backup.fileLabel")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void doImport(file);
          }}
        />
      </Row>
      {(lines.length > 0 || needsReload) && (
        <div role="status" className="flex flex-col gap-1 border-t border-border py-2 text-xs text-muted-foreground">
          {lines.map((line) => <span key={line}>{line}</span>)}
          {needsReload && wanted.length === 0 && (
            <span><ActionButton onClick={() => window.location.reload()}>{t("settings.backup.reload")}</ActionButton></span>
          )}
        </div>
      )}
      {wanted.length > 0 && (
        <PluginRestore
          wanted={wanted}
          onDone={(more) => {
            setWanted([]);
            setLines((current) => [...current, ...more]);
          }}
        />
      )}
    </>
  );
}

/** Installs the plugins of a backup: one approval for all of them, the way the first-run wizard does it. Mounted only while there are some, so the catalog is read only then. */
function PluginRestore({ wanted, onDone }: { wanted: Backup["plugins"]; onDone: (lines: string[]) => void }) {
  const t = useT();
  const catalog = usePluginCatalog();
  const flow = useInstallFlow({ onOpen: () => {}, refresh: catalog.refresh });
  const [asking, setAsking] = useState<CatalogRow[] | null>(null);
  const started = useRef(false);

  const rows: CatalogRow[] = catalog.rows.filter((row) => row.action.kind === "install" && wanted.some((item) => item.id === row.entry.id && item.repo === row.entry.repo));
  const missing = wanted.filter((item) => !rows.some((row) => row.entry.id === item.id));

  const run = async (jobs: CatalogRow[], grants: Record<string, string[]>) => {
    const done = await Promise.all(jobs.map((row) => flow.install(repoJob(row), grants[row.entry.id] ?? [])));
    // A plugin that was turned off in the backup comes back turned off.
    for (const [index, row] of jobs.entries()) {
      if (done[index] && wanted.find((item) => item.id === row.entry.id)?.enabled === false) await setPluginEnabled(row.entry.id, false).catch(() => {});
    }
    await refreshPlugins();
    const failed = jobs.filter((_, index) => !done[index]);
    onDone([
      t("settings.backup.installedCount", { done: done.filter(Boolean).length, total: jobs.length }),
      ...failed.map((row) => t("settings.backup.didNotInstall", { name: row.entry.name })),
      ...missing.map((item) => t("settings.backup.notListed", { id: item.id })),
    ]);
  };

  useEffect(() => {
    if (catalog.loading || started.current) return;
    started.current = true;
    if (rows.length === 0) onDone(missing.map((item) => t("settings.backup.notListed", { id: item.id })));
    // Nothing asks for more than the sandbox: no dialog, as everywhere else.
    else if (rows.every((row) => permissionRows(row.entry).every((item) => item.key === "wasm"))) void run(rows, {});
    else setAsking(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the catalog has loaded
  }, [catalog.loading]);

  if (!asking) return null;
  return (
    <BatchPermissionDialog
      entries={asking.map((row) => ({ ...row.entry }))}
      repoName={[...new Set(asking.map((row) => row.entry.repoName))].join(", ")}
      onCancel={() => {
        setAsking(null);
        onDone([t("settings.backup.notInstalled")]);
      }}
      onConfirm={(grants) => {
        const jobs = asking;
        setAsking(null);
        void run(jobs, grants);
      }}
    />
  );
}
