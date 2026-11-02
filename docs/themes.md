# Custom themes

A theme is one JSON file. Put it in the themes folder (Settings → Appearance → Custom themes → Open folder), or use **Import…**, then **Reload**. The file must be named `<id>.json`. Start from [`themes/example.json`](../themes/example.json).

```json
{
  "id": "nord",
  "name": "Nord",
  "version": "1.0.0",
  "author": "You",
  "description": "Optional. A repository lists it next to the theme.",
  "light": { "--background": "220 16% 96%" },
  "dark":  { "--background": "220 16% 22%", "--surface-editor": "#2e3440" }
}
```

- `id`: 1 to 40 characters of `a-z`, `0-9`, `-`. Not a built-in scheme (`default`, `adwaita`, `solarized`, `classic`, `kate`, `tango`, `cobalt`, `oblivion`).
- `light` and/or `dark`: the tokens for that mode. A theme with one block is offered in that mode only. A token you leave out keeps the default theme's color.
- A theme file is at most 64 KB. A file with a problem is listed under the row with the reason and is not applied.

## Tokens

Names are the CSS variables of `src/index.css`.

| Tokens | Value |
| --- | --- |
| `--background` `--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground` `--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--muted` `--muted-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground` `--success` `--success-foreground` `--warning` `--warning-foreground` `--info` `--info-foreground` `--border` `--input` `--ring` `--sidebar-background` `--sidebar-foreground` `--sidebar-primary` `--sidebar-primary-foreground` `--sidebar-accent` `--sidebar-accent-foreground` `--sidebar-border` `--sidebar-ring` `--chrome-input-border` `--chrome-muted-foreground` | HSL triplet: `213 77% 48%` |
| `--surface-chrome` `--surface-editor` `--surface-raised` `--surface-sidebar` `--syntax-fn` `--syntax-kw` `--syntax-lit` `--syntax-num` `--syntax-str` | Hex: `#1e1e1e` or `#fff` |

Nothing else is allowed: no other variables, fonts, sizes or CSS. Keep text contrast at 4.5:1 and borders and inputs at 3:1.

## Sharing themes from a repository

A plugin repository's `index.json` may also list themes. A repository can list only themes. Each entry points at a theme file (at most 64 KB):

```json
{
  "schema": 1,
  "name": "My themes",
  "plugins": [],
  "themes": [
    { "id": "nord", "name": "Nord", "version": "1.0.0", "description": "Cool and calm.",
      "url": "https://raw.githubusercontent.com/you/themes/main/nord.json", "sha256": "<sha-256 of the file>", "size": 1234 }
  ]
}
```

Shard's own repository, [`kinan9011/shard-themes`](https://github.com/kinan9011/shard-themes), is built in. To use another one, add it in Plugins → Repositories. Its themes then show under Settings → Appearance → Custom themes, with Install and Update. Shard checks the size and SHA-256 and the theme's tokens before it saves the file, and it never replaces a theme file you made yourself.
