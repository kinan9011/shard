import { useEffect, useState } from "react";
import { connect, type Theme } from "./shard-sdk";

const sdk = connect();

/** Match the app: the host sends its CSS custom properties, which the Tailwind preset reads through var(--...). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

export default function App() {
  const [status, setStatus] = useState("Connecting…");
  const [opened, setOpened] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopListening = () => {};
    (async () => {
      try {
        const { theme } = await sdk.ready();
        if (cancelled) return;
        applyTheme(theme);
        stopListening = sdk.theme.onChange(applyTheme);
        // storage is a small key-value store that belongs to this plugin.
        const count = ((await sdk.storage.get<number>("opened")) ?? 0) + 1;
        await sdk.storage.set("opened", count);
        if (cancelled) return;
        setOpened(count);
        setStatus("Connected to Shard");
      } catch (error) {
        // Outside the app (opened as a plain page, or under `npm run dev`) there is no host to answer.
        if (!cancelled) setStatus(`Not connected to Shard: ${(error as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      stopListening();
    };
  }, []);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold">My Plugin</h1>
      <p className="mt-2 text-muted-foreground">Edit src/App.tsx to build your tool.</p>
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={() => sdk.toast("Hello from My Plugin", "success").catch((error) => setStatus(error.message))}
        >
          Say hello
        </button>
        <span className="text-sm text-muted-foreground">
          {status}
          {opened !== null && ` · opened ${opened} ${opened === 1 ? "time" : "times"}`}
        </span>
      </div>
    </main>
  );
}
