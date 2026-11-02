import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listRepos: vi.fn(),
  repoCatalog: vi.fn(),
  pluginUpdates: vi.fn(),
  installFromRepo: vi.fn(),
  setPluginGrants: vi.fn(),
  onInstallProgress: vi.fn(),
  repoSettings: vi.fn(),
  pickPluginZip: vi.fn(),
  pickPluginFolder: vi.fn(),
  stageDroppedZip: vi.fn(),
  clearDroppedZip: vi.fn(),
  inspectZip: vi.fn(),
  installZip: vi.fn(),
  inspectFolder: vi.fn(),
  installPluginFolder: vi.fn(),
  lookupUrl: vi.fn(),
  installFromUrl: vi.fn(),
}));
vi.mock("@/plugins/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { InstallDialog } from "@/components/plugins/InstallDialog";
import { PluginsPage } from "@/components/plugins/PluginsPage";
import { resetPlugins } from "@/plugins/usePlugins";
import type { InstallJob } from "@/plugins/useInstallFlow";

const URL_TEXT = "https://github.com/kinan9011/kafka-inspector";
const PERMISSIONS = [
  { name: "network", hosts: ["localhost:9092"], reason: "Connect to localhost:9092 and brokers you add" },
  { name: "clipboard:write", reason: "Copy decoded messages", optional: true },
];
const MANIFEST = { id: "kafka-inspector", name: "Kafka Inspector", version: "0.3.1", runtime: "web+wasm", permissions: PERMISSIONS };
const URL_PREVIEW = {
  ...MANIFEST,
  description: "d",
  url: "https://example.test/k.zip",
  sha256: "a".repeat(64),
  size: 2516582,
  repo: URL_TEXT,
  repoName: "kinan9011",
  kind: "releases",
  checksumMatches: true,
  repoAdded: false,
};

function renderDialog() {
  const onCancel = vi.fn();
  const onContinue = vi.fn<(job: InstallJob) => void>();
  const onOpenRepositories = vi.fn();
  render(<InstallDialog onCancel={onCancel} onContinue={onContinue} onOpenRepositories={onOpenRepositories} />);
  return { onCancel, onContinue, onOpenRepositories };
}

const lookUp = async (text = URL_TEXT) => {
  fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
};
// Lets the dialog read the setting first: a drop before that is ignored.
const dropOn = async (files: File[], entryIsDirectory = false, uriList = "") => {
  await act(async () => {});
  fireEvent.drop(screen.getByTestId("drop-zone"), {
    dataTransfer: { files, items: [{ webkitGetAsEntry: () => ({ isDirectory: entryIsDirectory }) }], getData: () => uriList },
  });
};

beforeEach(() => {
  resetPlugins();
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(toastMock).forEach((mock) => mock.mockReset());
  api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: true });
  api.clearDroppedZip.mockResolvedValue(undefined);
  api.onInstallProgress.mockResolvedValue(() => {});
  api.listPlugins.mockResolvedValue([]);
  api.repoCatalog.mockResolvedValue([]);
  api.listRepos.mockResolvedValue([]);
  api.pluginUpdates.mockResolvedValue([]);
});

