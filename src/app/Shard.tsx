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
import { CommandPalette, type PaletteCommand } from "@/components/app/CommandPalette";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useUserThemes } from "@/hooks/useUserThemes";
import { pruneToolIds, type CatalogTool } from "@/app/catalog";
import { PORTED_PLUGIN_IDS, PORTED_TOOLS, migrateToolIds, portedToOffer, type PortedTool } from "@/app/legacyMigration";
import { useToolCatalog } from "@/app/useToolCatalog";
import { getReleaseNotes } from "@/data/releaseNotes";
import { parseDeepLink } from "@/utils/deep-link";
import { buildToolManifest } from "@/utils/tool-manifest";
import { detectPastedContent, type PasteSuggestion } from "@/utils/clipboard-detect";
import { PasteSuggestions } from "@/components/app/PasteSuggestions";
import { PortedToolInstall } from "@/components/app/PortedToolBanners";
import { Sidebar } from "@/components/app/Sidebar";
import { MAX_PINNED, PINNED_STORAGE_KEY, loadPinned, moveId, pinLimitMessage } from "@/app/pinned";
import { Home } from "@/components/app/Home";
import { LauncherHome } from "@/components/app/LauncherHome";
import { FirstRunWizard } from "@/components/app/FirstRunWizard";
import { dismissPluginsIntro, finishFirstRun, hadStoredState, startFirstRun, type FirstRun } from "@/app/firstRun";
import { TopTabs } from "@/components/app/TopTabs";
import { ToolHost } from "@/components/app/ToolHost";
import { notifyThemeChanged } from "@/plugins/bridge";
import { pluginUpdates, syncRepos } from "@/plugins/api";
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
import { getDesktopBridge, type UpdateState } from "@/lib/desktop";

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

