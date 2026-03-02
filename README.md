```
  ~~~~~~~~~~~~~~~~~~~~
  ~~~ .---------. ~~~
  ~~~ | · clear | ~~~
  ~~~ | · focus | ~~~
  ~~~ '---------' ~~~
  ~~~~~~~~~~~~~~~~~~~~

  swiftbrowse
```

[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D22-green)](package.json)

**CDP-direct web browsing for autonomous agents and web scrapers. Zero dependencies.**

URL in, pruned ARIA snapshot out. Same browser, same logins, same cookies. 40-90% fewer tokens than raw HTML output.

---

## What it is

swiftbrowse gives your AI agent a real browser without the cruft. Navigate, read, interact, move on — using the browser you already have and the logins you already have. Pages come back pruned to what matters: interactive elements, readable text, no structural noise.

- **No Playwright, no Puppeteer.** Direct Chrome DevTools Protocol (CDP) — lightweight, low-overhead.
- **Zero required dependencies.** Vanilla JavaScript, standard library only.
- **Real browser, real cookies.** Extracts login sessions from your Firefox or Chromium, injects them via CDP. Public pages work without auth.
- **Works standalone.** Use as a library, CLI tool, or MCP server for Claude Desktop / Cursor.
- **Automatic headless fallback.** Bot-detected by Cloudflare? Switches to headed mode on the fly.
- **Prunes ruthlessly.** 40-90% token reduction. Strips decorative wrappers, hidden elements, structural junk. Two modes: **act** (interactive elements only) and **read** (full text).

---

## Install

### From source

```bash
git clone https://github.com/saksham-loonker/swiftbrowse.git
cd swiftbrowse
npm install
```

**Requirements:**
- Node.js >= 22
- Any installed Chromium-based browser (Chrome, Chromium, Brave, Edge, Vivaldi)

### Global CLI

```bash
# Make it globally available
npm install -g .

# Or use directly from the repo
./cli.js browse https://example.com
```

---

## Quick Start

### 1. One-Shot: Browse a URL

Single isolated read — launches its own browser, no session state.

```javascript
import { browse } from 'swiftbrowse';

const snapshot = await browse('https://example.com');
console.log(snapshot);
// # https://example.com
// # 2,847 chars → 340 chars (88% pruned)
// - button "Get Started" [ref=0]
// - link "Docs" [ref=1]
// - textbox "Search" [ref=2]
```

### 2. Long Session: Connect & Interact

Preserve cookies, login state, and storage across multiple actions.

```javascript
import { connect } from 'swiftbrowse';

const page = await connect({ mode: 'headless' });

// Navigate and interact
await page.goto('https://github.com/login');
await page.type(0, 'user@example.com');
await page.type(1, 'password');
await page.click(2);
await page.waitForNavigation();

// Extract data
const snapshot = await page.snapshot();
const links = await page.links();
const table = await page.table('table.data');

await page.close();
```

### 3. Agent Tools: Ready-Made Adapter

Integrate with your LLM orchestration loop. Includes automatic snapshot refresh after every action.

```javascript
import { createBrowseTools } from 'swiftbrowse/swiftagent';

const { tools, close } = createBrowseTools({ mode: 'hybrid' });

// Pass to your agent loop (Anthropic, OpenAI, LangChain, etc.)
// tools[0] = { name: 'browse', description: '...', parameters: {...}, execute: ... }
// tools[1] = { name: 'goto', ... }
// ... 24 tools total

for (const tool of tools) {
  // Your agent can now call tool.execute({ url: '...' })
}

await close();
```

---

## CLI Reference

### Session Commands

```bash
swiftbrowse open [url] [flags]    Open browser session (daemon mode)
swiftbrowse close                  Close session
swiftbrowse status                 Check session status
```

