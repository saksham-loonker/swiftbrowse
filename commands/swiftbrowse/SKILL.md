---
name: swiftbrowse
description: Browser automation using the user's real browser with real cookies. Handles consent walls, login sessions, and bot detection automatically.
allowed-tools: Bash(swiftbrowse:*)
---

# swiftbrowse — Browser Automation for Autonomous Agents

Automate browsing in the user's real browser with authentic cookies, session state, and user agent. Automatically handles cookie consent dialogs, login sessions, JavaScript alerts, and bot detection. Returns pruned ARIA snapshots (40-90% smaller than raw DOM) with `[ref=N]` markers for interaction targeting.

## Quick Start: Realistic Agent Workflow

```bash
# 1. Navigate and observe page structure
swiftbrowse open https://example.com
swiftbrowse snapshot --mode=read
# Read .swiftbrowse/page-*.yml to understand page layout

# 2. Interact: find search input, enter query
swiftbrowse snapshot
swiftbrowse fill 4 "search term"
swiftbrowse press Enter

# 3. Wait for results and scrape
swiftbrowse wait-idle
swiftbrowse snapshot --mode=read
swiftbrowse extract "div.result" --all
# Returns .swiftbrowse/extract-*.json with matched elements

# 4. Cleanup
swiftbrowse close
```

All output files are written to `.swiftbrowse/` in the current directory. Use the Read tool to access `.yml`, `.json`, `.png`, and `.pdf` files.

## Commands Overview

### Session Lifecycle

| Command | Description |
|---------|-------------|
| `swiftbrowse open [url] [flags]` | Start browser session and optionally navigate to URL. |
| `swiftbrowse close` | Terminate browser process and close session. |
| `swiftbrowse status` | Report current session status (running/stopped) and URL if active. |

**Open flags:**
- `--mode=headless|headed|hybrid` — Browser visibility mode. Headless for automation, headed for debugging (requires `--remote-debugging-port=9222`). Default: headless.
- `--no-cookies` — Skip injecting user's cookies at startup.
- `--browser=chromium|firefox` — Source browser for cookie extraction. Default: chromium.
- `--timeout=N` — Navigation timeout in milliseconds. Default: 30000.
- `--proxy=URL` — HTTP or SOCKS proxy server (e.g., `http://127.0.0.1:8080`).
- `--viewport=WxH` — Set viewport dimensions (e.g., `1280x720`). Default: 1024x768.
- `--storage-state=FILE` — Load persisted cookies and localStorage from JSON file (created via `save-state`).

### Navigation

| Command | Output |
|---------|--------|
| `swiftbrowse goto <url>` | Navigate to URL, wait for page load, auto-dismiss consent dialogs. Outputs "ok" on success. |
| `swiftbrowse back` | Navigate to previous page in browser history. |
| `swiftbrowse forward` | Navigate to next page in browser history. |
| `swiftbrowse snapshot [--mode=act\|read]` | Generate ARIA snapshot → `.swiftbrowse/page-<timestamp>.yml`. Default: act mode. |
| `swiftbrowse screenshot [--selector=CSS]` | Capture screenshot → `.swiftbrowse/screenshot-<timestamp>.png`. Optional: capture specific element. |
| `swiftbrowse pdf [--landscape]` | Export page as PDF → `.swiftbrowse/page-<timestamp>.pdf`. Default: portrait orientation. |

### Interaction

| Command | Description |
|---------|-------------|
| `swiftbrowse click <ref>` | Click element by ref. Automatically scrolls into viewport before clicking. |
| `swiftbrowse type <ref> <text>` | Type text into focused element (appends to existing content). |
| `swiftbrowse fill <ref> <text>` | Clear element content and type new text (use for input fields). |
| `swiftbrowse press <key>` | Press key: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space. |
| `swiftbrowse scroll <deltaY>` | Scroll page vertically (positive=down, negative=up). |
| `swiftbrowse hover <ref>` | Hover over element (triggers tooltips and CSS hover states). |
| `swiftbrowse select <ref> <value>` | Select option in dropdown/select element by visible text or value. |
| `swiftbrowse drag <fromRef> <toRef>` | Drag element to target element (simulates mouse drag). |
| `swiftbrowse upload <ref> <files...>` | Upload file(s) to file input element (paths must be absolute). |

