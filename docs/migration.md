# SwiftBrowse 0.24 migration

This release integrates BareBrowse through `25f058214151b6d80f93c0724a533100949ee544` (v0.23.0). All 144 upstream commits are ancestors of the merge. The nested source checkout is excluded from the project and package; the integrated code needs no checkout of BareBrowse.

| Source | Integrated features |
| --- | --- |
| SwiftBrowse | Windows/macOS cookie handling, cross-platform browser discovery, text/selector/table/link extraction, selector screenshots, batch CLI, agent compatibility |
| BareBrowse | Firefox BiDi, iframe snapshots, Readability, blocklists, capabilities, downloads, attach mode, dialog controls, scoped cookies, authenticated daemon, lifecycle recovery, idle release, output cleanup, declarations |
| Combined improvements | Shared extraction across engines and MCP, consistent one-shot engine selection, viewport validation, Windows process-tree cleanup, bounded logs, safe daemon dispatch, correct batch parsing/exit codes, mapped-IPv6 guarding, declaration and skill packaging |

## Existing SwiftBrowse consumers

- Package/executable remain `swiftbrowse`, output remains `.swiftbrowse/`.
- `swiftbrowse/swiftagent` is primary; `swiftbrowse/bareagent` exports the same adapter.
- Snapshots start with `url: <current URL>`, including browser-canonical trailing slashes. Avoid parsing pruning statistics as a stable API.
- Headed mode launches a visible owned browser. Supply `port` to attach; close preserves an attached browser.
- A missing screenshot selector throws instead of silently capturing the full page.
- Batch browsing exits nonzero on any failure and no longer treats option values as URLs.
- Viewports accept strings and objects, with positive integer dimensions up to 16384.
- Runtime dependencies are `ws` and `@mozilla/readability`; `wearehere` is optional. Node 22.13+ is required for unflagged SQLite.
- The distribution is Apache-2.0. Preserve LICENSE and NOTICE when redistributing. The original MIT notice remains in LICENSE-MIT.

## Moving from BareBrowse

Change imports and commands to `swiftbrowse`. Rename MCP keys and environment variables to `swiftbrowse` and `SWIFTBROWSE_*`; legacy environment names are accepted during migration. Sessions in `.barebrowse/` are not reused. Output paths and authentication headers use SwiftBrowse's name.

Use capabilities before relying on raw CDP/BiDi or engine-specific features. Both engines share structured extraction. Firefox can save state but does not currently load `storageState` files.

## Validation and reference material

Follow the development commands in the root README. Default integration tests use local fixtures. Public-site checks require `SWIFTBROWSE_LIVE_TESTS=1`. Missing Firefox and POSIX permission checks on Windows are reported as skips.

Other product/log documents were inherited from BareBrowse and retained as historical reference. The current README, declarations, and tests define SwiftBrowse's supported behavior.
