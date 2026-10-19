## Dev Rules

**POC first.** Always validate logic with a ~15min proof-of-concept before building. Cover happy path + common edges. POC works → design properly → build with tests. Never ship the POC.

**Build incrementally.** Break work into small independent modules. One piece at a time, each must work on its own before integrating.

**Dependency hierarchy — follow strictly:** vanilla language → standard library → external (only when stdlib can't do it in <100 lines). External deps must be maintained, lightweight, and widely adopted. Exception: always use vetted libraries for security-critical code (crypto, auth, sanitization).

**Lightweight over complex.** Fewer moving parts, fewer deps, less config. Simple > clever. Readable > elegant.

**Open-source only.** No vendor lock-in. Every line of code must have a purpose — no speculative code, no premature abstractions.

## Project specifics

- JavaScript ESM, Node >=22.13. No runtime build step.
- Chromium uses CDP; Firefox uses WebDriver BiDi. Runtime dependencies: ws and Mozilla Readability.
- Share extraction behavior in src/scrape.js and safety policies in src/url-guard.js.
- Keep swiftbrowse/swiftagent and swiftbrowse/bareagent compatible.
- Generate declarations with npm run build:types; never edit generated types/.
- Verify with npm run typecheck, npm test, npm run check:lockfile, npm pack.
- Default integration tests use local fixtures; live-site tests require SWIFTBROWSE_LIVE_TESTS=1.
- Preserve Apache-2.0 LICENSE, NOTICE and original LICENSE-MIT attribution.
- Current docs: README.md and docs/migration.md. Other product/log documents are historical reference.
