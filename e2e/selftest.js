// In-app smoke test for platforms without a WebDriver for the system webview (macOS).
// The e2e build injects this script when SHARD_E2E_SELFTEST is set. The script drives
// the UI through the DOM and reports the result through the e2e_report command, which
// prints the log and exits the app with the test result.
(async () => {
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const log = [];
  const errors = [];
  window.addEventListener("error", (event) => errors.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(check, description, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = await check();
      if (result) {
        return result;
      }
      await delay(100);
    }
    throw new Error(`Timed out: ${description}`);
  }

  // innerText leaves out the values of text fields, so add them.
  const text = (element = document.body) =>
    [element.innerText || "", ...[...element.querySelectorAll("textarea, input")].map((field) => field.value)].join("\n");
  // Only visible buttons. Open tools can stay mounted in hidden panels.
  const buttons = (label, { exact = false } = {}) =>
    [...document.querySelectorAll("button")].filter((button) => {
      const buttonLabel = (button.innerText || "").trim();
      return button.offsetParent !== null && (exact ? buttonLabel === label : buttonLabel.includes(label));
    });

  // The tool page shows the tool name as a page title or as the selected tab.
  const isToolOpen = (name) =>
    [...document.querySelectorAll('main h1, [role="tab"][aria-selected="true"]')].some(
      (element) => (element.innerText || "").trim() === name,
    );
  const toolContent = () =>
    document.querySelector("section.tool-panel:not([hidden])") || document.querySelector("main");

  function setValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function openTool(name) {
    setValue(document.querySelector('input[placeholder="Search..."]'), name);
    const button = await waitFor(() => buttons(name)[0], `tool button ${name}`);
    button.click();
    await waitFor(() => isToolOpen(name), `tool page ${name}`);
  }

  async function step(name, run) {
    try {
      await run();
      log.push(`- ${name} ... ok`);
    } catch (error) {
      log.push(`- ${name} ... FAILED: ${error.message}`);
      throw error;
    }
  }

  const PNG_HEADER = "89504e47";
  const SAMPLE_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

  const PLUGIN_IDS = ["hello", "hash-wasm", "e2e-ipc-spike"];
  const isWindows = navigator.userAgent.includes("Windows");
  // Where the protocol handler serves a plugin file (see src/plugins/url.ts).
  const pluginUrl = (id, path) =>
    isWindows ? `http://shard-plugin.localhost/${id}/${path}` : `shard-plugin://${id}/${path}`;

  let passed = false;
  let reloading = false;
  try {
    const version = await invoke("plugin:app|version");
    const isMac = navigator.platform.toLowerCase().includes("mac");

    // From 3.0.0 a fresh profile opens the first-run wizard instead of the app. Mark it done so the flows below start on Home.
    // The app may already have read the old state, so if the wizard is up, reload once (the keys stay in localStorage).
    localStorage.setItem("shard-first-run-done", "true");
    localStorage.setItem("shard-plugins-intro-seen", "true");
    localStorage.removeItem("shard-first-run-started");
    const wizard = () => document.querySelector('[aria-label="Setup steps"]');
    await waitFor(() => wizard() || text().includes(`v${version}`), "the app or the first-run wizard", 20000);
    if (wizard()) {
      if (sessionStorage.getItem("e2e-wizard-skipped")) throw new Error("The first-run wizard is still showing.");
      sessionStorage.setItem("e2e-wizard-skipped", "1");
      reloading = true;
      location.reload();
      return;
    }

    // The plugin list is read once when the app starts, so install the fixtures and reload to pick them up.
    const installedPlugins = await invoke("plugins_list");
    if (!PLUGIN_IDS.every((id) => installedPlugins.some((plugin) => plugin.id === id))) {
      if (sessionStorage.getItem("e2e-plugins-installed")) throw new Error("The plugin fixtures did not install.");
      // The test removes the fixtures at the end, so it must never start on top of a plugin it did not install.
      const clash = PLUGIN_IDS.filter((id) => installedPlugins.some((plugin) => plugin.id === id));
      if (clash.length > 0) throw new Error(`Plugin ids already installed (${clash.join(", ")}). Remove them or use an empty app data folder.`);
      // Installing from a folder is a sideload, which the app refuses unless the setting allows it. Put it back at the end.
      const settings = await invoke("repo_set_settings", {});
      // Keep the first value: after a reload or an aborted run the setting is already on.
      if (sessionStorage.getItem("e2e-allow-outside") === null) sessionStorage.setItem("e2e-allow-outside", String(settings.allowOutside));
      await invoke("repo_set_settings", { allowOutside: true });
      for (const path of await invoke("e2e_plugin_fixtures")) {
        await invoke("plugin_install_folder", { path });
      }
      sessionStorage.setItem("e2e-plugins-installed", "1");
      reloading = true;
      location.reload();
      return;
    }

    await step("shows What's New for the installed version through the Tauri API", async () => {
      // A first launch opens the dialog by itself. A later launch has marked it as seen.
      await waitFor(() => text().includes(`v${version}`), "app start", 20000);
      await delay(1000);
      if (!document.querySelector('[role="dialog"]')) {
        buttons("What's New")[0].click();
      }
      const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), "What's New dialog");
      await waitFor(() => text(dialog).includes(`Shard v${version}`), "dialog version");
      buttons("Got it")[0].click();
      await waitFor(() => !document.querySelector('[role="dialog"]'), "dialog closes");
    });

    await step("shows the app version in the sidebar footer", async () => {
      await waitFor(() => text().includes(`v${version}`), "footer version");
    });

    await step("opens every tool", async () => {
      const toolNames = await invoke("e2e_tool_names");
      if (toolNames.length < 9) {
        throw new Error(`Expected the full tool list, found ${toolNames.length} tools`);
      }
      for (const name of toolNames) {
        await openTool(name);
        await waitFor(() => text(toolContent()).length > name.length + 20, `content of ${name}`);
      }
    });

    await step("decodes a JWT", async () => {
      await openTool("JWT Decoder");
      setValue(
        document.querySelector("#jwt-input"),
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature",
      );
      await waitFor(() => text(toolContent()).includes("John Doe"), "decoded JWT payload");
    });

    await step("formats JSON", async () => {
      await openTool("JSON Viewer");
      const input =
        document.querySelector("#json-workspace-input") ||
        document.querySelector('textarea[placeholder="Paste your JSON here..."]');
      setValue(input, '{"a":1,"b":[true]}');
      buttons("Format", { exact: true })[0].click();
      await waitFor(() => text(toolContent()).includes('"b": ['), "formatted JSON");
    });

    await step("compresses and saves an image", async () => {
      await openTool("Image Converter");
      const bytes = Uint8Array.from(atob(SAMPLE_PNG), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "sample-image.png", { type: "image/png" }));
      // Other open tools stay mounted in hidden panels and can have their own file inputs.
      const input = toolContent().querySelector('input[type="file"]');
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const download = await waitFor(
        () => buttons("Download Image").find((button) => !button.disabled),
        "image download button",
      );
      download.click();
      await waitFor(async () => {
        const files = await invoke("e2e_saved_files");
        return files.some(([name, header]) => name.startsWith("sample-image") && header === PNG_HEADER);
      }, "saved compressed image");
    });

    await step("toggles the theme", async () => {
      const before = document.documentElement.classList.contains("dark");
      // Settings → Appearance: the header's Appearance button opens it, and the Theme control picks the opposite mode.
      document.querySelector('button[aria-label="Appearance"]').click();
      const mode = await waitFor(
        () => [...document.querySelectorAll('[role="group"][aria-label="Theme"] button')].find((button) => button.innerText.trim() === (before ? "Light" : "Dark")),
        "theme button",
      );
      mode.click();
      await waitFor(() => document.documentElement.classList.contains("dark") !== before, "theme change");
    });

    await step("opens a tool from the command palette shortcut", async () => {
      document.body.focus();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac, bubbles: true }),
      );
      const input = await waitFor(() => document.querySelector('input[placeholder="Search tools..."]'), "palette");
      setValue(input, "JWT");
      await delay(200);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await waitFor(() => isToolOpen("JWT Decoder"), "JWT Decoder");
    });

    await step("installed the hello plugin from a folder fixture", async () => {
      const hello = (await invoke("plugins_list")).find((plugin) => plugin.id === "hello");
      if (!hello || !hello.enabled) throw new Error("The hello plugin is not installed and enabled.");
      if (!hello.source || hello.source.kind !== "folder") throw new Error(`Unexpected source: ${JSON.stringify(hello.source)}`);
      if (hello.verified) throw new Error("A folder install must be unverified.");
    });

    await step("serves the hello plugin through the shard-plugin protocol", async () => {
      const response = await fetch(pluginUrl("hello", "index.html"));
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      if (!(response.headers.get("content-type") || "").startsWith("text/html")) throw new Error("Wrong content type");
      if (!(await response.text()).includes("Hello Plugin")) throw new Error("Wrong page");
    });

    await step("opens the hello plugin in a sandboxed frame", async () => {
      await openTool("Hello Plugin");
      const frame = await waitFor(() => toolContent().querySelector("iframe"), "plugin frame");
      if (frame.getAttribute("sandbox") !== "allow-scripts") throw new Error(`sandbox is "${frame.getAttribute("sandbox")}"`);
      await waitFor(() => frame.parentElement.dataset.state === "ready", "plugin frame load");
    });

    await step("lets the hello plugin use the SDK (ready, storage) through the host bridge", async () => {
      // app.js counts its opens with sdk.storage. The value only exists if frame -> bridge -> Rust all worked.
      const opened = await waitFor(() => invoke("plugin_storage_get", { id: "hello", key: "opened" }), "the plugin's storage value", 10000);
      if (typeof opened !== "number" || opened < 1) throw new Error(`Unexpected stored value: ${JSON.stringify(opened)}`);
    });

    await step("loads the WASM example's module and hashes in a worker and on the main thread", async () => {
      const started = Date.now();
      await openTool("WASM Hash");
      // app.js hashes "abc" both ways and stores the result. It exists only if loadWasm and the worker worked in the frame.
      // `at` rejects a value left by an earlier run.
      const result = await waitFor(async () => {
        const value = await invoke("plugin_storage_get", { id: "hash-wasm", key: "selfCheck" });
        return value && value.at >= started ? value : null;
      }, "the WASM self-check", 15000);
      log.push(`    wasm: ${JSON.stringify(result)}`);
      if (result.main !== true) throw new Error(`The module did not hash on the main thread: ${JSON.stringify(result)}`);
      if (result.worker !== true) throw new Error(`The module did not hash in a worker: ${JSON.stringify(result)}`);
    });

    await step("keeps Tauri IPC out of the plugin frame", async () => {
      let report = null;
      let progress = null;
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (data && data.type === "e2e-ipc-spike") report = data.results;
        if (data && data.type === "e2e-ipc-spike-progress") progress = data.results;
      });
      await openTool("IPC Spike");
      await waitFor(() => report, "the spike report (last progress: " + JSON.stringify(progress) + ")", 20000).catch((error) => {
        throw new Error(`${error.message.replace(/\(last progress: .*\)/, "")}last progress: ${JSON.stringify(progress)}`);
      });
      log.push(`    spike: ${JSON.stringify(report)}`);
      const failed = Object.entries(report).filter(([name, value]) => !name.startsWith("info:") && value !== true);
      if (failed.length > 0) throw new Error(`Not isolated: ${JSON.stringify(failed)}`);
      // The keyless message would have disabled the spike plugin if IPC had run it.
      await delay(1500);
      const spike = (await invoke("plugins_list")).find((plugin) => plugin.id === "e2e-ipc-spike");
      if (!spike || !spike.enabled) throw new Error("A command from the plugin frame reached the backend.");
    });

    await step("uninstalls the hello plugin from the Plugins page", async () => {
      const clickWhenReady = async (find, description) => (await waitFor(find, description)).click();
      await clickWhenReady(() => [...document.querySelectorAll("button.sidebar-destination")].find((button) => button.innerText.includes("Plugins")), "Plugins destination");
      await clickWhenReady(() => document.getElementById("plugins-tab-installed"), "Installed tab");
      await clickWhenReady(() => document.querySelector('button[aria-label="Actions for Hello Plugin"]'), "Hello Plugin actions");
      await clickWhenReady(() => [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.innerText.trim() === "Uninstall"), "Uninstall menu item");
      const dialog = await waitFor(() => document.querySelector('[role="alertdialog"]'), "uninstall confirmation");
      [...dialog.querySelectorAll("button")].find((button) => button.innerText.trim() === "Uninstall").click();
      await waitFor(async () => !(await invoke("plugins_list")).some((plugin) => plugin.id === "hello"), "the hello plugin to be removed");
      await waitFor(() => !document.querySelector('button[aria-label="Actions for Hello Plugin"]'), "the row to disappear");
    });

    await step("has no uncaught errors in the page", async () => {
      if (errors.length > 0) {
        throw new Error(errors.join(" | "));
      }
    });

    passed = true;
    log.push("E2E self-test passed.");
  } catch (error) {
    log.push(`E2E self-test failed: ${error.message}`);
  }

  if (reloading) return;
  // Only the fixtures this run installed (the flag is set only then).
  for (const id of sessionStorage.getItem("e2e-plugins-installed") ? PLUGIN_IDS : []) {
    await invoke("plugin_uninstall", { id }).catch(() => {});
  }
  const outside = sessionStorage.getItem("e2e-allow-outside");
  if (outside !== null) await invoke("repo_set_settings", { allowOutside: outside === "true" }).catch(() => {});
  await invoke("e2e_report", { passed, output: log.join("\n") });
})();