Open flags:

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--mode` | `headless`, `headed`, `hybrid` | `headless` | Browser mode |
| `--port` | number | `9222` | CDP port for headed mode |
| `--no-cookies` | boolean | false (cookies enabled) | Skip cookie injection |
| `--browser` | `firefox`, `chromium` | auto-detect | Cookie source browser |
| `--timeout` | ms | `30000` | Navigation timeout |
| `--prune-mode` | `act`, `read` | `act` | Default snapshot pruning |
| `--no-consent` | boolean | false (consent auto-dismissed) | Skip consent dismissal |
| `--proxy` | URL | none | HTTP/SOCKS proxy server |
| `--viewport` | WxH | `1280x800` | Viewport size |
| `--storage-state` | filepath | none | Load cookies/localStorage from JSON |

Example:
```bash
swiftbrowse open https://example.com --mode=hybrid --viewport=1920x1080
swiftbrowse snapshot
swiftbrowse click 5
swiftbrowse close
```

### Navigation

```bash
swiftbrowse goto <url>              Navigate to URL in current session
swiftbrowse back                    Go back in history
swiftbrowse forward                 Go forward in history
```

### Snapshots & Exports

```bash
swiftbrowse snapshot [--mode=M]     ARIA snapshot → .swiftbrowse/page-*.yml
swiftbrowse screenshot [--format] [--selector]
  --format=png|jpeg|webp            Image format (default: png)
  --selector=CSS                    Crop to matching element
swiftbrowse pdf [--landscape]       PDF export → .swiftbrowse/page-*.pdf
```

### Interaction

```bash
swiftbrowse click <ref>             Click element by ref
swiftbrowse type <ref> <text>       Type text (--clear to replace)
swiftbrowse fill <ref> <text>       Clear + type (shorthand)
swiftbrowse press <key>             Press special key
swiftbrowse scroll <deltaY>         Scroll (positive=down, e.g. 400)
swiftbrowse hover <ref>             Hover element (reveal tooltips)
swiftbrowse select <ref> <value>    Select dropdown value
swiftbrowse drag <from> <to>        Drag element to another
swiftbrowse upload <ref> <file..>   Upload files to file input
```

Keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Space`

### Tabs

```bash
swiftbrowse tabs                    List open tabs (index, url, title)
swiftbrowse tab <index>             Switch to tab by index
```

### Scraping & Debugging

```bash
swiftbrowse text [--max-chars=N]    Plain text from main content area
swiftbrowse extract <selector> [--all] [--attr=NAME]
  --all                             Return all matches as array
  --attr=NAME                       Read property/attribute instead of text
swiftbrowse links                   All hyperlinks → .swiftbrowse/links-*.json
swiftbrowse table [selector]        HTML table → .swiftbrowse/table-*.json
swiftbrowse eval <expression>       Run JS in page context (raw CDP)
swiftbrowse wait-idle [--timeout]   Wait for network idle
swiftbrowse wait-for [--text] [--selector] [--timeout]
swiftbrowse console-logs            Console logs → .swiftbrowse/console-*.json
swiftbrowse network-log [--failed]  Network log → .swiftbrowse/network-*.json
swiftbrowse dialog-log              JS dialog log → .swiftbrowse/dialogs-*.json
swiftbrowse save-state              Cookies + localStorage → .swiftbrowse/state-*.json
```

### Batch & One-Shot

```bash
swiftbrowse browse-batch <urls..>   Scrape multiple URLs
  --file=FILE                       Read URLs from text file (one per line)
  --mode=headless|headed            Browser mode (default: headless)

swiftbrowse browse <url> [mode]     One-shot read (print snapshot to stdout)
```

### MCP Server

```bash
swiftbrowse mcp                     Start MCP server (JSON-RPC over stdio)
swiftbrowse install                 Auto-configure for Claude Desktop / Cursor
swiftbrowse install --skill         Install SKILL.md for Claude Code
```

---

## Library API

### browse(url, opts)

One-shot isolated read: launch browser, navigate, get snapshot, close.

```typescript
async function browse(url: string, opts?: {
  mode?: 'headless' | 'headed' | 'hybrid';    // default: 'headless'
  cookies?: boolean;                          // default: true
  consent?: boolean;                          // default: true (auto-dismiss)
  prune?: boolean;                            // default: true
  pruneMode?: 'act' | 'read';                 // default: 'act'
  timeout?: number;                           // ms, default: 30000
  browser?: string;                           // 'firefox' | 'chromium'
  proxy?: string;                             // HTTP/SOCKS proxy URL
  viewport?: string;                          // e.g. "1280x720"
  port?: number;                              // CDP port for headed mode
}): Promise<string>
```

Returns ARIA snapshot (YAML-style tree with `[ref=N]` markers):

```
# https://example.com
# 2,847 chars → 340 chars (88% pruned)
- button "Get Started" [ref=0]
- link "Docs" [ref=1]
- textbox "Search" [ref=2]
  - text "Type to search..."
```

