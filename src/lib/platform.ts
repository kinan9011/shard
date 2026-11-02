import { isTauri } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";

/** Phones: narrower than the 640 px at which the sidebar already becomes a drawer. A desktop window is never this narrow (minWidth 720). */
export const PHONE_QUERY = "(max-width: 639px)";

/** The platform names Tauri reports for a phone. */
export const isMobilePlatform = (platform: string | undefined): boolean => platform === "android" || platform === "ios";

/**
 * Whether this is the Android or iOS app. Read from the OS, not from the window size, for features a phone does not have
 * (installing from a folder or a zip, showing a folder): a narrow desktop window still has them.
 */
export function isMobileApp(): boolean {
  try {
    return isTauri() && isMobilePlatform(osPlatform());
  } catch {
    return false;
  }
}
