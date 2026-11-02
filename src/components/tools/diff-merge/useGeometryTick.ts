import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";

/**
 * Bumps a counter, at most once per frame, when either editor scrolls or changes size.
 * Gutter and change map read line geometry at render time, so they re-render on it.
 */
export function useGeometryTick(a: EditorView | null, b: EditorView | null = null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const list = [a, b].filter((v): v is EditorView => v !== null);
    if (!list.length) return;
    let frame: number | null = null;
    const bump = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setTick((n) => n + 1);
      });
    };
    const observer = new ResizeObserver(bump);
    for (const view of list) {
      view.scrollDOM.addEventListener("scroll", bump, { passive: true });
      observer.observe(view.scrollDOM);
      observer.observe(view.contentDOM);
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      for (const view of list) view.scrollDOM.removeEventListener("scroll", bump);
    };
  }, [a, b]);
  return tick;
}