**Example:**

```javascript
const snapshot = await browse('https://github.com', {
  mode: 'hybrid',        // Try headless, fallback to headed if bot-detected
  viewport: '1280x720',
  prune: true,
  pruneMode: 'act'       // Interactive elements only
});
```

---

### connect(opts)

Long-lived session: connect to browser, navigate multiple times, interact across pages, preserve cookies/storage.

```typescript
async function connect(opts?: {
  mode?: 'headless' | 'headed' | 'hybrid';    // default: 'headless'
  port?: number;                              // CDP port for headed mode
  cookies?: boolean;                          // injected on goto()
  consent?: boolean;                          // auto-dismissed on goto()
  browser?: string;                           // 'firefox' | 'chromium'
  proxy?: string;                             // HTTP/SOCKS proxy URL
  viewport?: string;                          // e.g. "1280x720"
  storageState?: string;                      // path to state JSON
}): Promise<PageHandle>
```

Returns page handle with the following methods:

#### goto(url, timeout?)

Navigate to URL, wait for load, auto-dismiss consent, return snapshot.

```javascript
await page.goto('https://example.com', 30000);
```

#### goBack()

Go back in history. Throws if no previous page.

```javascript
await page.goBack();
```

#### goForward()

Go forward in history. Throws if no next page.

```javascript
await page.goForward();
```

#### snapshot(pruneOpts?)

Get current page as ARIA snapshot. Refresh after `waitFor` or manual navigation.

```javascript
// Pruned (default: act mode)
const snapshot = await page.snapshot();

// Raw unpruned
const raw = await page.snapshot(false);

// Custom prune mode
const text = await page.snapshot({ mode: 'read' });
```

#### click(ref)

Click element by ref from snapshot. Scrolls into view, triggers DOM updates/navigation.

```javascript
await page.click('0');  // ref from [ref=0]
```

#### type(ref, text, opts?)

Type text into input/textarea/contenteditable.

```javascript
await page.type('2', 'search query');
await page.type('3', 'new value', { clear: true });  // Replace existing
```

#### press(key)

Press special key.

```javascript
await page.press('Enter');
await page.press('Escape');
await page.press('Tab');
```

#### scroll(deltaY)

Scroll page vertically.

```javascript
await page.scroll(400);   // Down 400px
await page.scroll(-200);  // Up 200px
```

#### hover(ref)

Hover mouse over element (reveals tooltips, dropdown menus).

```javascript
await page.hover('1');
```

#### select(ref, value)

Select value in dropdown or ARIA combobox.

```javascript
await page.select('4', 'Option Label');
```

#### drag(fromRef, toRef)

Drag element and drop on another (Kanban boards, sliders, reordering).

```javascript
await page.drag('0', '1');
```

#### upload(ref, files)

Set files on file input element.

```javascript
await page.upload('5', ['/home/user/document.pdf', '/home/user/image.jpg']);
```

#### text(opts?)

Extract all readable text from page. Prefers `<main>`, `[role="main"]`, or `<article>` to exclude nav/header/footer automatically.

```javascript
const text = await page.text();
const truncated = await page.text({ maxChars: 5000 });
```

#### extract(selector, opts?)

Extract text or attribute from elements matching CSS selector.

```javascript
// First match, text content
const title = await page.extract('h1');

// All matches, as array
const prices = await page.extract('.price', { all: true });

// Attribute value
const href = await page.extract('a.primary', { attr: 'href' });
const ids = await page.extract('[data-id]', { all: true, attr: 'data-id' });
```

#### links()

Extract all hyperlinks from page.

```javascript
const allLinks = await page.links();
// [
//   { href: 'https://example.com/docs', text: 'Documentation' },
//   { href: 'https://example.com/blog', text: 'Blog' }
// ]
```

#### table(selector?)

Extract HTML table as structured JSON.

```javascript
const data = await page.table();  // First table
const specific = await page.table('table.pricing');
// {
//   headers: ['Product', 'Price', 'Stock'],
//   rows: [
//     ['Widget A', '$10', 'In Stock'],
//     ['Widget B', '$20', 'Out of Stock']
//   ]
// }
```

#### screenshot(opts?)

Capture page as base64 PNG/JPEG/WebP.

