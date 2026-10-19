---
name: swiftbrowse
description: Browser automation using the user's real browser with real cookies. Handles consent walls, login sessions, and bot detection automatically.
allowed-tools: Bash(swiftbrowse:*)
---
# swiftbrowse CLI — Browser Automation for Agents

Browse any URL using the user's real browser with real cookies. Returns pruned ARIA snapshots (40-90% smaller than raw) with `[ref=N]` markers for interaction. Handles cookie consent, login sessions, JS dialogs, and bot detection automatically.

## Quick Start

```bash
swiftbrowse open https://example.com    # Start session + navigate
swiftbrowse snapshot                    # Get ARIA snapshot → .swiftbrowse/page-*.yml
swiftbrowse click 8                     # Click element with ref=8
swiftbrowse snapshot                    # See result
swiftbrowse close                       # End session
```

All output files go to `.swiftbrowse/` in the current directory. Read them with the Read tool when needed.

## Commands

### Session Lifecycle

| Command | Description |
|---------|-------------|
| `swiftbrowse open [url] [flags]` | Start browser session. Optionally navigate to URL. |
| `swiftbrowse close` | Close session and kill browser. |
| `swiftbrowse status` | Check if session is running. |

**Open flags:**
- `--mode=headless|headed|hybrid` — Browser mode (default: headless)
- `--no-cookies` — Skip cookie injection
- `--browser=firefox|chromium` — Cookie source
- `--prune-mode=act|read` — Default pruning mode
- `--timeout=N` — Navigation timeout in ms
- `--proxy=URL` — HTTP/SOCKS proxy server
- `--viewport=WxH` — Viewport size (e.g. 1280x720)
- `--storage-state=FILE` — Load cookies/localStorage from JSON file
- `--block-private-network` — SSRF guard: refuse loopback / RFC-1918 / link-local / cloud-metadata hosts (v0.11.0)
- `--upload-dir=DIR` — Sandbox uploads to DIR; reject files outside it (v0.11.0)

> Security (v0.11.0): `file:`/`chrome:`/etc. navigation is blocked by default, and the daemon requires a per-session token (handled transparently by the CLI). Snapshots and saved state are written owner-only (`0600`).

### Navigation

| Command | Output |
|---------|--------|
| `swiftbrowse goto <url>` | Navigates, waits for load, dismisses consent. Prints "ok". |
| `swiftbrowse back` | Go back in browser history. |
| `swiftbrowse forward` | Go forward in browser history. |
| `swiftbrowse snapshot` | ARIA snapshot → `.swiftbrowse/page-<timestamp>.yml` |
| `swiftbrowse snapshot --mode=read` | Read mode: keeps all text (for content extraction) |
| `swiftbrowse readable` | Clean article text → `.swiftbrowse/article-<timestamp>.txt`. For reading/summarising articles (news, blogs, docs); falls back to snapshot on non-articles. |
| `swiftbrowse screenshot` | Screenshot → `.swiftbrowse/screenshot-<timestamp>.png` |
| `swiftbrowse pdf [--landscape]` | PDF export → `.swiftbrowse/page-<timestamp>.pdf` |

### Interaction

| Command | Description |
|---------|-------------|
| `swiftbrowse click <ref>` | Click element (scrolls into view first) |
| `swiftbrowse type <ref> <text>` | Type text into element |
| `swiftbrowse fill <ref> <text>` | Clear existing content + type new text |
| `swiftbrowse press <key>` | Press key: Enter, Tab, Escape, Backspace, Delete, arrows, Space |
| `swiftbrowse scroll <deltaY>` | Scroll page (positive=down, negative=up) |
| `swiftbrowse hover <ref>` | Hover over element (triggers tooltips) |
| `swiftbrowse select <ref> <value>` | Select dropdown option |
| `swiftbrowse drag <fromRef> <toRef>` | Drag element to another element |
| `swiftbrowse upload <ref> <files..>` | Upload file(s) to a file input element |

### Tabs

| Command | Description |
|---------|-------------|
| `swiftbrowse tabs` | List open tabs (index, url, title) |
| `swiftbrowse tab <index>` | Switch to tab by index |

### Debugging

| Command | Output |
|---------|--------|
| `swiftbrowse eval <expression>` | Evaluate JS in page, print result |
| `swiftbrowse wait-idle` | Wait for network idle (no requests for 500ms) |
| `swiftbrowse wait-for [opts]` | Wait for content to appear on page |
| `swiftbrowse console-logs` | Console logs → `.swiftbrowse/console-<timestamp>.json` |
| `swiftbrowse network-log` | Network log → `.swiftbrowse/network-<timestamp>.json` |
| `swiftbrowse network-log --failed` | Only failed/4xx/5xx requests |
| `swiftbrowse dialog-log` | JS dialog log → `.swiftbrowse/dialogs-<timestamp>.json` |
| `swiftbrowse save-state` | Cookies + localStorage → `.swiftbrowse/state-<timestamp>.json` |

**wait-for flags:**
- `--text=STRING` — Wait for text to appear in page body
- `--selector=CSS` — Wait for CSS selector to match
- `--timeout=N` — Max wait time in ms (default: 30000)

## Snapshot Format

The snapshot is a YAML-like ARIA tree. Each line is one node:

```
# https://example.com/
# 379 chars → 45 chars (88% pruned)
- heading "Example Domain" [level=1] [ref=3]
```

- `[ref=N]` — Use this number with click, type, fill, hover, select, drag, upload
- Refs change on every snapshot — always take a fresh snapshot before interacting
- **act mode** (default): interactive elements + labels — for clicking, typing, navigating
- **read mode**: all text content — for reading articles, extracting data

## Workflow Pattern

1. `swiftbrowse open <url>` — start session
2. `swiftbrowse snapshot` — observe page (read the .yml file)
3. Decide action based on snapshot content
4. `swiftbrowse click/type/fill/press/scroll/drag/upload <ref>` — act
5. `swiftbrowse snapshot` — observe result (refs are now different!)
6. Repeat 3-5 until goal achieved
7. `swiftbrowse close` — clean up

## Tips

- **Always snapshot before interacting** — refs are ephemeral and change every time
- **Use `fill` instead of `type`** when replacing existing text in input fields
- **Use `--mode=read`** for snapshot when you need to extract article content or data
- **Use `back`/`forward`** to navigate browser history instead of re-entering URLs
- **Use `upload`** for file inputs — pass absolute paths to the files
- **Use `wait-for`** when content loads asynchronously — more reliable than `wait-idle`
- **Check `dialog-log`** if JS alerts/confirms were auto-dismissed during your session
- **Use `save-state`** to persist cookies/localStorage for later sessions via `--storage-state`
- **Check `console-logs`** when page behavior seems wrong — JS errors show up there
- **Check `network-log --failed`** to debug missing content or broken API calls
- **Use `eval`** as an escape hatch when ARIA tree doesn't show what you need
- **One session per project** — `.swiftbrowse/` is project-scoped
- For bot-detected sites, use `--mode=headed` (requires browser with `--remote-debugging-port=9222`)
