# AGENTS.md — PraiseSuite contributor/agent notes

## Commands

- `pnpm install` — install workspace deps
- `pnpm test` — run all package tests. `packages/core` runs twice: Node and `happy-dom` (portability check — do not skip the second run).
- `pnpm typecheck` — `tsc --noEmit` across packages
- `pnpm lint` — ESLint; `packages/core` has boundary rules forbidding Node APIs
- `pnpm -r run build` — full workspace build (web production build included)

## Verification workflow

- After any change/addition: run `pnpm lint`, `pnpm -r run typecheck`, `pnpm test`, and `pnpm -r run build` **locally** before committing.
- After pushing, **check CI too**: `gh run list --limit 5` (and `gh run watch`/`gh run view --log-failed` to diagnose). Local green is not enough — keep CI green on every commit, not just milestone checkpoints.
- The desktop test instance: `pnpm -C apps/web build && pnpm -C apps/desktop dev`. Note: `ELECTRON_RUN_AS_NODE` must not be set in the launching shell, and the child server needs `node` on PATH (see `apps/desktop/src/main.mjs`).

## Non-negotiable rules (from the architecture spec)

1. `packages/core` is **isomorphic**. No `node:*` imports, no `process`/`Buffer`/`__dirname`, no browser-only globals (no `window`/`document` in core). Environment services (clock, ids, storage, files, crypto) come through `src/ports` injected interfaces.
2. The UI never talks to storage or the network directly — only through the application-layer command/query contracts and a transport (`local` in-process or `remote` HTTP/WS).
3. Chords are stored as offset-anchored annotations on lyric lines. OpenSong dot notation is an import/export view only.
4. Never synchronize displays by slide number — musical position is `sectionId` + `sectionInstanceId`.
5. Timestamps never decide sync conflicts; revision chains do.
6. Stored content uses storage keys / relative paths, never absolute filesystem paths.

## Conventions

- TypeScript `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; `verbatimModuleSyntax` (`import type` for types).
- ESM everywhere (`"type": "module"`).
- IDs are UUIDv7 generated through the `IdGenerator` port.
- Tests live in `test/` next to each package's `src/`.
- Spec docs govern: `docs/Product_Requirements_Document.md`, `docs/Technical_Architecture_Specification.md`, `docs/Implementation_Plan.md`. Record settled technical decisions as short ADRs in `docs/decisions/`.
- OpenSong reference source for importer work: `../opensong_3.4.8` (Xojo); real fixtures copied to `infrastructure/fixtures/opensong-defaults/`.