```javascript
const fullPage = await page.screenshot();
const cropped = await page.screenshot({ selector: '.modal' });
const jpeg = await page.screenshot({ format: 'jpeg', quality: 85 });

// Write to file
const fs = require('fs');
fs.writeFileSync('page.png', Buffer.from(fullPage, 'base64'));
```

#### pdf(opts?)

Export page as base64 PDF.

```javascript
const pdf = await page.pdf();
const landscape = await page.pdf({ landscape: true });

// Write to file
fs.writeFileSync('page.pdf', Buffer.from(pdf, 'base64'));
```

#### tabs()

List all open browser tabs.

```javascript
const allTabs = await page.tabs();
// [
//   { index: 0, url: 'https://example.com', title: 'Example' },
//   { index: 1, url: 'https://github.com', title: 'GitHub' }
// ]
```

#### switchTab(index)

Switch to tab by index from `tabs()`.

```javascript
await page.switchTab(1);
```

#### waitFor(opts?)

Poll until text or CSS selector appears on page. Resolves when condition is met.

```javascript
await page.waitFor({ text: 'Loading complete', timeout: 10000 });
await page.waitFor({ selector: '.results-loaded', timeout: 5000 });
```

#### waitForNavigation(timeout?)

SPA-aware: wait for page load event OR frame navigation. Works for full-page loads and `pushState` navigation.

```javascript
await page.waitForNavigation(30000);
```

#### waitForNetworkIdle(opts?)

Wait until no pending network requests for `idle` ms.

```javascript
await page.waitForNetworkIdle({ timeout: 30000, idle: 500 });
```

#### injectCookies(url, opts?)

Extract cookies from your browser and inject into CDP session.

```javascript
await page.injectCookies('https://example.com', { browser: 'firefox' });
```

#### saveState(filePath)

Export cookies and localStorage to JSON file (restore with `storageState` option).

```javascript
await page.saveState('.swiftbrowse/session.json');

// Later: reuse state in new session
const page2 = await connect({ storageState: '.swiftbrowse/session.json' });
```

#### dialogLog

Array of auto-dismissed JS dialogs (alert, confirm, prompt).

```javascript
console.log(page.dialogLog);
// [
//   { type: 'alert', message: 'Error!', timestamp: '2025-03-01T...' },
//   { type: 'prompt', message: 'Enter name:', timestamp: '2025-03-01T...' }
// ]
```

#### cdp (escape hatch)

Raw CDP session for any Chrome DevTools Protocol command.

```javascript
// Run arbitrary JS in page context
const { result } = await page.cdp.send('Runtime.evaluate', {
  expression: 'navigator.userAgent',
  returnByValue: true
});
console.log(result.value);

// Custom metrics
const metrics = await page.cdp.send('Performance.getMetrics');
```

#### close()

Close browser and clean up.

```javascript
await page.close();
```

---

## Agent Tools (24 tools)

When using `createBrowseTools()`, you get 24 ready-to-use tools with LLM-compatible signatures. Each action tool automatically settles the page (waits for navigation OR network idle) and returns a fresh snapshot.

### createBrowseTools(opts?)

```javascript
import { createBrowseTools } from 'swiftbrowse/swiftagent';

const { tools, close } = createBrowseTools({
  mode: 'hybrid',              // Fallback to headed if headless blocked
  cookies: true,               // Inject user cookies on goto()
  consent: true,               // Auto-dismiss cookie banners
  browser: 'firefox',          // Cookie source
  viewport: '1280x720',        // Default viewport
  storageState: './auth.json', // Pre-load session
  snapshotAfterAction: true    // Return snapshot after actions (default)
});

// tools is an array of { name, description, parameters, execute }
// Pass to your agent loop (Anthropic, OpenAI, LangChain, etc.)

await close();  // Cleanup when done
```

#### Navigation Tools

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `browse` | `{ url }` | ARIA snapshot | One-shot read: launch isolated browser, navigate, get snapshot, close. No session state. |
| `goto` | `{ url }` | ARIA snapshot | Navigate in current session. Preserves cookies, storage, login state. Waits for load. |
| `back` | none | ARIA snapshot | Go back in history. Throws if no previous page. |
| `forward` | none | ARIA snapshot | Go forward in history. Throws if no next page. |

