# opencode-better-plugins

> **Interactive TUI plugin manager for OpenCode V2: easily inspect, filter, enable, and disable plugins with live reload.**

`opencode-better-plugins` (`better-plugins`) provides a modal selector within the OpenCode TUI to toggle plugins on and off without hand-editing `opencode.jsonc`.

## Features

- **TUI Modal Selector (`/better-plugins`)**:
  - Live fuzzy search / filter by typing directly.
  - Arrow navigation (`↑` / `↓`).
  - Colored status pastilles: `●` (green) for active plugins, `○` (muted) for disabled plugins.
  - Summarizes plugin options (e.g. ports, system prompts).
- **In-Place Toggle & Hot Reload**:
  - Press `Space` or `Enter` to instantly toggle the highlighted plugin.
  - The modal remains open so you can toggle multiple plugins in one session.
  - Automatically reloads OpenCode via `POST /api/location/reload`.
- **AST-Powered JSONC Preservation**:
  - Uses `jsonc-parser` to comment out disabled plugins as `/* @disabled ... */` inside the `plugins` array.
  - Preserves custom options, indentation, and existing comments.
  - Strict syntax validation before writing to disk prevents any config corruption.
  - Self-hides `better-plugins` from the list to prevent accidental deactivation.

## Keybindings in the Modal

| Key | Action |
| :--- | :--- |
| `↑` / `↓` | Move selection up / down |
| `Space` / `Enter` | Toggle active / disabled status of the selected plugin |
| Typing (`a-z`, `0-9`, `-`) | Filter plugins in real-time |
| `Backspace` | Erase one filter character |
| `Ctrl+U` | Clear filter query |
| `Esc` / `Ctrl+C` | Close the modal |

## Installation & Build

```bash
cd ~/Dev/opencode-better-plugins
pnpm install
pnpm build
```

## Configuration

Add the plugin to your `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    // ...
    {
      "package": "file:///Users/krishna/Dev/opencode-better-plugins/dist"
    }
  ]
}
```

Reload OpenCode or run:

```bash
opencode api post /api/location/reload
```
