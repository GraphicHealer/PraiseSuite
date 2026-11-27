# AGENTS.md — PraiseSuite contributor/agent notes

## Product direction

**Phase 1 is an OpenSong clone, not a redesign.** The goal is for PraiseSuite to
work and run almost identically to OpenSong — same window model, slide list,
editor layout, keyboard shortcuts, presentation behavior, print output — so
existing OpenSong users are immediately at home. The modernization is
underneath: the isomorphic core, Node server, web UI, offline-first storage,
and plugin framework are the future-forward backend that the eventual UI
redesign will build on. Implications:

- When behavior is ambiguous, **read the OpenSong source** (`../opensong_3.4.8`,
  Xojo) and match it — don't invent a "better" behavior.
- Fidelity to OpenSong beats polish: match its layouts, labels, key captions,
  and quirks (e.g. Esc is labeled "End", blank separator slides, the title
  style's `include_verse` gate) even when ours could be nicer.
- Deliberate naming deviations (do NOT "fix" toward OpenSong): the mode tabs
  are "Songs"/"Sets" (not "Song Mode"/"Set Mode") and the main nav entry is
  "Editor" (not "Song Editor") — Garrett's chosen names.
- Other deliberate differences (requested by Garrett — reviewers should not
  flag these as OpenSong mismatches):
  - Material Design icons on buttons/actions — OpenSong is text-only; ours
    keeps OpenSong's key captions (`[A]`, `[Esc]`) and `-♭`/`+♯` as text.
  - Dark/light theme toggle in the header — no OpenSong equivalent.
  - Two-column (`---`) print scales oversized lines to fit the half-width
    column; OpenSong clips at ColumnWidth instead.
  - Named-style library: the style picker lists a "Saved styles" group and
    StyleEditor has "Save As…" — OpenSong ships only default/scripture.
  - Web chrome: persistent top nav, sign-out — inherent to the web UI, not
    OpenSong's windowed model.
  - The "PraiseSuite print preview" banner at the top of print pages
    (`no-print` class) — a helper, not part of the printed sheet.
- New capabilities (plugin system, network receivers, web UI) belong in the
  architecture/extension seams, not as deviations in OpenSong-facing behavior.

## Commands

- `pnpm install` — install workspace deps
- `pnpm test` — run all package tests. `packages/core` runs twice: Node and `happy-dom` (portability check — do not skip the second run).
- `pnpm typecheck` — `tsc --noEmit` across packages
- `pnpm lint` — ESLint; `packages/core` has boundary rules forbidding Node APIs
- `pnpm -r run build` — full workspace build (web production build included)
- `pnpm -C apps/desktop dist` — stage + pack the desktop app with electron-builder → `apps/desktop/release/` emits `PraiseSuite-Setup-*.exe` (NSIS installer) and `PraiseSuite-*-portable.exe`. `pnpm -C apps/desktop stage` stages only. Releases publish via `.github/workflows/release.yml` on `v*` tags.

## Verification workflow

- After any change/addition: run `pnpm lint`, `pnpm -r run typecheck`, `pnpm test`, and `pnpm -r run build` **locally** before committing.
- After pushing, **check CI too**: `gh run list --limit 5` (and `gh run watch`/`gh run view --log-failed` to diagnose). Local green is not enough — keep CI green on every commit, not just milestone checkpoints.
- The desktop test instance: `pnpm -C apps/web build && pnpm -C apps/desktop dev`. Note: `ELECTRON_RUN_AS_NODE` must not be set in the launching shell, and the child server needs `node` on PATH (see `apps/desktop/src/main.mjs`). Packaged builds instead ship `resources/runtime/node.exe` (copied from the packaging machine's Node, matching the npm-installed better-sqlite3 prebuild ABI) and spawn `resources/server/app/server.mjs`.
- Portable exe data lives where the user picks on first run; the choice is stored (relative when under the exe dir) in `praisesuite-data-path.txt` next to the exe. Installed builds use `%APPDATA%/PraiseSuite/data`.

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
