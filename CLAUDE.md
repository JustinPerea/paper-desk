# paper-desk

Public repo: eve Builder Challenge entry. Read `README.md` for what the code does and `implementation-notes.md` for decisions and arXiv HTML quirks.

## Commands

```bash
npm ci --ignore-scripts
npm test          # node:test via tsx
npm run typecheck
```

## Rules

- This repo is public. Nothing private goes in: no personal notes, no local paths, no content from private repos, no keys.
- Fixture papers must be CC BY (or another license that allows redistribution). Check the license on the arXiv abstract page and list title, authors and license in `test/fixtures/README.md`.
- The verifier is the safety boundary. A model-written field is never trusted to vouch for itself (the paper identity comes from the parsed page, not the record).
- Pin exact dependency versions in `package.json` and install from the lockfile; never let `npx` fetch a package that isn't in local `node_modules`.
- Nothing is posted or published without Justin's approval.
- Keep `implementation-notes.md` current during non-trivial work.