### Tabs

| Command | Description |
|---------|-------------|
| `swiftbrowse tabs` | List all open tabs with index, URL, and title. |
| `swiftbrowse tab <index>` | Switch to specific tab by index (0-based). |

### Scraping

Scraping commands extract structured data from the current page without requiring snapshot refs. Use these commands to gather content for further processing.

| Command | Description | Output |
|---------|-------------|--------|
| `swiftbrowse text [--max-chars=N]` | Extract all text content from page body. Respects layout structure. → `.swiftbrowse/text-<timestamp>.txt` |
| `swiftbrowse extract <selector> [--all] [--attr=NAME]` | Extract elements matching CSS selector. Returns structured element data. → `.swiftbrowse/extract-<timestamp>.json` |
| `swiftbrowse links` | Extract all hyperlinks from page. Returns URL and link text for each. → `.swiftbrowse/links-<timestamp>.json` |
| `swiftbrowse table [selector]` | Extract table as JSON (headers + rows). Specify selector for specific table, or uses first `<table>`. → `.swiftbrowse/table-<timestamp>.json` |
| `swiftbrowse browse-batch <url...> [--file=PATH]` | Open multiple URLs sequentially in same session. Snapshot after each. Useful for batch content extraction. |

**Scraping flags:**
- `--max-chars=N` — Limit text output to N characters (for `text` command).
- `--all` — Return all matching elements (for `extract`; default returns only first match).
- `--attr=NAME` — Extract specific attribute value instead of full element (for `extract`; e.g., `--attr=href`).
- `--file=PATH` — Read URLs from file, one per line (for `browse-batch`).

**When to use each command:**

- **`text`** — Extract article body, product descriptions, or any unstructured text content.
- **`extract`** — Target specific elements by CSS selector (e.g., product cards, comment threads). Use `--all` for all matches.
- **`links`** — Gather all URLs on page for crawling or navigation decisions.
- **`table`** — Parse tabular data (spreadsheets, pricing tables, results tables).
- **`browse-batch`** — Efficiently scrape multiple pages in sequence without reopening browser.

### Debugging

| Command | Output |
|---------|--------|
| `swiftbrowse eval <expression>` | Execute JavaScript expression in page context. Returns result as JSON. |
| `swiftbrowse wait-idle` | Block until network is idle (no active requests for 500ms). |
| `swiftbrowse wait-for [--text=STRING\|--selector=CSS] [--timeout=N]` | Wait for condition to be met. Default timeout: 30000ms. |
| `swiftbrowse console-logs [--level=log\|warn\|error] [--clear]` | Dump JavaScript console logs → `.swiftbrowse/console-<timestamp>.json`. |
| `swiftbrowse network-log [--failed]` | Dump network activity → `.swiftbrowse/network-<timestamp>.json`. Filter to failed (4xx/5xx) with `--failed`. |
| `swiftbrowse dialog-log` | Dump JavaScript dialogs (alert/confirm/prompt) → `.swiftbrowse/dialogs-<timestamp>.json`. |
| `swiftbrowse save-state` | Persist cookies and localStorage → `.swiftbrowse/state-<timestamp>.json` (use with `--storage-state` on next session). |

**wait-for flags:**
- `--text=STRING` — Wait for exact text to appear in page body.
- `--selector=CSS` — Wait for CSS selector to match at least one element.
- `--timeout=N` — Maximum wait time in milliseconds (default: 30000).

## Snapshot Format and Refs

ARIA snapshots are YAML-formatted DOM trees with pruned content. Each element is one line:

