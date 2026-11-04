import { useDialogFocus } from "@/components/app/useDialogFocus";
import {
  startTransition,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { House, Moon, Pin, Plus, PanelLeft, Puzzle, RefreshCw, Search, Settings, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BrandMark } from "@/components/app/BrandMark";
import { CommandPalette, type PaletteCommand } from "@/components/app/CommandPalette";
import { useFieldDirShortcut } from "@/hooks/useFieldDirShortcut";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAccent } from "@/hooks/useAccent";
import { useFonts } from "@/hooks/useFonts";
import { useUserThemes } from "@/hooks/useUserThemes";
import { buildInstallables, usePaletteListed } from "@/hooks/usePaletteInstallables";
import { refreshThemeUpdates, useThemeUpdateCount, useThemeUpdateSync } from "@/hooks/useThemeUpdates";
import { pruneToolIds, type CatalogTool } from "@/app/catalog";
import { INSTALLABLE_PLUGIN_IDS, INSTALLABLE_TOOLS, type InstallableTool } from "@/app/installableTools";
import { setToolHidden, useToolCatalog } from "@/app/useToolCatalog";
import { getReleaseNotes } from "@/data/releaseNotes";
import { OPEN_TABS_STORAGE_KEY, rememberInputsEnabled } from "@/hooks/usePersistedInput";
import { parseDeepLink } from "@/utils/deep-link";
import { buildToolManifest } from "@/utils/tool-manifest";
import { detectPastedContent, type PasteSuggestion } from "@/utils/clipboard-detect";
import { PasteSuggestions } from "@/components/app/PasteSuggestions";
import { PasteInstall } from "@/components/app/PasteInstall";
import { Sidebar } from "@/components/app/Sidebar";
import { SidebarFooter, StatusBar, ToolStripe } from "@/components/app/IdeChrome";
import { MAX_PINNED, PINNED_STORAGE_KEY, loadPinned, moveId, pinLimitText } from "@/app/pinned";
import { Home } from "@/components/app/Home";
import { LauncherHome } from "@/components/app/LauncherHome";
import { FirstRunWizard } from "@/components/app/FirstRunWizard";
import { finishFirstRun, startFirstRun, type FirstRun } from "@/app/firstRun";
import { TopTabs } from "@/components/app/TopTabs";
import { ToolHost } from "@/components/app/ToolHost";
import { notifyLocaleChanged, notifyThemeChanged, sendInputToPlugin } from "@/plugins/bridge";
import { onLocaleApplied, useLocale, useT } from "@/i18n";
import { categoryName, toolName } from "@/app/toolNames";
import { SendToProvider, type SendToApi } from "@/components/tools/SendToMenu";
import { pluginUpdates, setPluginEnabled, syncRepos } from "@/plugins/api";
import { refreshPlugins } from "@/plugins/usePlugins";
import { setPluginUpdates, usePluginUpdates } from "@/plugins/usePluginUpdates";
import { loadGlobalShortcut, saveGlobalShortcut, toAccelerator, type GlobalShortcut } from "@/utils/global-shortcut";
import { convertMarkdown } from "@/utils/markdown";
import {
  formatShortcutBinding,
  getDefaultShortcutBindings,
  loadStoredShortcutBindings,
  saveShortcutBindings,
  type ShortcutBindings,
} from "@/utils/shortcuts";
import {
  LAYOUTS,
  LAYOUT_STORAGE_KEY,
  OPEN_TOOLS_IN_MODES,
  OPEN_TOOLS_IN_STORAGE_KEY,
  SCHEME_STORAGE_KEY,
  SIDEBAR_CATEGORIES_STORAGE_KEY,
  SIDEBAR_CATEGORY_MODES,
  SYSTEM_THEME_QUERY,
  THEME_STORAGE_KEY,
  getStoredChoice,
  COLOR_SCHEMES,
  getStoredColorScheme,
  resolveColorScheme,
  getStoredThemePreference,
  getSystemDarkMode,
  resolveDarkMode,
  syncColorScheme,
  syncDarkClass,
} from "@/utils/theme";
import { SettingsPage } from "@/components/app/settings/SettingsPage";
import { updateNoticeLabel } from "@/components/app/settings/updateLabels";
import { PluginsPage } from "@/components/plugins/PluginsPage";
import { getDesktopBridge, installTheme, type UpdateState } from "@/lib/desktop";
import { isMobilePlatform } from "@/lib/platform";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileNav, PhoneHeader, type PhoneDestination } from "@/components/app/PhoneShell";

type AppView =
  | { kind: "home" }
  | { kind: "tool"; id: string }
  | { kind: "plugins"; tab: string; install?: boolean }
  | { kind: "settings"; section: string };

const HOME_VIEW: AppView = { kind: "home" };
const toolView = (tool: CatalogTool): AppView => ({ kind: "tool", id: tool.id });

const AUTO_UPDATE_STORAGE_KEY = "shard-auto-update";
const MAX_RECENT_TOOLS = 6;

const RECENT_TOOLS_STORAGE_KEY = "shard-recent-tools";

/** The tabs saved by the last session. Anything unreadable counts as none. */
function readSavedTabs(): { open: string[]; active: string | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_TABS_STORAGE_KEY) ?? "null");
    const open = Array.isArray(parsed?.open) ? parsed.open.filter((id: unknown): id is string => typeof id === "string").slice(0, 50) : [];
    return { open, active: typeof parsed?.active === "string" ? parsed.active : null };
  } catch {
    return { open: [], active: null };
  }
}
const WHATS_NEW_SEEN_STORAGE_KEY = "shard-whats-new-seen-version";

/** The string ids stored under `key` (duplicates dropped). Unreadable storage gives an empty list. */
function readStoredIds(key: string, what: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))] : [];
  } catch (error) {
    console.error(`Failed to load ${what}:`, error);
    return [];
  }
}

// parseDeepLink only calls has(): any tool id passes, so a link to a tool that is not loaded yet still parses.
const ANY_TOOL_ID: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

const CRUMB_KEYS = {
  general: "shell.crumb.general",
  appearance: "shell.crumb.appearance",
  tools: "shell.crumb.tools",
  plugins: "shell.crumb.plugins",
  shortcuts: "shell.crumb.shortcuts",
  about: "shell.crumb.about",
  browse: "shell.crumb.browse",
  installed: "shell.crumb.installed",
  themes: "shell.crumb.themes",
  repositories: "shell.crumb.repositories",
} as const;