const Shard = () => {
  const desktop = getDesktopBridge();
  const platform = desktop?.platform;
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
  const activeScheme = resolveColorScheme(colorScheme, [...COLOR_SCHEMES, ...customThemes.schemes], customThemes.loaded);
  const [sidebarCategories, setSidebarCategories] = useState(() =>
    getStoredChoice(typeof window !== "undefined" ? window.localStorage : undefined, SIDEBAR_CATEGORIES_STORAGE_KEY, SIDEBAR_CATEGORY_MODES, "remember")
  );
  const [layout, setLayout] = useState(() =>
    getStoredChoice(typeof window !== "undefined" ? window.localStorage : undefined, LAYOUT_STORAGE_KEY, LAYOUTS, "sidebar")
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
  const [existingUser] = useState(() => hadStoredState(typeof window !== "undefined" ? window.localStorage : undefined));
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
    // The ported tools keep their slots while their plugins are not installed (they show up as "X is now a plugin" on Home).
    setPinned((previous) => pruneToolIds(migrateToolIds(previous), toolById, PORTED_PLUGIN_IDS));
    setRecentToolIds((previous) => pruneToolIds(migrateToolIds(previous), toolById, PORTED_PLUGIN_IDS));
    setIdsPruned(true);
  }, [pluginsReady, idsPruned, toolById]);

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
    try {
      localStorage.setItem(SCHEME_STORAGE_KEY, activeScheme);
    } catch (error) {
      console.error("Failed to save color scheme:", error);
    }
  }, [activeScheme]);

  useEffect(() => {
    // Plugin frames get the new colors. This runs after the two effects above, so the root already has the class and scheme.
    notifyThemeChanged();
  }, [darkMode, activeScheme, customThemes.schemes]);

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
      localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
    } catch (error) {
      console.error("Failed to save layout setting:", error);
    }
  }, [layout]);

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
    if (!desktop) {
      return undefined;
    }

    let cancelled = false;

    const loadAppMeta = async () => {
      try {
        const [version, currentUpdateState] = await Promise.all([
          desktop.getVersion(),
          desktop.getUpdateState(),
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

    const unsubscribe = desktop.onUpdateState((nextState) => {
      if (!cancelled && nextState && typeof nextState === "object") {
        setUpdateState(nextState as UpdateState);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktop]);

  useEffect(() => {
    if (!releaseNotes) {
      return;
    }

    if (seenWhatsNewVersion !== releaseNotes.version) {
      setShowWhatsNew(true);
    }
  }, [seenWhatsNewVersion, releaseNotes]);

  // The wizard (new user) or the "Plugins are here" banner (upgrade) from the first release. Needs the version, so it waits for it.
  useEffect(() => {
    if (!appVersion) return;
    try {
      setFirstRun(startFirstRun(window.localStorage, appVersion, existingUser));
    } catch (error) {
      console.error("Failed to read first-run state:", error);
    }
  }, [appVersion, existingUser]);

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
      toast.error("Unable to complete the update action.");
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
  const openCommandPaletteWith = (query: string) => {
    setPaletteQuery(query);
    setShowCommandPalette(true);
  };
  const openCommandPalette = () => openCommandPaletteWith("");

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
    toast.success("Keyboard shortcuts reset to defaults.");
  };

  const pinTool = (toolId: string): boolean => {
    if (pinned.includes(toolId)) return true;
    if (pinned.length >= MAX_PINNED) {
      toast.error(pinLimitMessage);
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
    if (pinned.length >= MAX_PINNED) toast.error(pinLimitMessage, { description: "The plugin is installed but not pinned." });
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
  // Tools that became plugins, pinned or used before, and not installed yet.
  const portedOffers = useMemo(
    () => (idsPruned ? portedToOffer(new Set([...pinned, ...recentToolIds]), installedIds) : []),
    [idsPruned, pinned, recentToolIds, installedIds],
  );
  // The user does not want the ported tool back: its pin and recent entry go.
  const dismissPorted = (id: string) => {
    setPinned((previous) => previous.filter((item) => item !== id));
    setRecentToolIds((previous) => previous.filter((item) => item !== id));
  };
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
    [pinnedTools, layout],
  );

  useKeyboardShortcuts({
    bindings: shortcutBindings,
    handlers: shortcutHandlers,
    enabled: !showCommandPalette && !recordingShortcut && !showWhatsNew && firstRun !== "wizard",
  });

  const openSettings = (section = "appearance") => {
    setShowCommandPalette(false);
    if (window.innerWidth < 640) setSidebarOpen(false);
    setView({ kind: "settings", section });
  };

  const openPlugins = (tab: string, install = false) => {
    setShowCommandPalette(false);
    if (window.innerWidth < 640) setSidebarOpen(false);
    setView({ kind: "plugins", tab, install });
  };

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
        toast.success("All plugins are up to date.");
      } else {
        toast(`${found.length} plugin ${found.length === 1 ? "update is" : "updates are"} available.`, {
          action: { label: "Review", onClick: () => openPlugins("installed") },
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const checkPluginUpdatesRef = useRef(checkPluginUpdates);
  checkPluginUpdatesRef.current = checkPluginUpdates;

  const paletteCommands: PaletteCommand[] = [
    { id: "open-plugins", label: "Open Plugins", icon: Puzzle, run: () => openPlugins("browse") },
    { id: "check-plugin-updates", label: "Check for plugin updates", icon: RefreshCw, run: () => void checkPluginUpdatesRef.current() },
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
  useEffect(() => desktop?.onDeepLink?.((url) => deepLinkHandlerRef.current(url)), [desktop]);
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
  // Tools that became plugins and are not installed: a paste that fits one suggests "Install <tool>". Only known once
  // the installed plugins have been read, so a failed read never suggests a plugin that may be installed.
  const installableIds = useMemo<ReadonlySet<string>>(
    () => (pluginsReady && !pluginsFailed ? new Set([...PORTED_PLUGIN_IDS].filter((id) => !installedIds.has(id))) : new Set<string>()),
    [pluginsReady, pluginsFailed, installedIds],
  );
  // The ported tool a paste suggestion is installing (`nonce` restarts the flow when the same tool is asked for again).
  const [pasteInstall, setPasteInstall] = useState<{ tool: PortedTool; nonce: number } | null>(null);
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

  const dismissPasted = useCallback(() => setPasted(null), []);
  const openPastedIn = useCallback((toolId: string) => {
    const wantsInstall = pasted?.suggestions.find((item) => item.toolId === toolId)?.install;
    const tool = toolById.get(toolId);
    const text = pasted?.text ?? "";
    setPasted(null);
    if (wantsInstall) {
      // Not installed: the install flow of the Home banners (permission dialog, then install). The pasted text is not carried over.
      const ported = PORTED_TOOLS.find((item) => item.pluginId === toolId);
      if (ported) setPasteInstall((current) => ({ tool: ported, nonce: (current?.nonce ?? 0) + 1 }));
      return;
    }
    if (!tool) return;
    selectTool(tool);
    // Tools load lazily. Wait for the panel's main input, then fill it the way typing would.
    const started = Date.now();
    const fill = () => {
      const field = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
        `#panel-${tool.id} textarea:not([readonly]), #panel-${tool.id} input[type="text"]:not([readonly])`,
      );
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
  }, [pasted, toolById]);

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
    toast(`Shard ${updateState.version} is ready`, {
      id: "update-ready",
      description: "It installs when you quit Shard.",
      duration: 20000,
      action: { label: "Restart now", onClick: () => installUpdateRef.current() },
    });
  }, [updateState.status, updateState.version]);

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
        onPin={pinTool}
        onUnpin={unpinTool}
        onPinInstalled={(id) => pinInstalledRef.current(id)}
        onOpenPlugin={(id) => openPluginRef.current(id)}
        onFinish={finishWizard}
      />
    );
  }

  return (
    <div data-platform={desktop?.platform} data-sidebar-open={layout === "sidebar" && sidebarOpen} data-layout={layout} className="workspace h-screen overflow-hidden bg-background flex">
      {layout === "sidebar" && <Sidebar
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
        isDesktop={Boolean(desktop)}
        appVersion={appVersion}
        updateNotice={updateNotice}
        hasReleaseNotes={Boolean(releaseNotes)}
        hasUnreadWhatsNew={hasUnreadWhatsNew}
        onWhatsNew={openWhatsNew}
        onOpenPlugins={() => openPlugins("browse")}
        pluginsOpen={view.kind === "plugins"}
        updateCount={updates.length}
        onOpenSettings={openSettings}
        settingsOpen={view.kind === "settings"}
        categoryMode={sidebarCategories}
        empty={empty}
      />}

      {/* Main Content */}
      <main className="flex-1 min-h-0 flex flex-col min-w-0">
        {layout === "launcher" ? (
        <header data-tauri-drag-region className="workspace-titlebar launcher-titlebar">
          <div data-tauri-drag-region className="flex items-center gap-2.5 pr-2.5">
            <img src="./brand/mark.svg" alt="" aria-hidden="true" className="h-[22px] w-[22px]" />
            <span className="font-semibold text-foreground">Shard</span>
          </div>
          <div className="launcher-tabs" role="presentation">
            <button type="button" className="workspace-tab launcher-home-tab" aria-current={view.kind === "home" ? "page" : undefined} onClick={() => setView(HOME_VIEW)}>
              <House size={15} aria-hidden="true" />
              <span>Home</span>
            </button>
            <TopTabs tools={openTools} selectedId={selectedTool?.id ?? null} onSelect={selectTool} onClose={closeTool} onCloseMany={closeTools} />
          </div>
          <button type="button" className="chrome-button" aria-label="Open a tool" title="Open a tool" onClick={openCommandPalette}><Plus size={16} /></button>
          <div className="flex min-w-0 flex-1 justify-center">
            <button type="button" className="launcher-search h-8 w-[360px] max-w-full" onClick={openCommandPalette}>
              <Search size={15} aria-hidden="true" />
              <span className="flex-1 truncate text-left">Find a tool or command</span>
              <kbd>{commandPaletteShortcutLabel}</kbd>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {selectedTool && <button type="button" className="chrome-button" aria-label={pinned.includes(selectedTool.id) ? "Unpin from Home" : "Pin to Home"} onClick={() => togglePinned(selectedTool.id)}><Pin size={15} className={pinned.includes(selectedTool.id) ? "fill-current text-primary" : ""} /></button>}
            <button type="button" className="chrome-button relative" title="Plugins" aria-current={view.kind === "plugins" ? "page" : undefined} onClick={() => openPlugins("browse")}>
              <Puzzle size={16} aria-hidden="true" />
              <span className="sr-only">Plugins</span>
              {updates.length > 0 && <span className="launcher-badge" title={`${updates.length} plugin ${updates.length === 1 ? "update" : "updates"}`}>{updates.length}</span>}
            </button>
            <button type="button" className="chrome-button" aria-label="Settings" title="Settings" aria-current={view.kind === "settings" ? "page" : undefined} onClick={() => openSettings()}><Settings size={16} aria-hidden="true" /></button>
            <button type="button" className="chrome-button" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setThemePreference(darkMode ? "light" : "dark")}>
              {darkMode ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </header>
        ) : (
        <header data-tauri-drag-region className="workspace-titlebar">
          <button type="button" className="chrome-button" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><PanelLeft size={16} /></button>
          <TopTabs tools={openTools} selectedId={selectedTool?.id ?? null} onSelect={selectTool} onClose={closeTool} onCloseMany={closeTools} />
          <button type="button" className="chrome-button" aria-label="Open a tool" title="Open a tool" onClick={openCommandPalette}><Plus size={17} /></button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {selectedTool && <button type="button" className="chrome-button" aria-label={pinned.includes(selectedTool.id) ? "Unpin from Home" : "Pin to Home"} onClick={() => togglePinned(selectedTool.id)}><Pin size={15} className={pinned.includes(selectedTool.id) ? "fill-current text-primary" : ""} /></button>}
            <button type="button" className="chrome-button" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setThemePreference(darkMode ? "light" : "dark")}>
              {darkMode ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </header>
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
              customThemes={desktop ? customThemes : undefined}
              dark={darkMode}
              layout={layout}
              onLayout={setLayout}
              sidebarCategories={sidebarCategories}
              onSidebarCategories={setSidebarCategories}
              openToolsIn={openToolsIn}
              onOpenToolsIn={setOpenToolsIn}
              platform={platform}
              isDesktop={Boolean(desktop)}
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
            <PluginsPage variant={layout === "launcher" ? "cards" : "list"} customThemes={desktop ? customThemes : undefined} startInstall={view.install} tab={view.tab} onTabChange={(tab) => setView({ kind: "plugins", tab })} onOpenPlugin={(id) => { const tool = toolById.get(id); if (tool) selectTool(tool); }} />
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
              pluginsIntro={firstRun === "intro"}
              onDismissPluginsIntro={() => {
                dismissPluginsIntro(window.localStorage);
                setFirstRun(null);
              }}
              portedOffers={portedOffers}
              onDismissPorted={dismissPorted}
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
              pluginsIntro={firstRun === "intro"}
              onDismissPluginsIntro={() => {
                dismissPluginsIntro(window.localStorage);
                setFirstRun(null);
              }}
              portedOffers={portedOffers}
              onDismissPorted={dismissPorted}
            />
          ) : null}
          <ToolHost tools={openTools} selectedId={selectedTool?.id ?? null} />
        </div>
      </main>

      {pasted && (
        <PasteSuggestions
          suggestions={pasted.suggestions}
          toolName={(toolId) => toolById.get(toolId)?.name ?? PORTED_TOOLS.find((item) => item.pluginId === toolId)?.name ?? toolId}
          onOpen={openPastedIn}
          onDismiss={dismissPasted}
        />
      )}
      {pasteInstall && (
        <PortedToolInstall
          key={pasteInstall.nonce}
          tool={pasteInstall.tool}
          onOpenPlugin={(id) => openPluginRef.current(id)}
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
                aria-label="Close what's new"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className={`modal-body release-body min-h-0 overflow-y-auto px-6 py-4 prose prose-sm prose-neutral max-w-none text-sm dark:prose-invert prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-blockquote:text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:tracking-wide [&_h2]:text-foreground [&_p]:my-1 [&_p]:text-sm [&_p]:leading-5 [&_ul]:my-1 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_li]:pl-0.5 [&_li]:text-sm [&_li]:leading-5 [&_li::marker]:text-primary text-muted-foreground`}
              dangerouslySetInnerHTML={{ __html: whatsNewHtml }}
            />

            <div className="modal-footer flex justify-end">
              <Button type="button" onClick={closeWhatsNew}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Shard;
