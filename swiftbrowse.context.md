# SwiftBrowse integration context

SwiftBrowse 0.24.0 is an Apache-2.0 JavaScript ESM library for browser automation by agents. Requires Node 22.13+, an installed Chromium-family browser or Firefox, `ws`, and `@mozilla/readability`. No bundled browser or runtime build step. Read README.md and docs/migration.md for supported behavior.

## Entry points

- `swiftbrowse`: `browse(url, opts)` and `connect(opts)`, with generated TypeScript declarations.
- `swiftbrowse/swiftagent`: `createBrowseTools(opts)` returns `{ tools, close }`.
- `swiftbrowse/bareagent`: compatibility export of the same adapter.
- CLI: `swiftbrowse`. MCP: `swiftbrowse mcp` over newline-delimited JSON-RPC on stdio.

## Workflow

Connect, navigate, and snapshot to observe element references. Act through references, then take a fresh snapshot after navigation. For content use `readable()` or `text()`; for data use `extract()`, `links()`, or `table()`. Always close library sessions in `finally`; use `swiftbrowse close` for CLI sessions.

`browse` uses the same engine and cleanup as `connect`. Chromium uses CDP; Firefox uses BiDi. Check capabilities before raw protocol or engine-specific operations. Viewports accept strings and objects. Selector screenshots throw when no element matches.

## Authentication and lifecycle

Use `incognito: true` for unauthenticated work. One-shot browsing and CLI/MCP navigation import scoped cookies by default; persistent library sessions explicitly call `injectCookies`. Profile access and decryption depend on OS/browser support. Attaching with `port` is Chromium-only and preserves that browser on close. Owned resources are removed; caller-owned directories are preserved.

Artifacts live under `.swiftbrowse/`, with authenticated daemon commands and bounded logs. Old generated outputs are cleaned after seven days; saved state is preserved. Windows permissions use inherited ACLs. Private-host URL checking does not resolve DNS or inspect every network request.

## Development

Run `npm ci`, `npm run typecheck`, `npm run build:types`, `npm test`, `npm run check:lockfile`, and `npm pack`. Types are generated from JSDoc during prepack. Integration tests use local fixtures; public-site tests require `SWIFTBROWSE_LIVE_TESTS=1`. Missing Firefox is skipped.

BareBrowse history through v0.23.0 is preserved. Keep LICENSE, NOTICE, and LICENSE-MIT in redistributions.