#### Observation Tools

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `snapshot` | none | ARIA snapshot | Pruned tree with `[ref=N]` markers. Call after waitFor to refresh stale refs. |
| `find` | `{ text, role? }` | `{ ref, line }` or `{ ref: null, message }` | Find element by visible text/label. Optionally narrow by ARIA role. Use instead of snapshot scanning. |
| `screenshot` | `{ format?, selector? }` | base64 string | Page/element screenshot. PNG/JPEG/WebP. Use when ARIA cannot express visual context. |
| `pdf` | `{ landscape? }` | base64 string | Export page as PDF. |

#### Interaction Tools

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `click` | `{ ref }` | ARIA snapshot | Click element. Scrolls into view, triggers actions/navigation. |
| `type` | `{ ref, text, clear? }` | ARIA snapshot | Type text into input. Set `clear=true` to replace. |
| `press` | `{ key }` | ARIA snapshot | Press special key (Enter, Tab, Escape, arrows, etc.). |
| `hover` | `{ ref }` | ARIA snapshot | Hover element (reveals tooltips, menus). |
| `select` | `{ ref, value }` | ARIA snapshot | Select dropdown value by text or option value. |
| `scroll` | `{ deltaY }` | ARIA snapshot | Scroll page (positive=down). Typical: 400. |
| `drag` | `{ fromRef, toRef }` | ARIA snapshot | Drag and drop. For Kanban, sliders, reordering. |
| `upload` | `{ ref, files }` | ARIA snapshot | Upload files to file input. Paths: absolute. |

#### Waiting Tools

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `waitFor` | `{ text?, selector?, timeout? }` | ARIA snapshot | Poll until text or CSS selector appears. More reliable than fixed delays. |

#### Tabs

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `tabs` | none | array of `{ index, url, title }` | List open tabs. Use with `switchTab`. |
| `switchTab` | `{ index }` | ARIA snapshot | Switch to tab by index. |

#### Scraping Tools

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `extract` | `{ selector, all?, attr? }` | string or array | Extract text/attribute from CSS selector. `all=true` for all matches. `attr=` for properties/attributes. |
| `links` | none | array of `{ href, text }` | All hyperlinks (excludes javascript: and data:). |
| `table` | `{ selector? }` | `{ headers, rows }` or null | HTML table as JSON. Default: first table. |
| `text` | `{ maxChars? }` | string | Plain text from main content area (automatically excludes nav/header/footer). |

---

## Scraping Examples

### Extract Prices from E-Commerce Site

```javascript
import { connect } from 'swiftbrowse';

const page = await connect();
await page.goto('https://example.com/products');

const prices = await page.extract('.product-price', { all: true });
// ['$19.99', '$29.99', '$39.99']

const names = await page.extract('.product-name', { all: true });
// ['Widget A', 'Widget B', 'Widget C']

await page.close();
```

### Scrape an HTML Table

```javascript
import { connect } from 'swiftbrowse';

const page = await connect();
await page.goto('https://example.com/pricing');

const table = await page.table('table.comparison');
// {
//   headers: ['Plan', 'Price', 'Users', 'Support'],
//   rows: [
//     ['Starter', '$29/mo', '1', 'Email'],
//     ['Pro', '$99/mo', '5', 'Priority'],
//     ['Enterprise', 'Custom', 'Unlimited', '24/7']
//   ]
// }

await page.close();
```

### Get All Links from a Page

```javascript
import { connect } from 'swiftbrowse';

const page = await connect();
await page.goto('https://example.com');

const links = await page.links();
// [
//   { href: 'https://example.com/about', text: 'About Us' },
//   { href: 'https://example.com/contact', text: 'Contact' },
//   { href: 'https://example.com/blog', text: 'Blog' }
// ]

// Filter for external links
const external = links.filter(l => !l.href.includes('example.com'));

await page.close();
```

### Batch Crawl Multiple URLs

```javascript
import { browse } from 'swiftbrowse';
import { writeFileSync } from 'node:fs';

const urls = [
  'https://example.com/page1',
  'https://example.com/page2',
  'https://example.com/page3'
];

for (const url of urls) {
  try {
    const snapshot = await browse(url, { mode: 'hybrid' });
    writeFileSync(`output/${url.split('/').pop()}.yml`, snapshot);
    console.log(`OK: ${url}`);
  } catch (err) {
    console.error(`FAIL: ${url}: ${err.message}`);
  }
}
```

Or use CLI:

