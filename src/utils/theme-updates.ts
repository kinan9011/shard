import { gt, valid } from "semver";

/** The slice of a theme file the update check reads. */
export interface InstalledThemeInfo {
  id: string;
  version: string;
  /** The repository it was installed from. Absent for a theme the user made or imported. */
  repo?: string;
}

/** The slice of a repository's theme entry the update check reads. */
export interface ListedThemeInfo {
  id: string;
  version: string;
  repo: string;
}

/** Is `listed` a newer version than `installed`? Versions that are not semver fall back to "different". */
export function isNewerVersion(listed: string, installed: string): boolean {
  return valid(listed) && valid(installed) ? gt(listed, installed) : listed !== installed;
}

/** The listed themes that replace an installed one from the same repository with a newer version. */
export function themeUpdates<T extends ListedThemeInfo>(installed: readonly InstalledThemeInfo[], listed: readonly T[]): T[] {
  return listed.filter((entry) => {
    const have = installed.find((theme) => theme.id === entry.id);
    return have?.repo === entry.repo && isNewerVersion(entry.version, have.version);
  });
}
