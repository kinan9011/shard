import { useCallback, useEffect, useMemo, useState } from "react";
import { listThemes, type UserThemeList } from "@/lib/desktop";
import { themeCss, userThemeSchemes } from "@/utils/theme";

const STYLE_ID = "shard-user-themes";

/** The themes folder as app state: reads it at start and on `reload`, and keeps their stylesheet in <head>. */
export function useUserThemes() {
  const [list, setList] = useState<UserThemeList>({ themes: [], errors: [] });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setList(await listThemes());
    } catch (error) {
      setList({ themes: [], errors: [String(error)] });
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const style = document.getElementById(STYLE_ID) ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    style.textContent = themeCss(list.themes);
    document.head.appendChild(style);
  }, [list.themes]);

  const schemes = useMemo(() => userThemeSchemes(list.themes), [list.themes]);
  return { themes: list.themes, schemes, errors: list.errors, loaded, reload };
}
