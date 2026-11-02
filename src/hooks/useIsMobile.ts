import { useEffect, useState } from "react";
import { PHONE_QUERY, isMobilePlatform } from "@/lib/platform";

const narrow = (): boolean => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? Boolean(window.matchMedia(PHONE_QUERY)?.matches) : false);

/** True on a phone: the Android or iOS app, or a window narrower than 640 px (the browser preview on a phone, or Chrome's device mode). */
export function useIsMobile(platform?: string): boolean {
  const [isNarrow, setNarrow] = useState(narrow);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    if (!query || typeof query.addEventListener !== "function") return;
    const update = () => setNarrow(Boolean(query.matches));
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobilePlatform(platform) || isNarrow;
}
