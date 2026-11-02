import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { remote } from "webdriverio";

// Drives an e2e build of the desktop app and checks the main flows.
//
// Linux: starts the app through tauri-driver and WebKitWebDriver. CI runs it under xvfb.
// Windows: starts the app with a WebView2 debugging port and attaches msedgedriver to it.
//   Set NATIVE_DRIVER to an msedgedriver.exe that matches the WebView2 version.
//
// Build the app with the e2e feature first, so file saves skip the native dialog:
//   npx tauri build --no-bundle --features e2e   (Windows: add --config e2e/tauri.e2e.conf.json)
//
// Usage: node e2e/smoke.mjs [path-to-app-binary]

const isWindows = process.platform === "win32";
const rootDir = path.resolve(import.meta.dirname, "..");
const application = path.resolve(
  process.argv[2] ??
    path.join(rootDir, "src-tauri", "target", "release", isWindows ? "Shard.exe" : "Shard"),
);
const screenshotDir = path.join(rootDir, "e2e", "screenshots");
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "shard-e2e-saves-"));
const expectedVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const toolNames = [
  ...fs.readFileSync(path.join(rootDir, "src", "app", "toolRegistry.ts"), "utf8").matchAll(/name: "([^"]+)"/g),
].map((match) => match[1]);

// WebView2 debugging port. It must match additionalBrowserArgs in e2e/tauri.e2e.conf.json.
const WEBVIEW2_DEBUG_PORT = 9222;

if (!fs.existsSync(application)) {
  console.error(`App binary not found: ${application}`);
  process.exit(1);
}

fs.mkdirSync(screenshotDir, { recursive: true });

const children = [];
let browser;

function startProcess(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, SHARD_E2E_SAVE_DIR: saveDir, ...env },
  });
  children.push(child);
  return child;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startSession() {
  if (isWindows) {
    startProcess(application, []);
    startProcess(process.env.NATIVE_DRIVER ?? "msedgedriver.exe", ["--port=4444"]);
    await delay(5000);
    return remote({
      hostname: "127.0.0.1",
      port: 4444,
      logLevel: "warn",
      connectionRetryCount: 0,
      connectionRetryTimeout: 30000,
      capabilities: {
        browserName: "webview2",
        "wdio:enforceWebDriverClassic": true,
        "ms:edgeOptions": { debuggerAddress: `localhost:${WEBVIEW2_DEBUG_PORT}` },
      },
    });
  }

  startProcess(process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver"), []);
  await delay(1000);
  return remote({
    hostname: "127.0.0.1",
    port: 4444,
    logLevel: "warn",
      connectionRetryCount: 0,
      connectionRetryTimeout: 30000,
    capabilities: {
      browserName: "wry",
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application },
    },
  });
}