const Shard = () => {
  const t = useT();
  const { locale } = useLocale();
  const bridge = getDesktopBridge();
  // The phone app has the native side (plugins, themes, deep links) but none of the desktop-only features:
  // updates, shortcuts, the tray, folders. `desktop` is the bridge only where those exist.
  const desktop = bridge && !isMobilePlatform(bridge.platform) ? bridge : null;
  const platform = bridge?.platform;
  const phone = useIsMobile(platform);
  const { tools: catalogTools, byId: toolById, ids: toolIds, categories, pluginsReady, pluginsFailed, pluginCount, installedIds } = useToolCatalog();
  const updates = usePluginUpdates();
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const [themePreference, setThemePreference] = useState(() =>
    getStoredThemePreference(typeof window !== "undefined" ? window.localStorage : undefined)
  );
  const [colorScheme, setColorScheme] = useState(() =>
    getStoredColorScheme(typeof window !== "undefined" ? window.localStorage : undefined)
  );
  const customThemes = useUserThemes();
  const [accent, setAccent] = useAccent();
  const fonts = useFonts();
  useFieldDirShortcut();
  // Installed themes whose repository lists a newer version count next to the plugin updates.
  useThemeUpdateSync(Boolean(bridge), customThemes.themes);
  const themeUpdateCount = useThemeUpdateCount();
  const activeScheme = resolveColorScheme(colorScheme, [...COLOR_SCHEMES, ...customThemes.schemes], customThemes.loaded);
  const [sidebarCategories, setSidebarCategories] = useState(() =>
    getStoredChoice(typeof window !== "undefined" ? window.localStorage : undefined, SIDEBAR_CATEGORIES_STORAGE_KEY, SIDEBAR_CATEGORY_MODES, "remember")
  );
  const [storedLayout, setLayout] = useState(() =>
    getStoredChoice(typeof window !== "undefined" ? window.localStorage : undefined, LAYOUT_STORAGE_KEY, LAYOUTS, phone ? "launcher" : "sidebar")
  );
  const [openToolsIn, setOpenToolsIn] = useState(() =>
    getStoredChoice(typeof window !== "undefined" ? window.localStorage : undefined, OPEN_TOOLS_IN_STORAGE_KEY, OPEN_TOOLS_IN_MODES, "new")
  );
  const [systemDarkMode, setSystemDarkMode] = useState(() =>
    getSystemDarkMode(typeof window !== "undefined" ? window.matchMedia.bind(window) : undefined)
  );
  const [view, setView] = useState<AppView>(HOME_VIEW);
  const [openTools, setOpenTools] = useState<CatalogTool[]>([]);
  // From the open tabs, not the live catalog, so the selection and its tab cannot disagree.
  const selectedTool = view.kind === "tool" ? openTools.find((tool) => tool.id === view.id) ?? null : null;
  // Ids come straight from storage. Plugin tools are not in the catalog until the installed plugins are read,
  // so they are checked against it once that has happened (see the prune effect below).
  const [pinned, setPinned] = useState<readonly string[]>(() => loadPinned(typeof window !== "undefined" ? window.localStorage : undefined));
  const [recentToolIds, setRecentToolIds] = useState<string[]>(() => readStoredIds(RECENT_TOOLS_STORAGE_KEY, "recent tools"));
  const [idsPruned, setIdsPruned] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  // Whether anything was saved before this start (an upgrade). Read in the first render, before the app writes its own keys.
  const [firstRun, setFirstRun] = useState<FirstRun>(null);
  const [seenWhatsNewVersion, setSeenWhatsNewVersion] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // A shortcut is being recorded in Settings: no shortcut may act, including the system-wide one.
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(() =>
    loadStoredShortcutBindings(
      platform,
      typeof window !== "undefined" ? window.localStorage : undefined,
    ),
  );
  const darkMode = resolveDarkMode(themePreference, systemDarkMode);
  const releaseNotes = useMemo(
    () => (appVersion ? getReleaseNotes(appVersion) : null),
    [appVersion]
  );
  const whatsNewHtml = useMemo(
    () => (releaseNotes ? convertMarkdown(releaseNotes.markdown) : ""),
    [releaseNotes]
  );
  const hasUnreadWhatsNew = Boolean(
    releaseNotes && seenWhatsNewVersion !== releaseNotes.version
  );

  // Drop stored ids that are not in the catalog, but only once the plugins are known: before that, every
  // plugin tool would look unknown. Once only, so hiding or disabling a tool later does not erase its pin.
  useEffect(() => {
    if (!pluginsReady || idsPruned) return;
    setPinned((previous) => pruneToolIds(previous, toolById));
    setRecentToolIds((previous) => pruneToolIds(previous, toolById));
    setIdsPruned(true);
  }, [pluginsReady, idsPruned, toolById]);

  // Reopen last session's tabs, once the plugins are known (a plugin tool is not in the catalog before that).
  // Ids that are gone are skipped. Saving waits for this, so the empty first render cannot erase them.
  // ponytail: if the plugins fail to load, nothing is restored or saved, so a later start still has the old tabs.
  const [tabsRestored, setTabsRestored] = useState(false);
  useEffect(() => {
    if (!pluginsReady || tabsRestored) return;
    const saved = rememberInputsEnabled() ? readSavedTabs() : { open: [], active: null };
    const restored = saved.open.map((id) => toolById.get(id)).filter((tool): tool is CatalogTool => Boolean(tool));
    if (restored.length) {
      setOpenTools((previous) => [...restored, ...previous.filter((entry) => !restored.some((tool) => tool.id === entry.id))]);
      const active = restored.find((tool) => tool.id === saved.active);
      // Only from Home: a deep link or a tool the user already opened wins.
      if (active) setView((current) => (current.kind === "home" ? toolView(active) : current));
    }
    setTabsRestored(true);
  }, [pluginsReady, tabsRestored, toolById]);
  useEffect(() => {
    if (!tabsRestored) return;
    try {
      if (!rememberInputsEnabled() || openTools.length === 0) localStorage.removeItem(OPEN_TABS_STORAGE_KEY);
      else localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify({ open: openTools.map((tool) => tool.id), active: view.kind === "tool" ? view.id : null }));
    } catch {
      // Storage blocked: tabs just aren't remembered.
    }
  }, [tabsRestored, openTools, view]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
      if (stored) {
        setSeenWhatsNewVersion(stored);
      }
    } catch (error) {
      console.error("Failed to load seen what's new version:", error);
    }
  }, []);

  // Save pinned tools to localStorage whenever they change. Not before the prune: storage still holds ids
  // that the catalog cannot vouch for yet. If the plugins cannot be read the prune never comes, and the
  // list is saved as it is (it keeps the plugin ids).
  useEffect(() => {
    if (!idsPruned && !pluginsFailed) return;
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned));
    } catch (error) {
      console.error("Failed to save pinned tools:", error);
    }
  }, [pinned, idsPruned, pluginsFailed]);

  useEffect(() => {
    if (!idsPruned && !pluginsFailed) return;
    try {
      localStorage.setItem(RECENT_TOOLS_STORAGE_KEY, JSON.stringify(recentToolIds));
    } catch (error) {
      console.error("Failed to save recent tools:", error);
    }
  }, [recentToolIds, idsPruned, pluginsFailed]);

  useEffect(() => {
    saveShortcutBindings(
      typeof window !== "undefined" ? window.localStorage : undefined,
      shortcutBindings,
    );
  }, [shortcutBindings]);

  useEffect(() => {
    syncDarkClass(document.documentElement, darkMode);
  }, [darkMode]);

  useEffect(() => {
    syncColorScheme(document.documentElement, activeScheme);
  }, [activeScheme]);

  // What the user chose is stored, not what shows: a theme that fails to load for a moment must not erase the choice.
  useEffect(() => {
    try {
      localStorage.setItem(SCHEME_STORAGE_KEY, colorScheme);
    } catch (error) {
      console.error("Failed to save color scheme:", error);
    }
  }, [colorScheme]);

  useEffect(() => {
    // Plugin frames get the new colors. This runs after the two effects above, so the root already has the class and scheme.
    notifyThemeChanged();
  }, [darkMode, activeScheme, customThemes.schemes, fonts.prefs.ui]);

  useEffect(() => {
    // The native window material follows the window appearance, not the page theme.
    void desktop?.setWindowTheme?.(themePreference === "system" ? null : themePreference);
  }, [desktop, themePreference]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch (error) {
      console.error("Failed to save theme preference:", error);
    }
  }, [themePreference]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_CATEGORIES_STORAGE_KEY, sidebarCategories);
    } catch (error) {
      console.error("Failed to save sidebar categories setting:", error);
    }
  }, [sidebarCategories]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, storedLayout);
    } catch (error) {
      console.error("Failed to save layout setting:", error);
    }
  }, [storedLayout]);
  // A phone honours the saved choice too: Launcher gets the bottom bar, Sidebar gets the sidebar as a drawer behind a menu button.
  // With nothing saved yet a phone starts on Launcher (a bottom bar suits a thumb); the first-run step and Settings change it.
  const layout = storedLayout;

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_TOOLS_IN_STORAGE_KEY, openToolsIn);
    } catch (error) {
      console.error("Failed to save open tools setting:", error);
    }
  }, [openToolsIn]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemDarkMode(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);

      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);

    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!bridge) {
      return undefined;
    }

    let cancelled = false;

    const loadAppMeta = async () => {
      try {
        // A phone has a version and no updater: its store updates it.
        const [version, currentUpdateState] = await Promise.all([
          bridge.getVersion(),
          desktop ? desktop.getUpdateState() : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setAppVersion(typeof version === "string" ? version : "");
          if (currentUpdateState && typeof currentUpdateState === "object") {
            setUpdateState(currentUpdateState as UpdateState);
          }
        }
      } catch (error) {
        console.error("Failed to load app metadata:", error);
      }
    };

    loadAppMeta();

    const unsubscribe = desktop
      ? desktop.onUpdateState((nextState) => {
          if (!cancelled && nextState && typeof nextState === "object") {
            setUpdateState(nextState as UpdateState);
          }
        })
      : () => {};

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, desktop]);

  useEffect(() => {
    if (!releaseNotes) {
      return;
    }

    if (seenWhatsNewVersion !== releaseNotes.version) {
      setShowWhatsNew(true);
    }
  }, [seenWhatsNewVersion, releaseNotes]);

  // The wizard, until it is finished. Needs the version, so it waits for it.
  useEffect(() => {
    if (!appVersion) return;
    try {
      setFirstRun(startFirstRun(window.localStorage, appVersion));
    } catch (error) {
      console.error("Failed to read first-run state:", error);
    }
  }, [appVersion]);

  const handleUpdateAction = async () => {
    if (!desktop) {
      return;
    }

    try {
      if (updateState.status === "available") {
        await desktop.downloadUpdate();
        return;
      }

      if (updateState.status === "downloaded") {
        await desktop.installUpdate();
        return;
      }

      await desktop.checkForUpdates();
    } catch (error) {
      console.error("Failed to run update action:", error);
      toast.error(t("shell.update.actionFailed"));
    }
  };

  const openWhatsNew = () => {
    if (releaseNotes) {
      setShowCommandPalette(false);
      setShowWhatsNew(true);
    }
  };

  const closeWhatsNew = () => {
    if (releaseNotes) {
      try {
        localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, releaseNotes.version);
      } catch (error) {
        console.error("Failed to save seen what's new version:", error);
      }
      setSeenWhatsNewVersion(releaseNotes.version);
    }

    setShowWhatsNew(false);
  };
  const releaseDialogRef = useDialogFocus(showWhatsNew, closeWhatsNew);


  const [paletteQuery, setPaletteQuery] = useState("");
  const openCommandPaletteWith = useCallback((query: string) => {
    setPaletteQuery(query);
    setShowCommandPalette(true);
  }, []);
  const openCommandPalette = useCallback(() => openCommandPaletteWith(""), [openCommandPaletteWith]);

  const closeCommandPalette = () => {
    setShowCommandPalette(false);
  };

  const updateShortcutBinding = (actionId: keyof ShortcutBindings, binding: ShortcutBindings[keyof ShortcutBindings]) => {
    setShortcutBindings((prev) => ({
      ...prev,
      [actionId]: binding,
    }));
  };

  const resetShortcutBindings = () => {
    setShortcutBindings(getDefaultShortcutBindings(platform));
    toast.success(t("shell.shortcuts.reset"));
  };

  const pinTool = (toolId: string): boolean => {
    if (pinned.includes(toolId)) return true;
    if (pinned.length >= MAX_PINNED) {
      toast.error(pinLimitText());
      return false;
    }
    setPinned([...pinned, toolId]);
    return true;
  };
  const unpinTool = (toolId: string) => setPinned((prev) => prev.filter((id) => id !== toolId));
  const togglePinned = (toolId: string) => (pinned.includes(toolId) ? unpinTool(toolId) : void pinTool(toolId));
  const movePinned = (toolId: string, targetId: string) => setPinned((prev) => moveId(prev, toolId, targetId));
  // A plugin installed from the picker is pinned when its install finishes, so the list is read at that time.
  const pinInstalledRef = useRef((_toolId: string) => {});
  pinInstalledRef.current = (toolId) => {
    if (pinned.includes(toolId)) return;
    if (pinned.length >= MAX_PINNED) toast.error(pinLimitText(), { description: t("shell.pinned.installedNotPinned") });
    else setPinned((prev) => (prev.includes(toolId) || prev.length >= MAX_PINNED ? prev : [...prev, toolId]));
  };

  const pinnedTools = useMemo(() => {
    return pinned
      .map((id) => toolById.get(id))
      .filter((tool): tool is CatalogTool => Boolean(tool));
  }, [pinned, toolById]);

  const recentTools = useMemo(() => {
    return recentToolIds
      .map((id) => toolById.get(id))
      .filter((tool): tool is CatalogTool => Boolean(tool));
  }, [recentToolIds, toolById]);

  const quickAccessTools = useMemo(() => {
    const hiddenToolIds = new Set([...recentToolIds, ...pinned]);

    return catalogTools.filter((tool) => !hiddenToolIds.has(tool.id)).slice(0, MAX_RECENT_TOOLS);
  }, [catalogTools, pinned, recentToolIds]);
  // Every built-in is hidden and no plugin is installed.
  const empty = pluginsReady && catalogTools.length === 0 && pluginCount === 0;
  // Shown in the sidebar footer until the update is dealt with. "Checking" and "unsupported" are not news.
  const updateNotice = updateNoticeLabel(updateState);
  const commandPaletteShortcutLabel = useMemo(
    () => formatShortcutBinding(shortcutBindings["open-command-palette"], platform),
    [platform, shortcutBindings],
  );

  const shortcutHandlers = useMemo(
    () => ({
      "open-command-palette": openCommandPalette,
      "go-home": () => selectTool(null),
      "toggle-sidebar": () => { if (layout === "sidebar") setSidebarOpen((previous) => !previous); },
      "open-favorite-1": () => {
        const tool = pinnedTools[0];
        if (tool) {
          selectTool(tool);
        }
      },
      "open-favorite-2": () => {
        const tool = pinnedTools[1];
        if (tool) {
          selectTool(tool);
        }
      },
      "open-favorite-3": () => {
        const tool = pinnedTools[2];
        if (tool) {
          selectTool(tool);
        }
      },
      "open-favorite-4": () => {
        const tool = pinnedTools[3];
        if (tool) {
          selectTool(tool);
        }
      },
      "open-favorite-5": () => {
        const tool = pinnedTools[4];
        if (tool) {
          selectTool(tool);
        }
      },
    }),
    [pinnedTools, layout, openCommandPalette],
  );

  useKeyboardShortcuts({
    bindings: shortcutBindings,
    handlers: shortcutHandlers,
    enabled: !showCommandPalette && !recordingShortcut && !showWhatsNew && firstRun !== "wizard",
  });

  const openSettings = (section = "general") => {
    setShowCommandPalette(false);
    if (window.innerWidth < 640) setSidebarOpen(false);
    setView({ kind: "settings", section });
  };

  const openPlugins = (tab: string, install = false) => {
    setShowCommandPalette(false);
    if (window.innerWidth < 640) setSidebarOpen(false);
    setView({ kind: "plugins", tab, install });
  };
  // The drop guard below lives for the whole session and must not go stale.
  const openPluginsRef = useRef(openPlugins);
  openPluginsRef.current = openPlugins;

  const checkPluginUpdates = async () => {
    setShowCommandPalette(false);
    try {
      // A repository that cannot be reached must not hide the updates already known.
      let failure: unknown = null;
      try {
        await syncRepos();
      } catch (error) {
        failure = error;
      }
      const found = await pluginUpdates();
      setPluginUpdates(found);
      if (failure) {
        toast.error(failure instanceof Error ? failure.message : String(failure));
      } else if (found.length === 0) {
        toast.success(t("shell.updates.allUpToDate"));
      } else {
        toast(t("shell.updates.available", { count: found.length }), {
          action: { label: t("shell.updates.review"), onClick: () => openPlugins("installed") },
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const checkPluginUpdatesRef = useRef(checkPluginUpdates);
  checkPluginUpdatesRef.current = checkPluginUpdates;

  const paletteCommands: PaletteCommand[] = [
    { id: "open-plugins", label: t("shell.palette.openPlugins"), icon: Puzzle, run: () => openPlugins("browse") },
    { id: "check-plugin-updates", label: t("shell.palette.checkUpdates"), icon: RefreshCw, run: () => void checkPluginUpdatesRef.current() },
  ];

  // selectTool is memoized into long-lived handlers (shortcuts, deep links), so it reads these from a ref.
  const replaceRef = useRef({ mode: openToolsIn, selected: view.kind === "tool" ? view.id : null });
  replaceRef.current = { mode: openToolsIn, selected: view.kind === "tool" ? view.id : null };

  const selectTool = (tool: CatalogTool | null) => {
    setShowCommandPalette(false);
    setSearchQuery("");
    toast.dismiss();

    startTransition(() => {
      setView(tool ? toolView(tool) : HOME_VIEW);
    });

    if (tool) {
      if (window.innerWidth < 640) setSidebarOpen(false);
      setOpenTools((previous) => {
        if (previous.some((entry) => entry.id === tool.id)) return previous;
        // "Current tab": the selected tool's tab is replaced. Home or Plugins has no tab to replace.
        const { mode, selected } = replaceRef.current;
        const replace = mode === "current" && selected ? previous.findIndex((entry) => entry.id === selected) : -1;
        return replace < 0 ? [...previous, tool] : previous.map((entry, index) => (index === replace ? tool : entry));
      });
      setRecentToolIds((prev) =>
        [tool.id, ...prev.filter((id) => id !== tool.id)].slice(0, MAX_RECENT_TOOLS)
      );
    }
  };

  // shard:// links from Raycast, Alfred, scripts, or a browser. The ref keeps the
  // listener on the latest handlers without subscribing again on every render.
  const deepLinkHandlerRef = useRef<(url: string) => void>(() => {});
  // A link to a plugin tool can arrive before the installed plugins are read. It waits and is tried again then.
  const pendingLinkRef = useRef<string | null>(null);
  deepLinkHandlerRef.current = (url: string) => {
    const action = parseDeepLink(url, toolIds);
    if (!action) {
      // Only a link to a tool can be a plugin that is not loaded yet.
      if (!pluginsReady && !pluginsFailed && parseDeepLink(url, ANY_TOOL_ID)?.type === "tool") pendingLinkRef.current = url;
      return;
    }
    setShowWhatsNew(false);
    if (action.type === "tool") selectTool(toolById.get(action.toolId) ?? null);
    else if (action.type === "search") openCommandPaletteWith(action.query);
    else selectTool(null);
  };
  useEffect(() => bridge?.onDeepLink?.((url) => deepLinkHandlerRef.current(url)), [bridge]);
  useEffect(() => {
    if (!pluginsReady || !pendingLinkRef.current) return;
    const url = pendingLinkRef.current;
    pendingLinkRef.current = null;
    deepLinkHandlerRef.current(url);
  }, [pluginsReady]);

  // Keep the tool list for launchers (the Raycast extension) in step with this version.
  useEffect(() => {
    if (appVersion) void desktop?.writeToolManifest?.(buildToolManifest(catalogTools, appVersion));
  }, [desktop, appVersion, catalogTools]);

  // System-wide "Show Shard" shortcut. Paused while a shortcut is being recorded, so recording
  // a new combination cannot trigger the old one.
  // The tray menu and the plugin frames are not React: tell them when the language changes (and once at start).
  useEffect(
    () =>
      onLocaleApplied(() => {
        void desktop?.setTrayLabels?.({ open: t("shell.tray.open"), search: t("shell.tray.search"), quit: t("shell.tray.quit") });
        notifyLocaleChanged();
      }),
    [desktop, t],
  );
  const [globalShortcut, setGlobalShortcut] = useState<GlobalShortcut>(() =>
    loadGlobalShortcut(typeof window !== "undefined" ? window.localStorage : undefined, platform),
  );
  const [globalShortcutError, setGlobalShortcutError] = useState<string | null>(null);
  const changeGlobalShortcut = useCallback((next: GlobalShortcut) => {
    setGlobalShortcut(next);
    saveGlobalShortcut(window.localStorage, next);
  }, []);
  useEffect(() => {
    if (!desktop?.setGlobalShortcut) return;
    const accelerator = recordingShortcut ? null : toAccelerator(globalShortcut, platform);
    let current = true;
    void desktop.setGlobalShortcut(accelerator).then((error) => {
      if (current && !recordingShortcut) setGlobalShortcutError(error);
    });
    return () => {
      current = false;
    };
  }, [desktop, globalShortcut, platform, recordingShortcut]);

  const openPaletteRef = useRef(() => {});
  openPaletteRef.current = () => {
    setShowWhatsNew(false);
    openCommandPalette();
  };
  useEffect(() => desktop?.onOpenCommandPalette?.(() => openPaletteRef.current()), [desktop]);

  // Paste outside a text field: suggest the tool that fits the text, then open it with the text
  // filled in. The app only sees what the user pastes; it never reads the clipboard on its own.
  const [pasted, setPasted] = useState<{ text: string; suggestions: PasteSuggestion[] } | null>(null);
  const pasteBlocked = showCommandPalette || recordingShortcut || showWhatsNew;
  // Official plugins that are not installed: a paste that fits one suggests "Install <tool>". Only known once
  // the installed plugins have been read, so a failed read never suggests a plugin that may be installed.
  const installableIds = useMemo<ReadonlySet<string>>(
    () => (pluginsReady && !pluginsFailed ? new Set([...INSTALLABLE_PLUGIN_IDS].filter((id) => !installedIds.has(id))) : new Set<string>()),
    [pluginsReady, pluginsFailed, installedIds],
  );
  // The plugin a paste suggestion is installing (`nonce` restarts the flow when the same tool is asked for again).
  // `text` is what the user pasted: it goes to the plugin once it is installed and opened.
  const [pasteInstall, setPasteInstall] = useState<{ tool: InstallableTool; nonce: number; text?: string } | null>(null);
  // "Install Nord" in the command palette: the plugins and themes the repositories list and the user does not have.
  const paletteListed = usePaletteListed(showCommandPalette);
  const paletteInstallables = useMemo(
    () =>
      buildInstallables(paletteListed, installedIds, new Set(customThemes.themes.map((theme) => theme.id)), {
        // The same flow as a paste suggestion: permission dialog, then install.
        installPlugin: (entry) => setPasteInstall((current) => ({ tool: { pluginId: entry.id, name: entry.name }, nonce: (current?.nonce ?? 0) + 1 })),
        installTheme: (entry) => {
          installTheme(entry.repo, entry.id).then(
            async () => {
              await customThemes.reload();
              void refreshThemeUpdates();
              toast.success(t("shell.theme.installed", { name: entry.name }), { action: { label: t("shell.theme.apply"), onClick: () => setColorScheme(entry.id) } });
            },
            (error) => toast.error(t("shell.theme.installFailed", { name: entry.name }), { description: error instanceof Error ? error.message : String(error) }),
          );
        },
      }),
    // `locale`: the rows carry translated text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paletteListed, installedIds, customThemes, locale],
  );
  useEffect(() => {
    if (pasteBlocked) return;
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const suggestions = detectPastedContent(text, toolIds, installableIds);
      if (suggestions.length === 0) return;
      event.preventDefault();
      setPasted({ text: text.trim(), suggestions });
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [pasteBlocked, toolIds, installableIds]);

  // The app decides where a dropped file lands. The Install dialog's zone is the only place a plugin zip is taken. A zone claims
  // its drop with preventDefault() (this runs after it, in the bubble phase). Any other file drop would make the webview open
  // the file and replace the app, with no way back.
  useEffect(() => {
    const isZip = (name: string) => /\.zip$/i.test(name);
    const hint = () =>
      toast(t("shell.drop.hint"), { action: { label: t("shell.drop.open"), onClick: () => openPluginsRef.current("browse", true) } });
    // Only files (and file:// links) are ours. Text dragged into a field is left alone.
    const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).some((type) => type === "Files" || type === "text/uri-list");
    const handleDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !event.dataTransfer || !isFileDrag(event)) return;
      event.preventDefault();
      if (Array.from(event.dataTransfer.files).some((file) => isZip(file.name))) hint();
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    // Linux takes drops natively: the page gets paths and the point, and a drop never reaches the handlers above.
    const stopNative = getDesktopBridge()?.onFileDrop?.((paths, x, y) => {
      const at = document.elementFromPoint(x, y);
      if (at?.closest("[data-drop-zone]") || at?.closest("[role='dialog']")) return;
      if (paths.some(isZip)) hint();
    });
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      stopNative?.();
    };
  }, [t]);

  const dismissPasted = useCallback(() => setPasted(null), []);
  // Opens a tool with `text` in its main input. Used by a paste suggestion and by another tool's "Send to…".
  const sendToTool = (toolId: string, text: string) => {
    const tool = toolById.get(toolId);
    if (!tool) return;
    selectTool(tool);
    if (tool.source === "plugin") {
      // A plugin's frame takes it at its handshake, so this works before the frame has loaded (see sendInputToPlugin).
      if (!sendInputToPlugin(tool.pluginId ?? tool.id, text)) toast.error(t("shell.sendTo.tooLarge"));
      return;
    }
    // Tools load lazily. Wait for the panel's main input, then fill it the way typing would.
    const started = Date.now();
    const fill = () => {
      // A textarea first: JSON Viewer has a JSONPath box above its input, and the text is not meant for that one.
      const panel = document.querySelector(`#panel-${tool.id}`);
      const field =
        panel?.querySelector<HTMLTextAreaElement>("textarea:not([readonly])") ?? panel?.querySelector<HTMLInputElement>('input[type="text"]:not([readonly])') ?? null;
      if (!field) {
        if (Date.now() - started < 3000) window.setTimeout(fill, 50);
        return;
      }
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
    };
    window.setTimeout(fill, 0);
  };
  // Long-lived callbacks (the install toast's Open button) call the latest one.
  const sendToToolRef = useRef(sendToTool);
  sendToToolRef.current = sendToTool;
  const sendToApi = useMemo<SendToApi>(
    () => ({
      send: (toolId, text) => sendToToolRef.current(toolId, text),
      // Installed tools only: an uninstalled one would need the install flow first.
      targets: (text) =>
        detectPastedContent(text, toolIds)
          .sort((a, b) => b.score - a.score)
          .flatMap((item) => {
            const tool = toolById.get(item.toolId);
            return tool ? [{ toolId: item.toolId, name: toolName(tool), what: item.label }] : [];
          }),
    }),
    [toolIds, toolById],
  );

  const openPastedIn = useCallback((toolId: string) => {
    const wantsInstall = pasted?.suggestions.find((item) => item.toolId === toolId)?.install;
    const text = pasted?.text ?? "";
    setPasted(null);
    if (wantsInstall) {
      // Not installed: the install flow of the Home banners (permission dialog, then install). The text waits in `pasteInstall`
      // and goes to the plugin when the user opens it from the "Installed" toast.
      const installable = INSTALLABLE_TOOLS.find((item) => item.pluginId === toolId);
      if (installable) setPasteInstall((current) => ({ tool: installable, nonce: (current?.nonce ?? 0) + 1, text }));
      return;
    }
    sendToToolRef.current(toolId, text);
  }, [pasted]);

  // Automatic updates: download in the background and install on quit. On by default.
  const [autoUpdate, setAutoUpdate] = useState(() => {
    try {
      return localStorage.getItem(AUTO_UPDATE_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    desktop?.setAutoUpdate?.(autoUpdate);
    try {
      localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, String(autoUpdate));
    } catch {
      // The choice still applies for this session.
    }
  }, [desktop, autoUpdate]);

  // Say once when an update has downloaded, with a way to restart now.
  const announcedUpdateRef = useRef<string | null>(null);
  const installUpdateRef = useRef(() => {});
  installUpdateRef.current = () => void desktop?.installUpdate();
  useEffect(() => {
    if (updateState.status !== "downloaded" || !updateState.version) return;
    if (announcedUpdateRef.current === updateState.version) return;
    announcedUpdateRef.current = updateState.version;
    toast(t("shell.update.readyTitle", { version: updateState.version }), {
      id: "update-ready",
      description: t("shell.update.readyBody"),
      duration: 20000,
      action: { label: t("shell.update.restartNow"), onClick: () => installUpdateRef.current() },
    });
  }, [t, updateState.status, updateState.version]);

  // Close several tabs at once. When the selected tab closes, select `fallback` or the nearest tab left open.
  const closeTools = useCallback((ids: ReadonlySet<string>, fallback?: CatalogTool) => {
    const remaining = openTools.filter((entry) => !ids.has(entry.id));
    setOpenTools(remaining);
    if (selectedTool && ids.has(selectedTool.id)) {
      const index = openTools.findIndex((entry) => entry.id === selectedTool.id);
      const after = openTools.slice(index + 1).find((entry) => !ids.has(entry.id));
      const before = openTools.slice(0, index).reverse().find((entry) => !ids.has(entry.id));
      const next = (fallback && !ids.has(fallback.id) ? fallback : after ?? before) ?? null;
      setView(next ? toolView(next) : HOME_VIEW);
      requestAnimationFrame(() => document.getElementById(next ? `tab-${next.id}` : "workspace-home")?.focus());
    }
  }, [openTools, selectedTool]);
  const closeTool = useCallback((tool: CatalogTool) => closeTools(new Set([tool.id])), [closeTools]);
  // From the tab menu. A built-in tool is hidden (its tab closes by itself, see below) and a plugin is turned off; both come back from Settings.
  const hideTool = useCallback((tool: CatalogTool) => {
    if (tool.pluginId) {
      setPluginEnabled(tool.pluginId, false).then(
        () => Promise.allSettled([refreshPlugins()]).then(() => toast.success(t("shell.hide.pluginOff", { name: toolName(tool) }), { description: t("shell.hide.pluginOffHint"), action: { label: t("shell.toast.undo"), onClick: () => void setPluginEnabled(tool.pluginId!, true).then(() => refreshPlugins()) } })),
        (error) => toast.error(t("shell.hide.pluginOffFailed", { name: toolName(tool) }), { description: error instanceof Error ? error.message : String(error) }),
      );
      return;
    }
    setToolHidden(tool.id, true);
    toast.success(t("shell.hide.toolHidden", { name: toolName(tool) }), { description: t("shell.hide.toolHiddenHint"), action: { label: t("shell.toast.undo"), onClick: () => setToolHidden(tool.id, false) } });
  }, [t]);

  // A tool that was hidden (or whose plugin was turned off) while its tab was open: close the tab.
  useEffect(() => {
    if (!pluginsReady) return;
    const gone = new Set(openTools.filter((tool) => !toolIds.has(tool.id)).map((tool) => tool.id));
    if (gone.size) closeTools(gone);
  }, [pluginsReady, toolIds, openTools, closeTools]);

  useEffect(() => {
    // Browser previews retain the browser's own tab/window shortcuts.
    if (!desktop || showCommandPalette || recordingShortcut || showWhatsNew) return;
    const handleWorkspaceKeys = (event: KeyboardEvent) => {
      if (event.altKey || event.defaultPrevented || event.isComposing) return;
      const command = platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (command && !event.shiftKey && event.key.toLowerCase() === "w" && selectedTool) {
        event.preventDefault();
        closeTool(selectedTool);
      } else if (event.ctrlKey && !event.metaKey && event.key === "Tab" && openTools.length) {
        event.preventDefault();
        const index = openTools.findIndex((tool) => tool.id === selectedTool?.id);
        const next = openTools[(index + (event.shiftKey ? -1 : 1) + openTools.length) % openTools.length];
        setView(toolView(next));
        document.getElementById(`tab-${next.id}`)?.focus();
      }
    };
    window.addEventListener("keydown", handleWorkspaceKeys);
    return () => window.removeEventListener("keydown", handleWorkspaceKeys);
  }, [desktop, platform, selectedTool, openTools, closeTool, showCommandPalette, recordingShortcut, showWhatsNew]);

  // The install toast's "Open" can be clicked after the wizard is gone, so it goes through a ref that is always current.
  const openPluginRef = useRef((_id: string) => {});
  openPluginRef.current = (id) => {
    if (firstRun === "wizard") finishWizard();
    const tool = toolById.get(id);
    if (tool) selectTool(tool);
  };
  const finishWizard = () => {
    finishFirstRun(window.localStorage);
    setFirstRun(null);
    // A new user has no use for the release notes of the version they installed.
    closeWhatsNew();
  };

  if (firstRun === "wizard") {
    return (
      <FirstRunWizard
        tools={catalogTools}
        pinned={pinned}
        platform={platform}
        layout={layout}
        onLayout={setLayout}
        preference={themePreference}
        onPreference={setThemePreference}
        onPin={pinTool}
        onUnpin={unpinTool}
        onPinInstalled={(id) => pinInstalledRef.current(id)}
        onOpenPlugin={(id) => openPluginRef.current(id)}
        onFinish={finishWizard}
      />
    );
  }

  const phoneDestination: PhoneDestination = selectedTool ? "tool" : view.kind === "plugins" ? "plugins" : view.kind === "settings" ? "settings" : "home";
  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const crumbName = (id: string) => (id in CRUMB_KEYS ? t(CRUMB_KEYS[id as keyof typeof CRUMB_KEYS]) : capitalize(id));
  const crumbs = selectedTool ? ["Shard", categoryName(selectedTool.category), toolName(selectedTool)]
    : view.kind === "plugins" ? ["Shard", t("shell.stripe.plugins"), crumbName(view.tab)]
    : view.kind === "settings" ? ["Shard", t("shell.stripe.settings"), crumbName(view.section)]
    : ["Shard", t("shell.sidebar.home")];
  const destinations = {
    pluginsOpen: view.kind === "plugins",
    onOpenPlugins: () => openPlugins("browse"),
    updateCount: updates.length + themeUpdateCount,
    settingsOpen: view.kind === "settings",
    onOpenSettings: () => openSettings(),
  };
  const statusInfo = {
    version: desktop ? (appVersion ? `v${appVersion}` : t("shell.status.loading")) : t("shell.status.browserPreview"),
    updateNotice,
    onUpdateNotice: () => openSettings("general"),
    hasReleaseNotes: Boolean(releaseNotes),
    hasUnreadWhatsNew,
    onWhatsNew: openWhatsNew,
  };
  const sidebarFooter = <SidebarFooter {...destinations} {...statusInfo} />;
  const sidebarEl = layout === "sidebar" && <Sidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedTool?.id ?? null}
        tools={catalogTools}
        categories={categories}
        pinned={pinned}
        pinnedTools={pinnedTools}
        onSelect={selectTool}
        onTogglePinned={togglePinned}
        onOpenPalette={openCommandPalette}
        paletteShortcutLabel={commandPaletteShortcutLabel}
        onOpenPlugins={() => openPlugins("browse")}
        footer={phone ? sidebarFooter : undefined}
        categoryMode={sidebarCategories}
        empty={empty}
      />;

  return (
    <SendToProvider value={sendToApi}>
    <div data-platform={platform} data-phone={phone || undefined} data-sidebar-open={layout === "sidebar" && sidebarOpen} data-layout={layout} className="workspace h-screen overflow-hidden bg-background flex">
      {phone ? (
        <>
          {sidebarEl}
          <main className="flex-1 min-h-0 flex flex-col min-w-0">
              <PhoneHeader
            destination={phoneDestination}
            title={selectedTool ? toolName(selectedTool) : view.kind === "plugins" ? t("shell.stripe.plugins") : view.kind === "settings" ? t("shell.stripe.settings") : "Shard"}
            onBack={() => setView(HOME_VIEW)}
            onMenu={layout === "sidebar" ? () => setSidebarOpen(!sidebarOpen) : undefined}
            onSearch={openCommandPalette}
            tool={selectedTool}
            pinned={selectedTool ? pinned.includes(selectedTool.id) : false}
            onTogglePin={() => selectedTool && togglePinned(selectedTool.id)}
            openTools={openTools}
            onSelectTool={selectTool}
            onCloseTool={closeTool}
          />

          {/* Content */}
          <div className={`workspace-content ${!selectedTool && view.kind !== "plugins" && view.kind !== "settings" ? "is-home" : ""}`}>
            {view.kind === "settings" ? (
              <SettingsPage
                section={view.section}
                onSection={(section) => setView({ kind: "settings", section })}
                preference={themePreference}
                onPreference={setThemePreference}
                scheme={activeScheme}
                onScheme={setColorScheme}
                accent={accent}
                onAccent={setAccent}
                fonts={fonts}
                customThemes={bridge ? customThemes : undefined}
                dark={darkMode}
                layout={layout}
                onLayout={setLayout}
                sidebarCategories={sidebarCategories}
                onSidebarCategories={setSidebarCategories}
                openToolsIn={openToolsIn}
                onOpenToolsIn={setOpenToolsIn}
                platform={platform}
                isDesktop={Boolean(desktop)}
                hasNative={Boolean(bridge)}
                appVersion={appVersion}
                updateState={updateState}
                onUpdateAction={handleUpdateAction}
                autoUpdate={autoUpdate}
                onAutoUpdateChange={setAutoUpdate}
                globalShortcut={desktop?.setGlobalShortcut ? globalShortcut : undefined}
                globalShortcutError={globalShortcutError}
                onChangeGlobalShortcut={changeGlobalShortcut}
                shortcutBindings={shortcutBindings}
                onUpdateShortcut={updateShortcutBinding}
                onResetShortcuts={resetShortcutBindings}
                onRecordingShortcut={setRecordingShortcut}
                recordingPaused={showCommandPalette || showWhatsNew}
                onOpenPlugins={(tab) => openPlugins(tab)}
                onCheckPluginUpdates={() => void checkPluginUpdates()}
                hasReleaseNotes={Boolean(releaseNotes)}
                onWhatsNew={openWhatsNew}
              />
            ) : view.kind === "plugins" ? (
              <PluginsPage variant={layout === "launcher" || phone ? "cards" : "list"} customThemes={bridge ? customThemes : undefined} themeApply={{ scheme: activeScheme, onScheme: setColorScheme, dark: darkMode }} startInstall={view.install} tab={view.tab} onTabChange={(tab) => setView({ kind: "plugins", tab })} onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }} />
            ) : !selectedTool && layout === "launcher" ? (
              <LauncherHome
                tools={catalogTools}
                categories={categories}
                pinned={pinned}
                pinnedTools={pinnedTools}
                onPin={pinTool}
                onUnpin={unpinTool}
                onMovePinned={movePinned}
                onPinInstalled={(id) => pinInstalledRef.current(id)}
                onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }}
                platform={platform}
                paletteShortcutLabel={commandPaletteShortcutLabel}
                onSelect={selectTool}
                onOpenPalette={openCommandPalette}
                updates={updates}
                onReviewUpdates={() => openPlugins("installed")}
                empty={empty}
                onBrowsePlugins={() => openPlugins("browse")}
                onInstallFromFile={() => openPlugins("browse", true)}
              />
            ) : !selectedTool ? (
              <Home
                recentTools={recentTools}
                tools={catalogTools}
                pinned={pinned}
                pinnedTools={pinnedTools}
                onPin={pinTool}
                onUnpin={unpinTool}
                onMovePinned={movePinned}
                onPinInstalled={(id) => pinInstalledRef.current(id)}
                onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }}
                quickAccessTools={quickAccessTools}
                platform={platform}
                paletteShortcutLabel={commandPaletteShortcutLabel}
                onSelect={selectTool}
                onOpenPalette={openCommandPalette}
                updates={updates}
                onReviewUpdates={() => openPlugins("installed")}
                empty={empty}
                onBrowsePlugins={() => openPlugins("browse")}
                onInstallFromFile={() => openPlugins("browse", true)}
              />
            ) : null}
            <ToolHost tools={openTools} selectedId={selectedTool?.id ?? null} />
          </div>
          </main>
          {phone && layout === "launcher" && (
            <MobileNav
              destination={phoneDestination}
              onHome={() => setView(HOME_VIEW)}
              onSearch={openCommandPalette}
              onPlugins={() => openPlugins("browse")}
              onSettings={() => openSettings()}
              badge={updates.length + themeUpdateCount}
            />
          )}
        </>
      ) : (
        <>
          {layout === "launcher" ? (
                    <header data-tauri-drag-region className="workspace-titlebar launcher-titlebar">
                      <div data-tauri-drag-region className="titlebar-brand">
                        <BrandMark className="h-[18px] w-[18px]" />
                        <span>Shard</span>
                      </div>
                      <div className="launcher-tabs" role="presentation">
                        <button type="button" className="workspace-tab launcher-home-tab" aria-current={view.kind === "home" ? "page" : undefined} onClick={() => setView(HOME_VIEW)}>
                          <House size={15} aria-hidden="true" />
                          <span>{t("shell.sidebar.home")}</span>
                        </button>
                        <TopTabs tools={openTools} selectedId={selectedTool?.id ?? null} onSelect={selectTool} onClose={closeTool} onCloseMany={closeTools} onHide={hideTool} />
                      </div>
                      <button type="button" className="chrome-button" aria-label={t("shell.titlebar.openTool")} title={t("shell.titlebar.openTool")} onClick={openCommandPalette}><Plus size={16} /></button>
                      <div className="flex min-w-0 flex-1 justify-center">
                        <button type="button" className="launcher-search h-8 w-[360px] max-w-full" onClick={openCommandPalette}>
                          <Search size={15} aria-hidden="true" />
                          <span className="flex-1 truncate text-start">{t("shell.titlebar.find")}</span>
                          <kbd>{commandPaletteShortcutLabel}</kbd>
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {selectedTool && <button type="button" className="chrome-button" aria-label={pinned.includes(selectedTool.id) ? t("shell.sidebar.unpinFromHome") : t("shell.sidebar.pinToHome")} onClick={() => togglePinned(selectedTool.id)}><Pin size={15} className={pinned.includes(selectedTool.id) ? "fill-current text-primary" : ""} /></button>}
                        <button type="button" className="chrome-button relative" title={t("shell.stripe.plugins")} aria-current={view.kind === "plugins" ? "page" : undefined} onClick={() => openPlugins("browse")}>
                          <Puzzle size={16} aria-hidden="true" />
                          <span className="sr-only">{t("shell.stripe.plugins")}</span>
                          {updates.length + themeUpdateCount > 0 && <span className="launcher-badge" title={t("shell.stripe.updatesBadge", { count: updates.length + themeUpdateCount })}>{updates.length + themeUpdateCount}</span>}
                        </button>
                        <button type="button" className="chrome-button" aria-label={t("shell.stripe.settings")} title={t("shell.stripe.settings")} aria-current={view.kind === "settings" ? "page" : undefined} onClick={() => openSettings()}><Settings size={16} aria-hidden="true" /></button>
                        <button type="button" className="chrome-button" aria-label={darkMode ? t("shell.titlebar.toLight") : t("shell.titlebar.toDark")} title={darkMode ? t("shell.titlebar.toLight") : t("shell.titlebar.toDark")} onClick={() => setThemePreference(darkMode ? "light" : "dark")}>
                          {darkMode ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                        </button>
                      </div>
                    </header>
          ) : (
            <header data-tauri-drag-region className="workspace-titlebar">
              <button type="button" className="chrome-button" aria-label={t("shell.titlebar.toggleSidebar")} onClick={() => setSidebarOpen(!sidebarOpen)}><PanelLeft size={16} /></button>
              <div data-tauri-drag-region className="titlebar-brand">
                <BrandMark className="h-[18px] w-[18px]" />
                <span>Shard</span>
              </div>
              <div data-tauri-drag-region className="titlebar-spacer" />
              <div className="flex shrink-0 items-center gap-1">
                {selectedTool && <button type="button" className="chrome-button" aria-label={pinned.includes(selectedTool.id) ? t("shell.sidebar.unpinFromHome") : t("shell.sidebar.pinToHome")} onClick={() => togglePinned(selectedTool.id)}><Pin size={15} className={pinned.includes(selectedTool.id) ? "fill-current text-primary" : ""} /></button>}
                <button type="button" className="chrome-button" aria-label={darkMode ? t("shell.titlebar.toLight") : t("shell.titlebar.toDark")} title={darkMode ? t("shell.titlebar.toLight") : t("shell.titlebar.toDark")} onClick={() => setThemePreference(darkMode ? "light" : "dark")}>
                  {darkMode ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                </button>
              </div>
            </header>
          )}
          <div className="workspace-body">
            {layout === "sidebar" && <ToolStripe sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} {...destinations} />}
            {sidebarEl}
            <main className="flex-1 min-h-0 flex flex-col min-w-0">
              {layout === "sidebar" && (
                <div className="workspace-tab-row">
                  <TopTabs tools={openTools} selectedId={selectedTool?.id ?? null} onSelect={selectTool} onClose={closeTool} onCloseMany={closeTools} onHide={hideTool} />
                  <button type="button" className="chrome-button" aria-label={t("shell.titlebar.openTool")} title={t("shell.titlebar.openTool")} onClick={openCommandPalette}><Plus size={16} /></button>
                </div>
              )}

            {/* Content */}
            <div className={`workspace-content ${!selectedTool && view.kind !== "plugins" && view.kind !== "settings" ? "is-home" : ""}`}>
              {view.kind === "settings" ? (
                <SettingsPage
                  section={view.section}
                  onSection={(section) => setView({ kind: "settings", section })}
                  preference={themePreference}
                  onPreference={setThemePreference}
                  scheme={activeScheme}
                  onScheme={setColorScheme}
                  accent={accent}
                  onAccent={setAccent}
                fonts={fonts}
                  customThemes={bridge ? customThemes : undefined}
                  dark={darkMode}
                  layout={layout}
                  onLayout={setLayout}
                  sidebarCategories={sidebarCategories}
                  onSidebarCategories={setSidebarCategories}
                  openToolsIn={openToolsIn}
                  onOpenToolsIn={setOpenToolsIn}
                  platform={platform}
                  isDesktop={Boolean(desktop)}
                  hasNative={Boolean(bridge)}
                  appVersion={appVersion}
                  updateState={updateState}
                  onUpdateAction={handleUpdateAction}
                  autoUpdate={autoUpdate}
                  onAutoUpdateChange={setAutoUpdate}
                  globalShortcut={desktop?.setGlobalShortcut ? globalShortcut : undefined}
                  globalShortcutError={globalShortcutError}
                  onChangeGlobalShortcut={changeGlobalShortcut}
                  shortcutBindings={shortcutBindings}
                  onUpdateShortcut={updateShortcutBinding}
                  onResetShortcuts={resetShortcutBindings}
                  onRecordingShortcut={setRecordingShortcut}
                  recordingPaused={showCommandPalette || showWhatsNew}
                  onOpenPlugins={(tab) => openPlugins(tab)}
                  onCheckPluginUpdates={() => void checkPluginUpdates()}
                  hasReleaseNotes={Boolean(releaseNotes)}
                  onWhatsNew={openWhatsNew}
                />
              ) : view.kind === "plugins" ? (
                <PluginsPage variant={layout === "launcher" || phone ? "cards" : "list"} customThemes={bridge ? customThemes : undefined} themeApply={{ scheme: activeScheme, onScheme: setColorScheme, dark: darkMode }} startInstall={view.install} tab={view.tab} onTabChange={(tab) => setView({ kind: "plugins", tab })} onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }} />
              ) : !selectedTool && layout === "launcher" ? (
                <LauncherHome
                  tools={catalogTools}
                  categories={categories}
                  pinned={pinned}
                  pinnedTools={pinnedTools}
                  onPin={pinTool}
                  onUnpin={unpinTool}
                  onMovePinned={movePinned}
                  onPinInstalled={(id) => pinInstalledRef.current(id)}
                  onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }}
                  platform={platform}
                  paletteShortcutLabel={commandPaletteShortcutLabel}
                  onSelect={selectTool}
                  onOpenPalette={openCommandPalette}
                  updates={updates}
                  onReviewUpdates={() => openPlugins("installed")}
                  empty={empty}
                  onBrowsePlugins={() => openPlugins("browse")}
                  onInstallFromFile={() => openPlugins("browse", true)}
                />
              ) : !selectedTool ? (
                <Home
                  recentTools={recentTools}
                  tools={catalogTools}
                  pinned={pinned}
                  pinnedTools={pinnedTools}
                  onPin={pinTool}
                  onUnpin={unpinTool}
                  onMovePinned={movePinned}
                  onPinInstalled={(id) => pinInstalledRef.current(id)}
                  onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }}
                  quickAccessTools={quickAccessTools}
                  platform={platform}
                  paletteShortcutLabel={commandPaletteShortcutLabel}
                  onSelect={selectTool}
                  onOpenPalette={openCommandPalette}
                  updates={updates}
                  onReviewUpdates={() => openPlugins("installed")}
                  empty={empty}
                  onBrowsePlugins={() => openPlugins("browse")}
                  onInstallFromFile={() => openPlugins("browse", true)}
                />
              ) : null}
              <ToolHost tools={openTools} selectedId={selectedTool?.id ?? null} />
            </div>
            </main>
          </div>
          <StatusBar crumbs={crumbs} {...statusInfo} />
        </>
      )}

      {pasted && (
        <PasteSuggestions
          suggestions={pasted.suggestions}
          toolName={(toolId) => { const tool = toolById.get(toolId); return tool ? toolName(tool) : INSTALLABLE_TOOLS.find((item) => item.pluginId === toolId)?.name ?? toolId; }}
          onOpen={openPastedIn}
          onDismiss={dismissPasted}
        />
      )}
      {pasteInstall && (
        <PasteInstall
          key={pasteInstall.nonce}
          tool={pasteInstall.tool}
          onOpenPlugin={(id) => {
            openPluginRef.current(id);
            if (pasteInstall.text) sendToToolRef.current(id, pasteInstall.text);
          }}
          onDone={() => setPasteInstall(null)}
        />
      )}
      <CommandPalette
        open={showCommandPalette}
        tools={catalogTools}
        pinned={pinned}
        recents={recentToolIds}
        onClose={closeCommandPalette}
        onSelectTool={selectTool}
        commands={paletteCommands}
        installables={paletteInstallables}
        initialQuery={paletteQuery}
      />

      {showWhatsNew && releaseNotes && (
        <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            ref={releaseDialogRef}
            aria-labelledby="whats-new-title"
            className="modal-surface release-dialog w-full max-w-xl"
          >
            <div className="modal-header flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 id="whats-new-title" className={`text-xl font-semibold text-foreground`}>
                  {releaseNotes.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeWhatsNew}
                className={`rounded-md p-1 hover:bg-accent text-muted-foreground transition-colors hover:text-foreground`}
                aria-label={t("shell.whatsNew.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className={`modal-body release-body min-h-0 overflow-y-auto px-6 py-4 prose prose-sm prose-neutral max-w-none text-sm dark:prose-invert prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-blockquote:text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:tracking-wide [&_h2]:text-foreground [&_p]:my-1 [&_p]:text-sm [&_p]:leading-5 [&_ul]:my-1 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5 [&_li]:my-0.5 [&_li]:ps-0.5 [&_li]:text-sm [&_li]:leading-5 [&_li::marker]:text-primary text-muted-foreground`}
              dangerouslySetInnerHTML={{ __html: whatsNewHtml }}
            />

            <div className="modal-footer flex justify-end">
              <Button type="button" onClick={closeWhatsNew}>
                {t("shell.whatsNew.gotIt")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </SendToProvider>
  );
};

export default Shard;