describe("InstallDialog", () => {
  it("shows the design copy", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Install plugin" })).toBeInTheDocument();
    expect(screen.getByText("From a zip file, a folder, or a GitHub repository URL.")).toBeInTheDocument();
    expect(screen.getByText("Drop a plugin .zip or folder here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose zip file" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeEnabled();
    expect(screen.getByText("or from a repository URL")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await waitFor(() => expect(api.repoSettings).toHaveBeenCalled());
  });

  it("looks up a repository URL, shows the preview and continues with a repository install", async () => {
    api.lookupUrl.mockResolvedValue(URL_PREVIEW);
    api.installFromUrl.mockResolvedValue({ id: "kafka-inspector" });
    const { onContinue } = renderDialog();
    await lookUp();
    expect(await screen.findByText("Kafka Inspector 0.3.1")).toBeInTheDocument();
    expect(screen.getByText("Latest GitHub release v0.3.1 · 2.4 MB · Web + WASM")).toBeInTheDocument();
    expect(screen.getByText("Checksum matches")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Add this repository so the plugin gets updates" });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(api.lookupUrl).toHaveBeenCalledWith(URL_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const job = onContinue.mock.calls[0]![0];
    expect(job).toMatchObject({ id: "kafka-inspector", verified: true, entry: { name: "Kafka Inspector", repo: URL_TEXT } });
    await job.run();
    expect(api.installFromUrl).toHaveBeenCalledWith(URL_TEXT, true);
  });

  it("makes it a sideload when the repository box is cleared", async () => {
    api.lookupUrl.mockResolvedValue(URL_PREVIEW);
    const { onContinue } = renderDialog();
    await lookUp();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Add this repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue.mock.calls[0]![0].verified).toBe(false);
    await onContinue.mock.calls[0]![0].run();
    expect(api.installFromUrl).toHaveBeenCalledWith(URL_TEXT, false);
  });

  it("hides the checkbox for a repository that is already added", async () => {
    api.lookupUrl.mockResolvedValue({ ...URL_PREVIEW, repoAdded: true });
    renderDialog();
    await lookUp();
    await screen.findByText("Kafka Inspector 0.3.1");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("blocks Continue on a checksum mismatch", async () => {
    api.lookupUrl.mockResolvedValue({ ...URL_PREVIEW, checksumMatches: false });
    renderDialog();
    await lookUp();
    expect(await screen.findByText("Checksum doesn't match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("shows a failed lookup inline and drops an old preview when the URL changes", async () => {
    api.lookupUrl.mockResolvedValueOnce(URL_PREVIEW).mockRejectedValueOnce("Not a plugin repository");
    renderDialog();
    await lookUp();
    await screen.findByText("Kafka Inspector 0.3.1");
    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://github.com/a/b" } });
    expect(screen.queryByText("Kafka Inspector 0.3.1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not a plugin repository");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("inspects a chosen zip and installs it with the inspected checksum", async () => {
    api.pickPluginZip.mockResolvedValue("/home/me/kafka-inspector-0.3.1.zip");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "b".repeat(64), warnings: [] });
    api.installZip.mockResolvedValue({ id: "kafka-inspector" });
    const { onContinue } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Choose zip file" }));
    expect(await screen.findByText("Kafka Inspector 0.3.1")).toBeInTheDocument();
    expect(screen.getByText("kafka-inspector-0.3.1.zip · Web + WASM")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const job = onContinue.mock.calls[0]![0];
    expect(job).toMatchObject({ id: "kafka-inspector", verified: false, entry: { repo: "kafka-inspector-0.3.1.zip" } });
    await job.run();
    expect(api.inspectZip).toHaveBeenCalledWith("/home/me/kafka-inspector-0.3.1.zip");
    expect(api.installZip).toHaveBeenCalledWith("/home/me/kafka-inspector-0.3.1.zip", "b".repeat(64));
    expect(job.discard).toBeUndefined();
  });

  it("does nothing when the zip picker is cancelled", async () => {
    api.pickPluginZip.mockResolvedValue(null);
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Choose zip file" }));
    await waitFor(() => expect(api.pickPluginZip).toHaveBeenCalled());
    expect(api.inspectZip).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("inspects a chosen folder", async () => {
    api.pickPluginFolder.mockResolvedValue("/home/me/dev/kafka-inspector");
    api.inspectFolder.mockResolvedValue({ manifest: MANIFEST, warnings: [] });
    api.installPluginFolder.mockResolvedValue({ id: "kafka-inspector" });
    const { onContinue } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText("kafka-inspector · Web + WASM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await onContinue.mock.calls[0]![0].run();
    expect(api.installPluginFolder).toHaveBeenCalledWith("/home/me/dev/kafka-inspector");
  });

  it("shows the validation errors of a bad folder, one per line", async () => {
    api.pickPluginFolder.mockResolvedValue("/x");
    api.inspectFolder.mockRejectedValue("plugin.json: id is required\nplugin.json: entry is required");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("id is required");
  });

  it("stages a dropped zip, installs it and cleans up through the job", async () => {
    api.stageDroppedZip.mockResolvedValue("/data/plugins/.drop/dropped.zip");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    const { onContinue } = renderDialog();
    const file = new File(["zip"], "dropped-plugin.zip");
    await dropOn([file]);
    expect(await screen.findByText("dropped-plugin.zip · Web + WASM")).toBeInTheDocument();
    expect(api.stageDroppedZip).toHaveBeenCalledWith(file);
    expect(api.inspectZip).toHaveBeenCalledWith("/data/plugins/.drop/dropped.zip");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const job = onContinue.mock.calls[0]![0];
    await job.discard?.();
    expect(api.clearDroppedZip).toHaveBeenCalledTimes(1);
  });

  it("installs from the path of a dropped file:// URI when the webview gives no File", async () => {
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    renderDialog();
    await dropOn([], false, "# comment\r\nfile:///home/u/My%20Plugin.zip\r\n");
    expect(await screen.findByText("My Plugin.zip · Web + WASM")).toBeInTheDocument();
    expect(api.inspectZip).toHaveBeenCalledWith("/home/u/My Plugin.zip");
    expect(api.stageDroppedZip).not.toHaveBeenCalled();
  });

  it("tells a dropped folder or a dropped non-zip what to do", async () => {
    renderDialog();
    await dropOn([new File([""], "my-plugin")], true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Folders can't be dropped here. Use Choose folder.");
    await dropOn([new File(["x"], "notes.txt")]);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Drop a plugin .zip file."));
    expect(api.stageDroppedZip).not.toHaveBeenCalled();
  });

  it("Escape cancels the dialog", async () => {
    api.stageDroppedZip.mockResolvedValue("/data/plugins/.drop/dropped.zip");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    const { onCancel } = renderDialog();
    await dropOn([new File(["zip"], "dropped-plugin.zip")]);
    await screen.findByText("Kafka Inspector 0.3.1");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("clears the dropped zip on unmount unless Continue took it", async () => {
    api.stageDroppedZip.mockResolvedValue("/p");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    const first = render(<InstallDialog onCancel={() => {}} onContinue={() => {}} onOpenRepositories={() => {}} />);
    await dropOn([new File(["zip"], "a.zip")]);
    await screen.findByText("Kafka Inspector 0.3.1");
    first.unmount();
    expect(api.clearDroppedZip).toHaveBeenCalledTimes(1);

    render(<InstallDialog onCancel={() => {}} onContinue={() => {}} onOpenRepositories={() => {}} />);
    await dropOn([new File(["zip"], "b.zip")]);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    screen.getByRole("button", { name: "Cancel" });
    expect(api.clearDroppedZip).toHaveBeenCalledTimes(1);
  });

  it("still clears an earlier dropped zip when Continue takes a picked zip", async () => {
    api.stageDroppedZip.mockResolvedValue("/p");
    api.pickPluginZip.mockResolvedValue("/home/me/other.zip");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    const view = render(<InstallDialog onCancel={() => {}} onContinue={() => {}} onOpenRepositories={() => {}} />);
    await dropOn([new File(["zip"], "a.zip")]);
    await screen.findByText("a.zip · Web + WASM");
    fireEvent.click(screen.getByRole("button", { name: "Choose zip file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("other.zip · Web + WASM");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    view.unmount();
    expect(api.clearDroppedZip).toHaveBeenCalledTimes(1);
  });

  it("ignores a lookup result after the URL was edited", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.lookupUrl.mockReturnValue(new Promise((done) => (resolve = done)));
    renderDialog();
    await lookUp();
    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://github.com/a/b" } });
    resolve(URL_PREVIEW);
    await waitFor(() => expect(screen.getByRole("button", { name: "Look up" })).toBeEnabled());
    expect(screen.queryByText("Kafka Inspector 0.3.1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("explains that outside installs are off, links to Repositories and gates the controls", async () => {
    api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
    api.lookupUrl.mockResolvedValue(URL_PREVIEW);
    const { onOpenRepositories, onContinue } = renderDialog();
    expect(await screen.findByText(/outside your repositories are turned off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose zip file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeDisabled();
    await dropOn([new File(["zip"], "a.zip")]);
    expect(api.stageDroppedZip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change this in Repositories" }));
    expect(onOpenRepositories).toHaveBeenCalled();

    await lookUp();
    const checkbox = await screen.findByRole("checkbox", { name: /Add this repository/ });
    fireEvent.click(checkbox);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(checkbox);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("PluginsPage with the install dialog", () => {
  it("opens from the button and leads Continue into the permission dialog and the install", async () => {
    api.lookupUrl.mockResolvedValue(URL_PREVIEW);
    api.installFromUrl.mockResolvedValue({ id: "kafka-inspector" });
    api.setPluginGrants.mockResolvedValue({ id: "kafka-inspector" });
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Install from file or URL" }));
    await lookUp();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("dialog", { name: "Install plugin" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Allow Kafka Inspector to:" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow and install" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Installed", expect.objectContaining({ description: "Kafka Inspector" })));
    expect(api.installFromUrl).toHaveBeenCalledWith(URL_TEXT, true);
    expect(api.setPluginGrants).toHaveBeenCalledWith("kafka-inspector", ["network", "clipboard:write"]);
  });

  it("cancelling the permission dialog of a dropped zip clears it", async () => {
    api.stageDroppedZip.mockResolvedValue("/p");
    api.inspectZip.mockResolvedValue({ manifest: MANIFEST, sha256: "c".repeat(64), warnings: [] });
    render(<PluginsPage tab="browse" onTabChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Install from file or URL" }));
    await dropOn([new File(["zip"], "a.zip")]);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.clearDroppedZip).toHaveBeenCalledTimes(1);
    expect(api.installZip).not.toHaveBeenCalled();
  });

  it("the Repositories link closes the dialog and opens that tab", async () => {
    api.repoSettings.mockResolvedValue({ checkOnStart: true, allowOutside: false });
    const onTabChange = vi.fn();
    render(<PluginsPage tab="browse" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Install from file or URL" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change this in Repositories" }));
    expect(onTabChange).toHaveBeenCalledWith("repositories");
    expect(screen.queryByRole("dialog", { name: "Install plugin" })).not.toBeInTheDocument();
  });
});
