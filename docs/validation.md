# Integration validation

Validated locally on Windows with Node.js v24.21.0 on 2026-10-19.

- Full `npm test`: **281 passed, 0 failed, 6 skipped**; 287 tests, 84 suites, about 157 seconds.
- Type checking and generated declaration build passed.
- Packed-package consumer passed strict TypeScript compilation, including negative checks for invalid engine/viewport options.
- Packed ESM imports and both agent compatibility exports passed a clean consumer smoke check.
- Package manifest verified: 75 files, including declarations, the installable skill, LICENSE, NOTICE, and LICENSE-MIT; no nested source checkout or test/scratch directories.
- `npm audit --omit=dev`: no reported vulnerabilities.
- Lockfile version matches package version 0.24.0.
- BareBrowse commit `25f058214151b6d80f93c0724a533100949ee544` is an ancestor of SwiftBrowse after the merge.

The full suite exercised real Chromium sessions, extraction, cropped screenshots, daemon authentication and malformed requests, incognito, attach mode, downloads, dialogs, iframe interaction, large accessibility payloads, browser cleanup, MCP recovery and idle release, and CLI installation diagnostics in isolated homes.

Firefox was not installed locally, so real Firefox suites were skipped. Its protocol-independent helpers and hybrid orchestration ran with fixtures. Public-site checks remain opt-in. POSIX mode-bit assertions are skipped on Windows because ACLs govern access. The CI matrix adds Node 22/24 and Linux/macOS checks; configuring it does not establish that those remote jobs have passed.