```bash
swiftbrowse browse-batch \
  https://example.com/page1 \
  https://example.com/page2 \
  https://example.com/page3 \
  --mode=hybrid
```

### Screenshot a Specific Element

```javascript
import { connect } from 'swiftbrowse';
import { writeFileSync } from 'node:fs';

const page = await connect();
await page.goto('https://example.com');

// Screenshot the hero section
const screenshot = await page.screenshot({ selector: '.hero' });
writeFileSync('hero.png', Buffer.from(screenshot, 'base64'));

await page.close();
```

### Fill and Submit a Form

```javascript
import { connect } from 'swiftbrowse';

const page = await connect();
await page.goto('https://example.com/contact');

const snapshot = await page.snapshot();
// - textbox "Name" [ref=0]
// - textbox "Email" [ref=1]
// - textarea "Message" [ref=2]
// - button "Submit" [ref=3]

await page.type('0', 'John Doe');
await page.type('1', 'john@example.com');
await page.type('2', 'Hello, I have a question...');
await page.click('3');

await page.waitForNavigation();
const result = await page.snapshot();
console.log(result);

await page.close();
```

---

## Browser Modes

| Mode | Behavior | Best For |
|------|----------|----------|
| **headless** (default) | Launches fresh Chromium, no UI. Fast, lightweight, scriptable. | Automation, scraping, reading pages, batch jobs. |
| **headed** | Connects to your running browser on CDP port 9222. Visible interaction, visual debugging. | Bot-detected sites, CAPTCHAs, visual inspection, debugging. |
| **hybrid** | Tries headless first. If bot-detected (Cloudflare, etc.), falls back to headed. | General-purpose agent browsing. Best of both. |

**Start a headed browser (macOS/Linux/Windows):**

```bash
# Chrome
google-chrome --remote-debugging-port=9222 &
# or Chromium
chromium --remote-debugging-port=9222 &
# or Brave
brave --remote-debugging-port=9222 &

# Then use headed mode
swiftbrowse open https://example.com --mode=headed
```

---

## Automatic Features

- **Cookie injection:** Extracts login sessions from Firefox/Chromium, injects via CDP. Public pages work without auth.
- **Consent dismissal:** Detects and dismisses 29-language cookie consent dialogs automatically.
- **Bot detection fallback:** Recognizes Cloudflare challenges, switches to headed mode on the fly (hybrid mode).
- **Permission suppression:** Blocks all browser permission prompts (geolocation, notifications, camera, etc.).
- **Stealth patches:** Headless-mode-only patches to evade bot detection (navigator checks, etc.).
- **SPA navigation:** Works with `pushState`/`replaceState` navigation (React, Vue, Angular, etc.).
- **Dialog handling:** Auto-dismisses JS alerts, confirms, prompts.
- **Network monitoring:** Track network requests, wait for idle.

---

## MCP Server

swiftbrowse runs as an MCP (Model Context Protocol) server for Claude Desktop, Cursor, and other MCP clients.

### Claude Code

```bash
claude mcp add swiftbrowse -- npx swiftbrowse mcp
```

### Claude Desktop / Cursor

```bash
npx swiftbrowse install
```

Or manually add to config:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or equivalent on Windows/Linux):

```json
{
  "mcpServers": {
    "swiftbrowse": {
      "command": "npx",
      "args": ["swiftbrowse", "mcp"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "servers": {
    "swiftbrowse": {
      "command": "npx",
      "args": ["swiftbrowse", "mcp"]
    }
  }
}
```

MCP exposes 12 essential tools:
- **Navigation:** `browse`, `goto`, `back`, `forward`
- **Observation:** `snapshot`, `screenshot`, `pdf`
- **Interaction:** `click`, `type`, `press`, `scroll`, `hover`, `select`, `drag`, `upload`
- **Tab management:** `tabs`, `switchTab`
- **Scraping:** `extract`, `links`, `table`, `text`
- **Waiting:** `waitFor`, `waitForNavigation`, `waitForNetworkIdle`

Session runs in hybrid mode with automatic cookie injection.

---

## Pruning

The pruning pipeline reduces ARIA output 40-90% while preserving what matters:

| Page | Raw | Pruned | Reduction |
|------|-----|--------|-----------|
| example.com | 377 chars | 45 chars | 88% |
| Hacker News | 51,726 chars | 27,197 chars | 47% |
| Wikipedia | 109,479 chars | 40,566 chars | 63% |
| DuckDuckGo | 42,254 chars | 5,407 chars | 87% |

