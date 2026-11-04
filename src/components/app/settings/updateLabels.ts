import { t } from "@/i18n";
import type { UpdateState } from "@/lib/desktop";

/** The label of the button that acts on the app update. */
export function updateButtonLabel(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return t("settings.update.checking");
    case "available":
      return state.version ? t("settings.update.toVersion", { version: state.version }) : t("settings.update.update");
    case "downloading":
      return state.progress ? t("settings.update.downloadingPercent", { percent: Math.round(state.progress) }) : t("settings.update.downloading");
    case "downloaded":
      return t("settings.update.restart");
    case "unsupported":
      return t("settings.update.devBuild");
    default:
      return t("settings.update.check");
  }
}

/** The status line for the sidebar footer: only what needs attention (not "checking" or a dev build). */
export function updateNoticeLabel(state: UpdateState): string {
  return state.status === "checking" || state.status === "unsupported" ? "" : updateStatusLabel(state);
}

/** One line on where the app update stands. Empty when there is nothing to say. */
export function updateStatusLabel(state: UpdateState): string {
  switch (state.status) {
    case "available":
      return state.version ? t("settings.update.statusAvailableVersion", { version: state.version }) : t("settings.update.statusAvailable");
    case "downloading":
      return state.progress ? t("settings.update.statusDownloadingPercent", { percent: Math.round(state.progress) }) : t("settings.update.statusDownloading");
    case "downloaded":
      return state.version ? t("settings.update.statusReadyVersion", { version: state.version }) : t("settings.update.statusReady");
    case "checking":
      return t("settings.update.statusChecking");
    case "error":
      return t("settings.update.statusError");
    case "unsupported":
      return t("settings.update.statusUnsupported");
    default:
      return "";
  }
}
