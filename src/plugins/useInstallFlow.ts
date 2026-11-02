import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { installFromRepo, onInstallProgress, setPluginGrants, updatePlugin, type CatalogEntry, type InstalledPlugin, type PluginUpdate } from "./api";
import { permissionRows, type PermissionGroupKey, type PermissionRow } from "./permissions";
import type { PermissionName } from "./types";
import type { CatalogRow } from "./usePluginCatalog";
import { refreshPlugins } from "./usePlugins";

/** The permission names to grant: every row that is required or switched on. The WASM row has nothing to grant. */
export function grantsFor(rows: readonly PermissionRow[], enabled: ReadonlySet<PermissionGroupKey>): string[] {
  const names = rows.filter((row) => row.required || enabled.has(row.key)).flatMap((row) => row.names);
  return [...new Set(names)];
}

/** "Installing…" with the percent once it is known. */
export const installingLabel = (percent: number | null | undefined) => (typeof percent === "number" ? `Installing… ${percent}%` : "Installing…");

const asMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/** The toast for a failed install. The Rust side words the message (src-tauri/src/plugins/install.rs, zip.rs, fetch.rs). */
export function describeInstallError(name: string, message: string): { title: string; description: string } {
  if (/checksum does not match|bytes, but the repository lists|larger than the repository lists/i.test(message)) {
    return { title: "Checksum doesn't match", description: `${name} was not installed. The download is not the file the repository lists.` };
  }
  const newer = /^Requires Shard (\S+)/.exec(message);
  if (newer) return { title: "Needs a newer Shard", description: `${name} requires Shard ${newer[1]}.` };
  if (/^HTTP \d|\(404\)|timed out|error sending request|connect|dns|network/i.test(message)) {
    return { title: "Download failed", description: message };
  }
  return { title: `Couldn't install ${name}`, description: message };
}

/**
 * One install waiting for the user's approval: a listed plugin, or a sideload from the install dialog.
 * `entry.repo` is what the permission dialog shows after "from": a repository URL, or the zip or folder name.
 */
export interface InstallJob {
  /** The plugin id: the key of `progress` and of the busy check. */
  id: string;
  entry: Pick<CatalogEntry, "name" | "version" | "runtime" | "permissions" | "repo">;
  /** Its SHA-256 was checked against a repository's listing. */
  verified: boolean;
  /** Downloads or unpacks and installs. No grants yet. */
  run: () => Promise<InstalledPlugin>;
  /** Cleans up after the job, whether it ran, failed or was cancelled (the dropped zip). */
  discard?: () => void | Promise<void>;
  /** An update of an installed plugin: `granted` is what it has now, `newPermissions` what the new version adds. */
  update?: { from: string; granted: readonly string[]; newPermissions: readonly string[] };
}

/** The job for a plugin listed in a repository. */
export const repoJob = ({ entry }: CatalogRow): InstallJob => ({ id: entry.id, entry, verified: true, run: () => installFromRepo(entry.repo, entry.id) });

/** The job for an update. `entry` is the new version as the repository lists it, so the dialog shows what it asks for. */
export function updateJob(update: PluginUpdate, plugin: InstalledPlugin, listed?: CatalogRow): InstallJob {
  // Not in the catalog (it did not load, or the repository dropped it): show what we know, plus the new names as optional rows.
  const known = plugin.manifest.permissions ?? [];
  const added = update.newPermissions.filter((name) => !known.some((permission) => permission.name === name)).map((name) => ({ name: name as PermissionName, reason: "", optional: true }));
  const entry = listed?.entry ?? { name: update.name, version: update.to, runtime: plugin.manifest.runtime, permissions: [...known, ...added], repo: update.repo };
  return {
    id: update.id,
    entry,
    verified: true,
    run: () => updatePlugin(update.id),
    update: { from: update.from, granted: plugin.granted, newPermissions: update.newPermissions },
  };
}

interface InstallFlowOptions {
  /** Opens the installed plugin as a tool (the "Open" action of the toast). */
  onOpen: (id: string) => void;
  /** Reads the catalog again after an install, so the row turns to Installed. */
  refresh: () => Promise<void> | void;
  /** Called once the plugin is installed and its grants are saved (not after a failed install or a failed grant save). */
  onInstalled?: (id: string) => void;
}