```
# https://example.com/page
# 8192 chars → 1024 chars (87% pruned)
- button "Search" [ref=2]
  - input "search query" [ref=3]
- heading "Results" [level=2] [ref=5]
  - link "Article 1" [href=/article/1] [ref=6]
  - link "Article 2" [href=/article/2] [ref=7]
```

**Ref numbers:**
- Use `[ref=N]` numbers with `click`, `type`, `fill`, `hover`, `select`, `drag`, `upload` commands.
- Refs are **ephemeral** — they change after every page modification or snapshot refresh.
- Always capture a fresh snapshot before interacting with elements.

**Snapshot modes:**
- **act mode** (default) — Include interactive elements, form labels, and navigation. Optimal for planning interactions.
- **read mode** (`--mode=read`) — Include all text content, article body, and data tables. Use for content extraction and analysis.

## Workflow Pattern

```
1. Open session and navigate
   swiftbrowse open https://example.com

2. Snapshot to understand page structure
   swiftbrowse snapshot

3. Decide next action based on snapshot
   (Check .swiftbrowse/page-*.yml for available elements)

4. Execute action(s)
   swiftbrowse click 4
   swiftbrowse snapshot

5. Scrape or repeat
   swiftbrowse extract "div.card" --all
   (or) swiftbrowse click 8 && swiftbrowse snapshot

6. Close when done
   swiftbrowse close
```

## Tips and Best Practices

**Snapshots and Refs:**
- Always take a fresh snapshot before interacting — refs change after every action.
- Use `--mode=read` when extracting content or analyzing page text; use default `act` mode for navigation.
- Snapshot after significant actions (clicks, form submissions) to ensure expected results.

**Input and Forms:**
- Use `fill` for input fields; use `type` for appending to existing content.
- Use `select` for dropdown menus, providing the visible text or option value.
- Use `press Enter` after text input to submit forms (common for search).

**Scraping and Data Extraction:**
- Use `text` for unstructured content (articles, descriptions).
- Use `extract` with CSS selectors for structured element lists. Combine with `--all` to get all matches.
- Use `table` for parsing table data; use `links` for gathering URLs.
- Use `browse-batch` to efficiently process multiple URLs in one session.
- Always `wait-idle` or `wait-for` after actions that trigger async loading.

**Navigation and History:**
- Use `back`/`forward` instead of `goto` when returning to previously visited pages.
- Use `wait-idle` after navigation to ensure resources are loaded.
- Use `wait-for --selector=CSS` when content loads asynchronously (more reliable than `wait-idle` alone).

**Debugging and Validation:**
- Check `console-logs` if page behavior is unexpected — JavaScript errors will appear there.
- Check `network-log --failed` to identify broken API calls or missing resources.
- Check `dialog-log` to see which JavaScript alerts were auto-dismissed during execution.
- Use `eval` to inspect page state directly when ARIA snapshot doesn't show needed information.
- Use `screenshot` to visually validate page state before continuing automation.

**Session Management:**
- Maintain one session per project; `.swiftbrowse/` directory is project-scoped.
- Use `save-state` at end of authenticated sessions, then reload with `--storage-state=FILE` in future sessions.
- Use `--mode=headed` for interactive debugging (requires browser with `--remote-debugging-port=9222`).
- Use `--proxy` when accessing content behind corporate networks or proxies.

## Example: Multi-Step Scraping Workflow

```bash
# Open and navigate to search page
swiftbrowse open https://example.com/search
swiftbrowse snapshot

# Enter search and wait for results
swiftbrowse fill 4 "electronics"
swiftbrowse press Enter
swiftbrowse wait-for --selector="div.product-card"

# Scrape all product cards as structured data
swiftbrowse extract "div.product-card" --all
# Outputs: .swiftbrowse/extract-*.json with all product elements

# Also extract only product URLs
swiftbrowse extract "div.product-card a" --all --attr=href
# Outputs: .swiftbrowse/extract-*.json with href attributes only

# Save session state for later reuse
swiftbrowse save-state
swiftbrowse close
```