**Two modes:**

- **`act` (default):** Interactive elements + visible labels. For clicking, typing, navigating.
- **`read`:** All text content + headings. For reading articles, extracting information.

---

## State Management

### Save Session

```javascript
const page = await connect();
await page.goto('https://example.com/login');
// ... authenticate ...
await page.saveState('.swiftbrowse/session.json');
await page.close();
```

### Restore Session

```javascript
const page = await connect({
  storageState: '.swiftbrowse/session.json'
});
await page.goto('https://example.com');  // Already authenticated
```

Exports: cookies + localStorage as JSON.

---

## API Reference: Page Handle Methods

All methods are async. Error handling:

```javascript
try {
  await page.click('nonexistent-ref');
} catch (err) {
  console.error(`No element found for ref "nonexistent-ref"`);
}
```

Refs expire after navigation. Always re-snapshot after `goto()` or `waitForNavigation()`.

---

## Tested Against

Real-world sites across 8 countries, all cookie consent dialogs dismissed, all interactions working:

Google, YouTube, BBC, Wikipedia, GitHub, DuckDuckGo, Hacker News, Amazon DE, The Guardian, Spiegel, Le Monde, El Pais, Corriere, NOS, Bild, Nu.nl, Booking, NYT, Stack Overflow, CNN, Reddit

---

## Performance Notes

- **Headless mode:** ~1-2s per page load + ARIA extraction. Lightweight.
- **Headed mode:** ~1-2s + user interaction time. Visual.
- **Hybrid mode:** Headless first, fallback adds ~500ms if bot-detected.
- **Batch crawling:** 50-100 pages/min depending on site and network.
- **Memory:** ~50-100MB per headless session. Headed mode shares browser memory.

---

## Architecture

```
URL → validate scheme
    → find/launch browser (chromium.js)
    → CDP WebSocket connection (cdp.js)
    → stealth patches (stealth.js, headless-only)
    → suppress permission prompts
    → extract + inject cookies (auth.js)
    → navigate, wait for load
    → detect + dismiss consent dialogs (consent.js)
    → fetch full ARIA tree (aria.js)
    → 9-step pruning pipeline (prune.js)
    → dispatch interaction events (interact.js)
    → agent-ready snapshot [ref=N]
```

11 modules, ~2,400 lines, zero dependencies.

---

## Error Handling

### URL Validation

```javascript
await browse('file:///etc/passwd');  // throws
await browse('javascript:alert(1)'); // throws
await browse('example.com');         // auto-prepends https://
```

Only `http://` and `https://` allowed.

### Navigation Timeout

```javascript
try {
  await page.goto('https://slow-site.example.com', 5000);  // 5s timeout
} catch (err) {
  console.error('Timeout:', err);
}
```

### Missing Elements

```javascript
try {
  await page.click('999');  // ref doesn't exist
} catch (err) {
  console.error('Element not found:', err.message);
}
```

Always re-snapshot after navigation before clicking.

---

## FAQ

**Q: Does swiftbrowse send data to third parties?**
A: No. It launches a local browser and communicates via CDP. No network calls except to the URLs you visit.

**Q: Can I use it with headless CI/CD?**
A: Yes. Headless mode works on Linux (tested on Fedora). Install Chrome or Chromium, no display needed.

**Q: How do I handle CAPTCHA?**
A: Use headed mode. Interact with CAPTCHA manually, then continue with the script.

**Q: Does it support JavaScript?**
A: Yes. All pages are fully rendered. JavaScript runs server-side (in the browser process), not in Node.js.

**Q: Can I use a proxy?**
A: Yes. Pass `--proxy=socks5://localhost:1080` or similar.

---

## License

MIT

---

## Related Projects

swiftbrowse is a focused browsing library. Pair it with an agent framework and you have a complete autonomous web agent.

| | [**swiftbrowse**](https://npmjs.com/package/swiftbrowse) | [**baremobile**](https://npmjs.com/package/baremobile) |
|---|---|---|
| **Purpose** | Web browsing (URL in, snapshot out) | Mobile automation (screen in, snapshot out) |
| **Replaces** | Playwright, Selenium, Puppeteer | Appium, Espresso, UIAutomator2 |
| **Modes** | Library, CLI, MCP | Library, CLI, MCP |
