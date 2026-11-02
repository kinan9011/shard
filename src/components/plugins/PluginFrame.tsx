import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useToolActive } from "@/hooks/useToolActive";
import { setPluginEnabled } from "@/plugins/api";
import { attachBridge, notifyVisibilityChanged } from "@/plugins/bridge";
import { refreshPlugins, usePlugins } from "@/plugins/usePlugins";
import { pluginUrl } from "@/plugins/url";

/** A plugin that has not finished the SDK handshake (`ready`) by now is treated as broken. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

type FrameState = "loading" | "ready" | "crashed";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">{children}</div>;
}

function Frame({ id, src, name, granted, onReload }: { id: string; src: string; name: string; granted: readonly string[]; onReload: () => void }) {
  const [state, setState] = useState<FrameState>("loading");
  const [disabling, setDisabling] = useState(false);
  // A plugin that was only slow (the 10 s ran out, then it said ready) recovers. One that reported an error stays on the crash screen.
  const timedOut = useRef(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The bridge reads the grants and the tab state on every call, so a change applies without reloading the frame.
  const grantedRef = useRef(granted);
  const active = useToolActive();
  const activeRef = useRef(active);
  useEffect(() => {
    grantedRef.current = granted;
  }, [granted]);
  useEffect(() => {
    activeRef.current = active;
    notifyVisibilityChanged(id, active);
  }, [active, id]);

  // The SDK bridge answers this frame only. It stays attached for the frame's whole life, so the plugin can call it as soon as it loads.
  useEffect(
    () =>
      frameRef.current
        ? attachBridge(frameRef.current, {
            id,
            name,
            granted: () => grantedRef.current,
            visible: () => activeRef.current,
            onReady: () => setState((current) => (current === "loading" || (current === "crashed" && timedOut.current) ? "ready" : current)),
            onCrash: () => {
              timedOut.current = false;
              setState("crashed");
            },
          })
        : undefined,
    [id, name],
  );

  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => {
      timedOut.current = true;
      setState("crashed");
    }, HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const disable = async () => {
    setDisabling(true);
    try {
      await setPluginEnabled(id, false);
      await refreshPlugins();
    } catch (error) {
      setDisabling(false);
      toast.error(`Couldn't turn off ${name}`, { description: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="relative h-full w-full" data-state={state}>
      {/* ponytail: no allow-same-origin on purpose. The frame gets an opaque origin and cannot reach the app's Tauri IPC. */}
      <iframe
        ref={frameRef}
        sandbox="allow-scripts"
        src={src}
        title={name}
        className="h-full w-full border-0 bg-background"
      />
      {state === "loading" && (
        <div className="absolute inset-0 bg-background">
          <Notice>Loading {name}…</Notice>
        </div>
      )}
      {state === "crashed" && (
        <div className="absolute inset-0 bg-background">
          <Notice>
            <div role="alert" className="flex flex-col items-center gap-1">
              <p className="font-medium text-foreground">This plugin stopped working</p>
              <p>{name} did not respond or hit an error.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onReload}>Reload</Button>
              <Button variant="outline" size="sm" disabled={disabling} onClick={() => void disable()}>Disable</Button>
            </div>
          </Notice>
        </div>
      )}
    </div>
  );
}

/** A plugin's UI: its entry page in a sandboxed frame, with loading and error states. */
export function PluginFrame({ pluginId, name }: { pluginId: string; name: string }) {
  const { plugins, ready } = usePlugins();
  const [attempt, setAttempt] = useState(0);
  const plugin = plugins.find((candidate) => candidate.id === pluginId && candidate.enabled);

  if (!plugin) {
    return ready ? <Notice>{name} is not installed or is turned off.</Notice> : <Notice>Loading {name}…</Notice>;
  }
  return <Frame key={attempt} id={plugin.id} src={pluginUrl(plugin.id, plugin.manifest.entry)} name={name} granted={plugin.granted} onReload={() => setAttempt((n) => n + 1)} />;
}
