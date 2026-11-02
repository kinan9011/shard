# Diff & Merge — UI design brief

## What we're building
A new tool inside our offline developer-tools desktop app (Tauri, React, Tailwind/shadcn, light + dark theme). It compares **two pieces of text or code side by side** and lets the user **merge changes between them with one click**. Think of the diff window in JetBrains IDEs (PyCharm, IntelliJ): two editable panes, coloured change blocks, curved ribbons connecting the same change on both sides, and small `>>` / `<<` arrows to push a change from one side to the other.

Reference: the JetBrains screenshot the product owner supplied. Match its *function*, not its look. The mockup must fit our app's existing visual language (look at the existing **Text Compare** and **JSON Diff** tools for toolbar, pane, status-bar and colour conventions).

## Who uses it
Developers comparing two versions of a file, config, query, API response or snippet. They paste or open files, scan the differences, then pick which side wins for each change. Used for minutes at a time, keyboard-heavy, often in dark mode.

## Screen anatomy (top to bottom)
1. **App shell (existing, don't redesign):** sidebar, tool title, window chrome.
2. **Toolbar (one row):**
   - Left: *Previous difference* ↑, *Next difference* ↓, *Swap sides* ⇄.
   - Middle dropdowns: **Viewer** (Side-by-side / Unified), **Ignore** (Do not ignore / Trim whitespace / Ignore whitespace / Ignore whitespace + blank lines), **Highlight** (Words / Lines / Characters / None).
   - Toggles: *Collapse unchanged lines*, *Sync scroll*.
   - Right: **Settings** gear (popover), **Help** `?` (shortcuts), and a **"7 differences"** counter (live).
3. **File header row (above each pane):** editable file name/label (e.g. `check_client_name.py`), language badge (auto-detected, changeable), and small actions: Open file, Paste, Clear, Copy all.
4. **Diff area (the main thing, ~85% of the height):**
   - **Left editor | centre gutter | right editor.** Both editors are editable, with line numbers and syntax colouring.
   - **Changed blocks** get a tinted background across the full line width on each side. Three kinds: *added*, *removed*, *modified*. Inside a modified line, the **exact changed words** get a stronger tint.
   - **Centre gutter:** curved ribbons joining each block on the left to its counterpart on the right. For a pure insertion/deletion the ribbon narrows to a point on the side with no lines. Each block has a **`>>` arrow (left → right)** and a **`<<` arrow (right → left)** sitting in the gutter at the block's first line.
   - **Current difference** (the one navigation is on) has a stronger outline/tint than the others.
   - **Collapsed unchanged regions** appear as a thin "⋯ 24 unchanged lines" bar that expands on click.
   - **Right-edge change map:** a thin vertical strip beside the scrollbar with coloured ticks showing where changes are in the whole file; click to jump.
5. **Status bar:** line/column of the cursor, language, encoding/line endings, and short messages (e.g. "Applied change 3 — Ctrl+Z to undo").

## Key interactions to design
- **Apply a change:** click `>>` → left text *replaces* the right block. Click `<<` → the opposite.
- **Append instead of replace:** Ctrl/Cmd-click on the arrow (JetBrains does this). Show this in the arrow's tooltip and in the help popover.
- **Discard a change:** Alt-click, or a small context menu on the block (Apply / Append / Copy text / Ignore).
- **Hover on a block:** the block and its ribbon highlight, arrows become fully visible (at rest they may be subtler).
- **After applying:** the block disappears (sides are now equal), the counter drops by one, a short toast/status message confirms, undo restores it.
- **Navigation:** ↑/↓ buttons (and F7 / Shift+F7) move to the previous/next block and scroll it into the centre.
- **Unified viewer:** single editor, removed lines shown struck-through in red above/below added lines in green, each with Accept / Reject buttons on the block.
- **Bulk actions:** "Apply all left → right" and "Apply all right → left" (in a menu; destructive → confirm or rely on undo, designer to propose).
- **Settings popover:** wrap lines, font size, show line numbers, tab size, show whitespace characters.
- **Export:** menu with *Copy unified patch*, *Save patch*, *Save left*, *Save right*.

## States to mock up
1. **Empty:** both panes empty with a friendly "Paste text or open a file" prompt and drag-and-drop hint. Counter hidden.
2. **Identical:** counter shows "No differences" with a success tone.
3. **Typical diff:** ~7 differences, mix of added/removed/modified, one current.
4. **Hover/active** on an arrow and on a block.
5. **Collapsed unchanged** with a long file.
6. **Unified viewer** version.
7. **Large file notice:** "Diff is approximate for very large input" banner.
8. **Narrow window:** below ~900px wide, propose a fallback (stacked panes top/bottom, or switch to unified).

## Visual requirements
- **Light and dark** themes, both required. Use the app's existing semantic colours: success (added), destructive (removed), warning/info (modified). Add one stronger tint per kind for word-level highlights. Don't rely on colour alone: ribbons, arrows and block borders must also distinguish kinds (accessibility, colour-blind users).
- **Monospace** font in editors, same family as the other tools. Comfortable line height; line numbers muted.
- Arrows must be large enough to click comfortably (≥ 20×20px hit area) but not clutter the gutter.
- Keyboard focus visible everywhere; every icon button has a tooltip with its shortcut.
- Contrast: WCAG AA for text on tinted backgrounds.

## Deliverables requested
- High-fidelity mockups for states 1–7, in **light and dark** (Figma or similar).
- Close-up of one change block: line tint, word tint, ribbon, both arrows, hover state.
- Component sheet: toolbar buttons, dropdowns, counter, arrows, collapsed-region bar, change-map strip, toasts.
- Notes on spacing/colour tokens mapped to the app's existing Tailwind tokens where possible.

## Out of scope for this version
Three-way merge, folder comparison, Git integration.