async function openTool(name) {
  // WebDriver setValue does not always clear the field first on WebKitGTK, so set the value
  // through the native setter and fire the input event that React listens for.
  await browser.execute((value) => {
    const search = document.querySelector('input[placeholder="Search..."]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  // The sidebar and the home page can both list the tool. Use the sidebar entry.
  const toolButton = await browser.$$(`button*=${name}`)[0];
  await toolButton.waitForClickable({ timeout: 10000 });
  await toolButton.click();
  await browser.waitUntil(async () => {
    // App tool tabs have ids that start with "tab-". Tools can contain their own tabs.
    const selected = await browser.$('[role="tab"][aria-selected="true"][id^="tab-"]');
    // textContent, because WebDriver getText depends on layout heuristics for truncated labels.
    return await selected.isExisting() && (await selected.getProperty("textContent")) === name;
  }, { timeout: 10000, timeoutMsg: `Tool page did not open: ${name}` });
  await browser.$('section[role="tabpanel"]:not([hidden])').waitForDisplayed();
}

/** Calls a Tauri command from the page, through the same internals the app's own code uses. */
async function invokeCommand(command, args = {}) {
  // webdriverio 10 has no executeAsync; execute waits for a returned promise.
  const outcome = await browser.execute(
    async (name, params) => {
      try {
        return { value: await window.__TAURI_INTERNALS__.invoke(name, params) };
      } catch (error) {
        return { error: String(error) };
      }
    },
    command,
    args,
  );
  if (outcome.error) throw new Error(`${command} failed: ${outcome.error}`);
  return outcome.value;
}

/** Collects uncaught errors in `window.__e2eErrors`. A page reload drops the collector, so call it again after one. */
async function recordErrors() {
  await browser.execute(() => {
    window.__e2eErrors = [];
    window.addEventListener("error", (event) => window.__e2eErrors.push(String(event.message)));
    window.addEventListener("unhandledrejection", (event) => window.__e2eErrors.push(String(event.reason)));
  });
}

async function waitForText(element, text) {
  await browser.waitUntil(async () => (await element.getText()).includes(text), {
    timeout: 10000,
    timeoutMsg: `Text did not appear: ${text}`,
  });
}

async function waitForSavedFile(pattern) {
  let match;
  await browser.waitUntil(
    async () => {
      match = fs.readdirSync(saveDir).find((name) => pattern.test(name));
      return Boolean(match) && fs.statSync(path.join(saveDir, match)).size > 0;
    },
    { timeout: 15000, timeoutMsg: `No saved file matched ${pattern}` },
  );
  return fs.readFileSync(path.join(saveDir, match));
}

/** Saves a screenshot for the CI artifact. A hung WebKitWebDriver capture must not fail the run, so give it 15 seconds. */
async function screenshot(name) {
  const done = await Promise.race([
    browser?.saveScreenshot(path.join(screenshotDir, `${name}.png`)).then(() => true, () => false),
    delay(15000).then(() => false),
  ]);
  if (!done) console.log(`(screenshot ${name} skipped: driver did not answer) `);
}

async function step(name, run) {
  process.stdout.write(`- ${name} ... `);
  try {
    await run();
    console.log("ok");
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    await screenshot("failure");
    throw error;
  }
}

try {
  browser = await startSession();

  await step("records uncaught errors in the page", recordErrors);

  // A fresh profile opens the first-run wizard instead of the app. Mark it done and reload, so What's New and the
  // flows below start on Home. Done unconditionally, so it does not depend on how fast the app read its state.
  await step("skips the first-run wizard", async () => {
    await browser.execute(() => {
      localStorage.setItem("shard-first-run-done", "true");
      localStorage.setItem("shard-plugins-intro-seen", "true");
      localStorage.removeItem("shard-first-run-started");
    });
    await browser.refresh();
    await recordErrors();
    await browser.waitUntil(async () => !(await browser.$('[aria-label="Setup steps"]').isExisting()), {
      timeout: 10000,
      timeoutMsg: "The first-run wizard is still showing",
    });
  });

  await step("shows What's New for the installed version through the Tauri API", async () => {
    const dialog = await browser.$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 20000 });
    await waitForText(dialog, `Shard v${expectedVersion}`);
    await screenshot("whats-new");
    await (await browser.$("button=Got it")).click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 5000 });
  });

  await step("shows the app version in the sidebar footer", async () => {
    await waitForText(await browser.$("body"), `v${expectedVersion}`);
    await screenshot("home");
  });

  await step(`opens all ${toolNames.length} tools`, async () => {
    if (toolNames.length < 9) {
      throw new Error(`Expected the full tool list, found ${toolNames.length} tools.`);
    }

    for (const name of toolNames) {
      await openTool(name);
      // Each lazy-loaded tool renders its own content below the page title.
      // innerText through execute, because WebKitGTK's WebDriver getText fails on some tool markup
      // ("Cannot check the displayedness of a non-Element argument").
      await browser.waitUntil(
        async () => (await browser.execute(() => document.querySelector("main").innerText.length)) > name.length + 20,
        { timeout: 10000, timeoutMsg: `Tool content did not render: ${name}` },
      );
    }
  });

  await step("decodes a JWT", async () => {
    await openTool("JWT Decoder");
    await browser.execute(() => {
      const input = document.querySelector("#jwt-input");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(
        input,
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => document.querySelector("section.tool-panel:not([hidden])").innerText.includes("John Doe")),
      { timeout: 5000, timeoutMsg: "Decoded JWT payload did not show" },
    );
  });

  await step("formats JSON", async () => {
    await openTool("JSON Viewer");
    // The JSON workspace re-renders while it works, so drive it inside the page to avoid stale elements.
    await browser.execute(() => {
      const input = document.querySelector("#json-workspace-input");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, '{"a":1,"b":[true]}');
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await browser.execute(() =>
      [...document.querySelectorAll("section.tool-panel:not([hidden]) button")]
        .find((button) => button.innerText.trim() === "Format")
        .click(),
    );
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          document.querySelector("section.tool-panel:not([hidden])").innerText.includes('"b": ['),
        ),
      { timeout: 10000, timeoutMsg: "Formatted JSON did not appear" },
    );
  });

  await step("opens a file in Diff & Merge and saves it", async () => {
    await openTool("Diff & Merge");
    // Hand the page a File directly: a WebDriver file upload into the hidden input hangs WebKitGTK.
    // Other open tools stay mounted in hidden panels and can have their own file inputs.
    await browser.execute(() => {
      const input = document.querySelector('section.tool-panel:not([hidden]) input[type="file"][aria-label="Open file into Original"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File(["diff and save check\n"], "sample-notes.txt", { type: "text/plain" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveSelector = 'section.tool-panel:not([hidden]) button[aria-label="Save Original"]';
    await browser.waitUntil(() => browser.execute((selector) => Boolean(document.querySelector(selector)), saveSelector), {
      timeout: 15000,
      timeoutMsg: "The Save Original button did not appear",
    });
    await browser.execute((selector) => document.querySelector(selector).click(), saveSelector);
    const saved = await waitForSavedFile(/^sample-notes.*\.txt$/);
    if (saved.toString("utf8") !== "diff and save check\n") {
      throw new Error("The saved file does not match the opened file.");
    }
  });

  await step("toggles the theme", async () => {
    const isDark = () => browser.execute(() => document.documentElement.classList.contains("dark"));
    const before = await isDark();
    // The header button switches straight to the opposite mode.
    await (await browser.$(`button[aria-label="Switch to ${before ? "light" : "dark"} mode"]`)).click();
    await browser.waitUntil(async () => (await isDark()) !== before, {
      timeout: 5000,
      timeoutMsg: "The theme did not change",
    });
  });

  await step("opens a tool from the command palette shortcut", async () => {
    // Clicking body lands in whatever tool fills the page (an editor ignores app shortcuts), so drop focus instead.
    await browser.execute(() => document.activeElement?.blur());
    await browser.keys(["Control", "k"]);
    const paletteInput = await browser.$('input[placeholder="Search tools..."]');
    await paletteInput.waitForDisplayed({ timeout: 5000 });
    await paletteInput.setValue("JWT");
    await browser.keys("Enter");
    // Every opened tool stays in the page, so check the selected tab rather than a label that
    // more than one tool can have.
    await browser.waitUntil(async () => {
      const selected = await browser.$('[role="tab"][aria-selected="true"][id^="tab-"]');
      return await selected.isExisting() && (await selected.getProperty("textContent")) === "JWT Decoder";
    }, { timeout: 10000, timeoutMsg: "The command palette did not open JWT Decoder" });
    await screenshot("command-palette");
  });

  // The hello plugin is a sideload, which the app refuses unless "Allow installs from outside these repositories" is on.
  // Put the setting back afterwards, and remove the plugin even when a step fails.
  let allowOutside;
  let helloInstalled = false;
  try {
    await step("installs the hello plugin from a folder fixture", async () => {
      allowOutside = (await invokeCommand("repo_set_settings", {})).allowOutside;
      await invokeCommand("repo_set_settings", { allowOutside: true });
      await invokeCommand("plugin_install_folder", { path: path.join(rootDir, "plugins", "examples", "hello") });
      helloInstalled = true;
      // The app reads the plugin list once at start, so load it again to see the new plugin.
      await browser.refresh();
      await (await browser.$("body")).waitForDisplayed();
      await recordErrors();
    });

    await step("opens the hello plugin in a sandboxed frame", async () => {
      await openTool("Hello Plugin");
      const frame = await browser.$("section.tool-panel:not([hidden]) iframe");
      await frame.waitForExist({ timeout: 10000 });
      if ((await frame.getAttribute("sandbox")) !== "allow-scripts") {
        throw new Error(`Unexpected sandbox: ${await frame.getAttribute("sandbox")}`);
      }
      // The frame's wrapper switches to "ready" once the plugin has finished the SDK handshake.
      await browser.waitUntil(
        () => browser.execute(() => document.querySelector("section.tool-panel:not([hidden]) [data-state]")?.dataset.state === "ready"),
        { timeout: 15000, timeoutMsg: "The plugin did not finish its handshake" },
      );
      await screenshot("hello-plugin");
    });

    await step("uninstalls the hello plugin from the Plugins page", async () => {
      const click = async (selector) => {
        const element = await browser.$(selector);
        await element.waitForClickable({ timeout: 10000 });
        await element.click();
      };
      await click("button.sidebar-destination*=Plugins");
      await click("#plugins-tab-installed");
      await click('button[aria-label="Actions for Hello Plugin"]');
      await click('[role="menuitem"]=Uninstall');
      await click('[role="alertdialog"] button=Uninstall');
      await browser.waitUntil(async () => !(await invokeCommand("plugins_list")).some((plugin) => plugin.id === "hello"), {
        timeout: 10000,
        timeoutMsg: "The hello plugin is still installed",
      });
      helloInstalled = false;
    });
  } finally {
    if (helloInstalled) await invokeCommand("plugin_uninstall", { id: "hello" }).catch(() => {});
    if (allowOutside !== undefined) await invokeCommand("repo_set_settings", { allowOutside }).catch(() => {});
  }

  await step("has no uncaught errors in the page", async () => {
    const errors = await browser.execute(() => window.__e2eErrors);
    if (errors.length > 0) {
      throw new Error(`Uncaught errors: ${errors.join(" | ")}`);
    }
  });

  console.log("E2E smoke test passed.");
} finally {
  await browser?.deleteSession().catch(() => {});
  children.forEach((child) => child.kill());
}
