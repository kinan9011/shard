import type { UpdateState } from "@/lib/desktop";

/** The label of the button that acts on the app update. */
export function updateButtonLabel(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking...";
    case "available":
      return state.version ? `Update to v${state.version}` : "Update";
    case "downloading":
      return state.progress ? `Downloading ${Math.round(state.progress)}%` : "Downloading...";
    case "downloaded":
      return "Restart to Update";
    case "unsupported":
      return "Dev Build";
    default:
      return "Check for Updates";
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
      return state.version ? `Version ${state.version} is available.` : "An update is available.";
    case "downloading":
      return state.progress ? `Downloading update: ${Math.round(state.progress)}%` : "Downloading update...";
    case "downloaded":
      return state.version
        ? `Version ${state.version} is ready. It installs when you quit Shard.`
        : "An update is ready. It installs when you quit Shard.";
    case "checking":
      return "Checking for updates...";
    case "error":
      return "The update did not complete. Check your connection and try again.";
    case "unsupported":
      return "Updates are disabled in development builds.";
    default:
      return "";
  }
}
