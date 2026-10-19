# SwiftBrowse

Real browsers for agents. Navigate, interact through accessible element references, and extract structured data through JavaScript, the CLI, or MCP.

[![CI](https://github.com/saksham-loonker/swiftbrowse/actions/workflows/ci.yml/badge.svg)](https://github.com/saksham-loonker/swiftbrowse/actions/workflows/ci.yml)
[![Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

SwiftBrowse combines Chromium over CDP and Firefox over WebDriver BiDi with cross-platform browser discovery, cookie support, and structured extraction. It uses your installed browser, includes TypeScript declarations, and needs no runtime build step. Runtime dependencies are `ws` and Mozilla Readability; `wearehere` is optional.

## Get started

Requires **Node 22.13+** and an installed Chrome, Chromium, Brave, Edge, or Firefox. Browser discovery supports Windows, macOS, and Linux.

```sh
npm install swiftbrowse
```

```js
import { browse, connect } from 'swiftbrowse';

console.log(await browse('example.com', { incognito: true }));

const page = await connect({
  mode: 'headless', incognito: true,
  viewport: { width: 1280, height: 800 },
});
try {
  await page.goto('https://example.com');
  console.log(await page.snapshot({ mode: 'browse' }));
  console.log(await page.text());
  console.log(await page.links());
} finally {
  await page.close();
}
```

`browse()` and `connect()` share engine selection, cleanup, and navigation policy. Bare hostnames get HTTPS; use an explicit `http://` for local HTTP servers.

## Read, extract, interact

| Method | Result |
| --- | --- |
| `snapshot({ mode: 'act' })` | Compact interactive elements and `[ref=N]` action references |
| `snapshot({ mode: 'browse' })` | Links, headings, structure, and paragraphs |
| `snapshot({ mode: 'read' })` / `snapshot(false)` | Reading mode / unpruned accessibility tree |
| `readable()` | Article title, text, confidence, and fallback hint |
| `text({ maxChars: 12000 })` | Plain text, preferring main/article content |
| `extract('.price', { all: true })` | Text from matching elements |
| `extract('a.next', { attr: 'href' })` | Property/attribute value, or `null` if absent |
| `table('#results')` | `{ headers, rows }`, or `null` if no table matches |
| `links()` | `{ href, text }[]`, excluding JavaScript/data URLs |
| `screenshot({ selector: 'h1' })` | Cropped base64 image; a missing selector throws |

The page handle also supports `click`, `type`, `press`, `hover`, `select`, `scroll`, `drag`, `upload`, history navigation, reload, tabs, waits, PDF, state saving, and custom dialog handlers. Take a new snapshot after navigation before using references. `page.engine` and `page.capabilities` describe the current session; Chromium exposes `page.cdp`, Firefox exposes `page.bidi` and `page.context`.

## Session options

| Option | Behavior |
| --- | --- |
| `engine: 'chromium'` or `'firefox'` | Explicit engine; otherwise prefer Chromium and fall back to Firefox |
| `mode: 'headless'`, `'headed'`, `'hybrid'` | No window, visible launch, or visible retry on a detected challenge |
| `port: 9222` | Attach to an existing Chromium; close preserves that browser |
| `incognito: true` | Skip cookies and saved state, including explicit injection |
| `browser: 'firefox'` | Cookie source, independently of automation engine |
| `storageState: 'state.json'` | Load state on Chromium; incognito takes precedence |
| `viewport: '1280x800'` | String or `{ width, height }` object |
| `binary`, `userDataDir`, `proxy`, `downloadPath` | Launch and output configuration |
| `blockAds: false`, `blockUrls: [...]` | Configure ad/tracker blocking |
| `blockPrivateNetwork: true`, `uploadDir` | Private-host navigation checks and upload directory restriction |

One-shot browsing imports matching cookies when a readable profile exists. Persistent library sessions use `page.injectCookies(url)` explicitly; CLI/MCP navigation does this for you. Extraction depends on OS permissions and browser encryption. Modern Windows application-bound cookies require attaching to a logged-in browser instead of extracting its database.

Owned sessions remove browser processes, temporary profiles, and owned download directories on close. Caller-supplied profile/download directories are preserved. Windows force-termination cannot run JavaScript exit handlers; normal close cleans up the browser tree.

Local-resource/browser-internal navigation schemes are blocked by default. Private-network checking covers URL hostnames, not DNS resolution, redirects, or all subresources, so it is not a complete network isolation boundary. Authentication artifacts use owner-only POSIX permissions; Windows uses inherited filesystem ACLs. Firefox supports saving state but currently does not load `storageState`; its reload does not support ignoring the cache.

## CLI

```sh
npx swiftbrowse open https://example.com --incognito
npx swiftbrowse snapshot --mode=browse
npx swiftbrowse text --max-chars=12000
npx swiftbrowse extract h1
npx swiftbrowse links
npx swiftbrowse table '#results'
npx swiftbrowse screenshot --selector=h1
npx swiftbrowse close
npx swiftbrowse browse https://example.com --engine=firefox --incognito
npx swiftbrowse browse-batch https://example.com https://example.org --incognito
npx swiftbrowse browse-batch --file=urls.txt --mode=headless
npx swiftbrowse doctor
```

Session commands share a daemon and write to `.swiftbrowse/`. Commands authenticate with a per-session token; startup diagnostics go to `daemon.log`. Batch browsing reports every result and exits nonzero if any URL fails. Automatic cleanup removes only exact generated output filenames older than seven days and preserves saved login state.

Run `npx swiftbrowse` for the command reference. `npx swiftbrowse install --skill` installs the packaged agent skill.

## MCP and agent tools

```json
{
  "mcpServers": {
    "swiftbrowse": {
      "command": "npx",
      "args": ["-y", "swiftbrowse", "mcp"],
      "env": { "SWIFTBROWSE_INCOGNITO": "1" }
    }
  }
}
```

MCP includes snapshots, articles, `text`, `extract`, `table`, `links`, navigation, interaction, screenshots, PDF, tabs, and capabilities. Environment options: `SWIFTBROWSE_ENGINE=firefox`, `SWIFTBROWSE_MODE=headless`, `SWIFTBROWSE_IDLE_MINUTES` (default 15; 0 disables), and opt-in `SWIFTBROWSE_MCP_EVAL=1`. Legacy `BAREBROWSE_*` names remain accepted, with SwiftBrowse names taking precedence.

```js
import { createBrowseTools } from 'swiftbrowse/swiftagent';
const { tools, close } = createBrowseTools({ incognito: true });
// Pass tools to your agent loop, then await close() when finished.
```

`swiftbrowse/bareagent` remains a compatibility export of the same adapter.

## Development

```sh
npm ci
npm run typecheck
npm run build:types
npm run test:unit
npm run test:integration
npm run check:lockfile
npm pack
```

Default browser tests use local fixtures. Firefox suites skip when Firefox is absent. Public-site tests are opt-in with `SWIFTBROWSE_LIVE_TESTS=1`. CI checks Node 22/24 on Linux, Windows, and macOS and browser integration on Linux. Packing builds and includes declarations and the agent skill.

## History and license

SwiftBrowse is an independently maintained continuation of a BareBrowse fork. Version 0.24.0 merges all 144 commits through [BareBrowse 0.23.0, commit 25f0582](https://github.com/hamr0/barebrowse/commit/25f058214151b6d80f93c0724a533100949ee544), retaining upstream history and adding SwiftBrowse extraction, cross-platform, MCP, and reliability work.

The combined distribution is **Apache-2.0**. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the original MIT notice in [LICENSE-MIT](LICENSE-MIT). See [migration notes](docs/migration.md) and [CHANGELOG](CHANGELOG.md).
