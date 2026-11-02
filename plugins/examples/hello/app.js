// Loaded as a module: this works only if the protocol sends the right MIME type and CORS header.
// shard-sdk.js is the plugin SDK, built from packages/plugin-sdk (npm run sdk:build) and shipped inside the package.
import { connect } from "./shard-sdk.js";

document.getElementById("greeting").textContent = "Hello from a plugin ✓";
document.getElementById("origin").textContent = `origin: ${location.origin}`;

// Match the app: the host sends its CSS custom properties, which style.css uses through var(--…).
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

const sdk = connect();
const status = document.getElementById("status");

document.getElementById("say-hello").addEventListener("click", () => {
  sdk.toast("Hello from the Hello plugin", "success").catch((error) => (status.textContent = error.message));
});

try {
  const { theme } = await sdk.ready();
  applyTheme(theme);
  sdk.theme.onChange(applyTheme);

  const opened = ((await sdk.storage.get("opened")) ?? 0) + 1;
  await sdk.storage.set("opened", opened);
  status.textContent = `Opened ${opened} ${opened === 1 ? "time" : "times"}`;
} catch (error) {
  // Outside the app (opened as a plain page) there is no host to answer.
  status.textContent = `Not connected to Shard: ${error.message}`;
}