/**
 * Install → permission dialog (skipped when the plugin asks for nothing) → download and verify → grants → toast.
 * `progress` has an entry for every plugin being installed: the percent, or null when the size is unknown.
 */
export function useInstallFlow({ onOpen, refresh, onInstalled }: InstallFlowOptions) {
  // Jobs waiting for the user's approval, one dialog at a time ("Update all" can queue several).
  const [queue, setQueue] = useState<readonly InstallJob[]>([]);
  const pending = queue[0] ?? null;
  const [progress, setProgress] = useState<Readonly<Record<string, number | null>>>({});
  const busy = useRef(new Set<string>());
  const latest = useRef({ onOpen, refresh, onInstalled });
  latest.current = { onOpen, refresh, onInstalled };

  useEffect(() => {
    let stopped = false;
    let stop: () => void = () => {};
    onInstallProgress(({ id, received, total }) =>
      setProgress((current) => {
        const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : null;
        // Events come per chunk: skip the render when nothing visible changed.
        return id in current && current[id] !== percent ? { ...current, [id]: percent } : current;
      }),
    )
      .then((off) => (stopped ? off() : (stop = off)))
      .catch(() => {});
    return () => {
      stopped = true;
      stop();
    };
  }, []);

  /** `grants` null leaves the plugin's grants as they are (an update that asks for nothing new). Resolves to whether the plugin was installed. */
  const install = useCallback(async (job: InstallJob, grants: string[] | null): Promise<boolean> => {
    const { id } = job;
    const { name } = job.entry;
    if (busy.current.has(id)) return false;
    busy.current.add(id);
    setProgress((current) => ({ ...current, [id]: null }));
    let installed = false;
    try {
      await job.run();
      installed = true;
      try {
        // An update replaces the grants even with none: the user may have switched every optional one off.
        if (grants && (grants.length > 0 || job.update)) await setPluginGrants(id, grants);
      } catch (failure) {
        toast.error(job.update ? "Updated, but permissions weren't saved" : "Installed, but permissions weren't saved", { description: `${name}: ${asMessage(failure)}` });
        return installed;
      } finally {
        // The plugin is installed whatever these reads do: a failed read must not turn into an "install failed" toast.
        await Promise.allSettled([refreshPlugins(), latest.current.refresh()]);
      }
      if (!job.update) latest.current.onInstalled?.(id);
      toast.success(job.update ? "Updated" : "Installed", { description: job.update ? `${name} ${job.update.from} → ${job.entry.version}` : name, action: { label: "Open", onClick: () => latest.current.onOpen(id) } });
    } catch (failure) {
      const { title, description } = describeInstallError(name, asMessage(failure));
      toast.error(title, { description });
    } finally {
      void Promise.resolve(job.discard?.()).catch(() => {});
      busy.current.delete(id);
      setProgress((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    }
    return installed;
  }, []);

  const enqueue = useCallback((job: InstallJob) => setQueue((current) => (current.some((item) => item.id === job.id) ? current : [...current, job])), []);

  /** An install was asked for: ask first, unless there is nothing to ask. */
  const requestJob = useCallback(
    (job: InstallJob) => {
      if (busy.current.has(job.id)) {
        void Promise.resolve(job.discard?.()).catch(() => {});
        return;
      }
      if (job.update) {
        // Nothing new to approve: the grants it has stay.
        if (job.update.newPermissions.length === 0) void install(job, null);
        else enqueue(job);
      } else if (permissionRows(job.entry).every((item) => item.key === "wasm")) void install(job, []);
      else enqueue(job);
    },
    [install, enqueue],
  );

  /** Install was pressed on a listed plugin. */
  const request = useCallback((row: CatalogRow) => requestJob(repoJob(row)), [requestJob]);

  const confirm = useCallback(
    (grants: string[]) => {
      if (!pending) return;
      setQueue((current) => current.slice(1));
      void install(pending, grants);
    },
    [install, pending],
  );

  const cancel = useCallback(() => {
    void Promise.resolve(pending?.discard?.()).catch(() => {});
    setQueue((current) => current.slice(1));
  }, [pending]);

  /** `install` runs a job at once with the grants given: for a caller that asked for approval itself (the first-run wizard's combined dialog). */
  return { pending, progress, request, requestJob, confirm, cancel, install };
}
