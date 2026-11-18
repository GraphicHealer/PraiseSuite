# PraiseSuite Implementation Plan

**Document status:** Draft for review
**Version:** 0.2
**Revision (0.2):** Milestones reordered per owner direction — the initial release must reach full OpenSong feature parity (a complete OpenSong replacement) before new capabilities beyond OpenSong are built. Structural prerequisites (session architecture, shared layout engine) still land wherever they are needed earliest.
**Basis:** Product Requirements Document v1.1 and Technical Architecture Specification v1.1 (both in this folder)

This plan translates the two specification documents into a concrete repository structure, tooling choices, milestone sequence, and validation checklist. It records decisions already made and lists the remaining items that need an owner decision before they block work.

---

## 1. Locked Decisions

| Decision | Outcome | Consequence |
|---|---|---|
| Project name | **PraiseSuite** | Both spec documents updated from "To be determined". |
| Desktop shell | **Electron**, committed (no Tauri bake-off) | Section 19 item 1 closed. Multi-display/PDF prototype still required to validate the assumption. |
| Distribution | **Open source, attribution required, future hosted option allowed** | License recommended below (Section 8.1). |
| Importer test data | **Bundled `OpenSong Defaults` library** from opensong_3.4.8 + generated edge cases | 27 real song files, an example set, and real settings files ship with the OpenSong source; copied into the repo as test fixtures. |
| Version control | **git, local for now** | Remote host (GitHub or other) still open. |
| Fonts | **Bundled open-license font set; OpenSong font names mapped, never shipped** | See font strategy below. |
| Scripture source | **API.Bible (American Bible Society) as primary; HelloAO free-use API as no-key/bulk fallback; OpenSong Bible XML import supported** | See scripture strategy below. |

### Scripture strategy

The **industry-standard open Scripture API is API.Bible** (`rest.api.bible`), operated by the American Bible Society: one JSON response shape across hundreds of translations (NIV, NLT, NKJV, NASB, CSB, plus hundreds of open-access Bibles in many languages). It requires a free API key and returns content in its JSON schema — that schema is the primary provider format our scripture layer targets.

- **Canonical model:** BibleTranslation -> Books -> Chapters -> Verses, with USFM book codes and per-translation license/copyright metadata. Imported/ downloaded translations are cached in the local database so presenting scripture works fully offline.
- **Provider adapters:** `api-bible` (primary — API key, JSON), `helloao` (bible.helloao.org — no key, no rate limits, bulk JSON/SQLite downloads; ideal for full-translation offline downloads), `opensong-xml` (import OpenSong Bible XML files for migration parity). OSIS/USX import is a later adapter if needed.
- **Licensing:** every translation's `licenseNotice`/copyright must be displayable with presented scripture; the data model carries it and the projector can render it. API.Bible terms require attribution; some translations carry additional usage restrictions, which the UI surfaces at download time.

### Plugin and store strategy

Terminology: we call them **plugins** (the store-facing synonym "extension" may appear in UI copy). Model follows the Falcon Player (FPP) plugin ecosystem, which the owner knows well and maintains plugins for — see `FauxLite-FPP/fpp-plugin-Template` and `fpp-plugin-FauxLite` locally.

- **Standard plugin layout.** Each plugin lives in its own public GitHub repo with a `pluginInfo.json` manifest at the root declaring: unique `repoName`/ID, name, author, description, `homeURL`/`srcURL`/`bugURL`/`iconURL`, **`installScope`** (see below), `versions[]` (min/max PraiseSuite version -> branch/SHA, so updates are pinned per app version), `dependencies`, **required permissions** (extension points used, API scopes, network access, file access), and a **privacy disclosure block** (what the plugin sends/collects/senses/changes — required for listing, rendered in the install dialog, FPP-style).
- **Install scope.** Every plugin declares one of three scopes:
  - `shared` (**default**) — affects content or the data model (e.g. a new media type, a new slide kind, a scripture provider whose output is stored). Required on every installation that consumes the content. A desktop client connecting to a server that has shared plugins it lacks must resolve the gap (see below).
  - `desktop` — client-side only: output adapters (e.g. NDI), device integrations, local automations. May also be installed on a server, but a client connecting to that server is never required to have it.
  - `server` — server-side only: external API integrations, scheduled jobs, import pipelines. Clients connecting to the server are unaffected.
- **Shared-plugin reconciliation on connect.** When a client connects or syncs to a server, the server advertises its installed `shared` plugins (ID + version). The client compares against its own set and must: install/upgrade to a version compatible with both the app version and the server (resolved through the plugin's `versions[]` ranges), or explicitly decline — in which case content requiring the missing plugin is flagged/unavailable rather than silently mis-rendered. Plugin installs triggered this way still go through the store path (manifest + pinned SHA), never blind code transfer from the server.
- **Required UX.** A blocking dialog appears on connect/sync when a shared plugin is missing: it names the required plugin(s) and offers install/upgrade before sync proceeds. If sync runs anyway (or was declined), a post-sync report states exactly which and how many items failed ("3 items require plugin X") — nothing fails silently. If the current user lacks permission to install plugins (e.g. a read-only or guest account), the dialog says so and that an administrator must install it, instead of offering an install button that would fail.
- **Store = registry repo.** A dedicated GitHub repo (`praisesuite-plugins` or similar) holds the plugin index (`pluginList.json`). Authors submit a PR; CI scans the submission (manifest schema validation, permission audit, banned-API/pattern checks, license presence, privacy-block completeness); an admin approves and merges. The store lists only a link to the author's repo — plugins are never vendored or re-hosted.
- **In-app plugin manager.** Three sections like FPP's: Installed / Available / Incompatible (per `versions[]` ranges). Install = fetch the repo at the manifest-pinned branch/SHA for the running app version; update = move to newer pinned commit; uninstall removes cleanly.
- **Security tiers still apply** (TAS 14.2): store listing is a curation signal, not a trust grant. Web plugins run sandboxed with only their declared permissions; native-side plugins are trusted in-process code and flagged as such in the store. The manifest permission declarations are enforced at runtime, not just displayed.
- **NDI output is an explicit future plugin example** — not part of the base application.
- The first-party `pluginInfo.json` schema + `PLUGIN_GUIDELINES` doc are written when the plugin runtime lands (M13); the registry repo can be created any time after the public git remote exists.

### Font strategy

OpenSong styles reference old platform font names (`System`, `SmallSystem`, `Helvetica`, `Arial`, `Courier New`). Those font files are not shipped or referenced; instead:

- The rendering engine resolves fonts through named **font roles** (projector body, title, subtitle, chords, capo chords, UI, fixed-width) mapped to a family plus an explicit fallback stack.
- Default bundled set (all SIL OFL or similarly licensed, embedded in the app so every platform renders identically): **Inter** for projection/UI body, **Liberation Sans** as the metric-compatible substitute for `Arial`/`Helvetica` in imported styles, **JetBrains Mono** for the source editor and fixed-width output.
- Import maps OpenSong font names to the bundled set (`System`/`SmallSystem`/`Helvetica`/`Arial` -> Liberation Sans/Inter, `Courier New` -> JetBrains Mono); unknown names fall back to the role default.
- Fonts are modeled as selectable assets with per-style overrides, so a future font picker and user-supplied font uploads slot in without a model change.

## 2. Reference Material in Hand

The `opensong_3.4.8` Xojo source tree (in `..\opensong_3.4.8`) is the authoritative reference for the file formats and behavior the importer must match:

- `Classes/XML Helpers/SongML.xojo_code` — canonical song parsing and rendering rules: `.`-prefixed chord lines aligned by column, `1`-`9` column-qualified chord lines, `;` comment lines, `[V1]`/`[C]`/`[B]`/`[P]`/`[T]` section tags with optional parameters (e.g. bilingual `L` flags), `|` and `||` slide-break markers, `__` syllable-extension underscores, `<presentation>` section-order field.
- `Classes/XML Helpers/SetML.xojo_code` — set format: `slide_group` entries of type `song` (by-name reference), `custom` and `scripture` (inline slides), with titles, subtitles, notes, loop/timing attributes.
- `OpenSong Defaults/` — real fixtures: 27 songs with varied arrangements, `Sets/Example`, `Settings/` (MainSettings, PresentSettings, PrintSettings, Globals), `Backgrounds/`.
- `OpenSong Scripture/` — Bible XML format for the later scripture provider.

Format details that matter for the canonical model:

- Chord placement is column-aligned text on `.` lines; import converts column position to a character offset in the following lyric line (TAS 8.4). Multi-space runs inside lyric text are meaningful for alignment and must be handled carefully.
- `|` inside a lyric line and `||` mark slide splits; `blank_is_slide_change` in PresentSettings also makes a blank line a slide boundary. The importer must preserve these as explicit break markers.
- `<presentation>` is a space-separated section occurrence list (e.g. `V1 C V2 C`) — this maps directly to `SongArrangement` + `ArrangementSection` with section-instance identity.
- `<capo print="">`, `<tempo>`, `<timesig>`, `<theme>`/`<alttheme>`, `<user1-3>` map to song metadata; `user1-3` get labeled fields via MainSettings `user_defined` attributes.

## 3. Repository and Tooling

Single git monorepo. Choices follow TAS Section 2.

| Area | Choice | Notes |
|---|---|---|
| Package manager | pnpm workspaces | Fast, standard monorepo support. No build orchestrator until needed. |
| Language | TypeScript, `strict` everywhere | Shared `tsconfig.base.json`; separate configs per runtime (DOM vs Node). |
| Frontend | React + Vite + Tailwind CSS | Accessible components via Radix UI or React Aria (decide at M4). |
| Desktop shell | Electron + electron-builder | Thin shell; server runs as a child process (TAS 3.4). |
| Client DB | better-sqlite3 (Node/Electron) | Behind repository interface; `electron-rebuild` in desktop packaging. |
| Server DB | PostgreSQL via drizzle-orm | Second repository implementation, server deployments only. |
| Schema/migrations | drizzle-kit | One schema definition generates SQLite and PostgreSQL dialects. |
| API contracts | Zod schemas -> generated OpenAPI | Single source for validation, docs, and client types. |
| Tests | Vitest | Core suite runs twice: `node` environment and `happy-dom` environment (portability check, TAS 17.8). |
| Lint | ESLint + import-boundary rules | Forbids `node:*` imports and environment globals inside `packages/core`. |
| IDs | UUIDv7 | Time-ordered, stable, generated through an injected `IdGenerator` port. |

## 4. Monorepo Layout

Consolidated version of TAS 3.2 — fewer packages than the spec diagram, per its own note that implementation may combine packages initially. Split only when a real second consumer appears.

```text
praisesuite/
  package.json                    (workspace root, private)
  pnpm-workspace.yaml
  tsconfig.base.json
  LICENSE                         (see Section 8.1)
  AGENTS.md                       (build/test commands for agents)
  docs/
    Product_Requirements_Document.md
    Technical_Architecture_Specification.md
    Implementation_Plan.md        (this file)
    decisions/                    (short ADRs as Section-19 items close)

  packages/
    core/                         (ISOMORPHIC — no Node APIs, no DOM assumptions)
      src/
        domain/
          songs/                  Song, SongSection, offset-anchored chords
          chords/                 parse/format/transpose/capo/enharmonic
          arrangements/           section instances, presentation order
          services/               Service, ServiceItem
          sessions/               PresentationSession, musical position
          permissions/
        application/
          commands/               command contracts + handlers
          queries/
        rendering/
          lyrics/  chord-sheets/  display/
        import/
          opensong/               SongML-compatible parser -> canonical model
          openlyrics/             (stub contract, implemented later)
        export/
          opensong/
        sync/
          protocol/               revision vectors, merge rules (contracts first)
        ports/                    injected interfaces: clock, ids, crypto, storage, files
    storage-sqlite/               better-sqlite3 + drizzle impl of repository ports (Node only)
    api-contracts/                Zod schemas, OpenAPI generation, typed client

  apps/
    server/                       Node HTTP (REST v1) + WebSocket; serves web build
    web/                          React UI (also the receiver page at /receiver)
    desktop/                      Electron shell: window mgmt, child-process server, displays
    receiver/                     (later: thin dedicated receiver build if needed)
    android/                      (Phase 5: Capacitor wrapper + Kotlin plugins)

  infrastructure/
    database/migrations/          drizzle migrations
    fixtures/opensong-defaults/   the 27 songs + Sets/Example + Settings (importer fixtures)
    packaging/
      portableapps/               (Phase 4)
      docker/                     (Phase 4: Dockerfile + compose)
```

Key rule enforced by lint + the dual-environment test run: `packages/core` imports nothing from `node:*`, touches no globals that don't exist in a browser, and receives all environment services through `ports/`. `storage-sqlite` and everything in `apps/` may use platform APIs freely.

## 5. Milestones

Sequenced per TAS Section 20, restructured per owner direction: **M0–M9 deliver a complete OpenSong replacement** — every feature OpenSong 3.4.8 ships that the PRD keeps in scope — **before milestones on capabilities beyond OpenSong**. Structural pieces the specs require anyway (session architecture with section-instance position, the shared layout engine, the transport abstraction) land wherever they are needed earliest; that is a code-structure concern, not scope creep.

The parity inventory comes from the opensong_3.4.8 source. Anything OpenSong does that this product intentionally exceeds (e.g. its single presentation, its basic stage monitor) is noted; everything else is in the M0–M9 bar.

### M0 — Foundations
- git init; LICENSE (AGPL-3.0-or-later); README; AGENTS.md (build/test/lint commands)
- pnpm workspace, TypeScript configs, ESLint (with core-boundary rule), Vitest with dual environment
- `packages/core` skeleton: entity types with UUIDv7 IDs, revision model, ports interfaces
- `packages/api-contracts` skeleton
- GitHub Actions CI (or equivalent) once a remote exists

**Done when:** `pnpm test` runs the core suite in both environments; a demo command handler round-trips through the local transport.

### M1 — Chord engine + OpenSong importer *(highest-risk first, per TAS 18)*
- Chord model: `{root, quality, extensions, alterations, bass, display, raw}`; parse, format, transpose, enharmonic spelling, capo-aware display
- Canonical section content: lines of `{text, chords: [{offset, chord}]}`
- OpenSong importer: file + folder + zip input; SongML-compatible lyrics parser (section tags, `.` chord lines -> offsets, `|`/`||` breaks, `;` comments, bilingual `L` flags, `<presentation>` -> default arrangement)
- Staged import pipeline per PRD 5.2: analyze -> preview -> validate -> duplicate detection -> report
- Duplicate detection: normalized title+author, CCLI, normalized-lyric shingle similarity (TAS 9.7)
- Set import: `song` groups link to imported songs; `custom`/`scripture` groups become service items
- Round-trip exporter (OpenSong out) for validation

**Done when:** all 27 bundled songs + `Sets/Example` import losslessly on assertable fields; chord positions verified against rendered output; synthetic edge cases (irregular spacing, CRLF, missing fields, exotic chords) pass.

### M2 — Storage
- Repository interfaces in `core/ports`; `storage-sqlite` implementation (drizzle schema, migrations, FTS5 song search)
- Media asset store: filesystem backend, stable storage keys, checksums
- Single-writer lock file + conservative journal mode options (portable-ready, TAS 9.6)

**Done when:** imported library persists, reloads, and searches correctly through repository interfaces only.

### M3 — API + server
- REST v1 (versioned) + WebSocket scaffold from Zod contracts; OpenAPI doc generated
- Local auth (single admin) + session-scoped guest-token shape per TAS 13.3
- LAN binding toggle with clear enable/disable + address display (TAS 15.3)

**Done when:** `apps/server` serves the API and the built web app; WS channel delivers session-scoped messages. (Supersedes OpenSong's REST remote on day one — same surface, better contract.)

### M4 — Web UI foundation
- App shell (responsive, dark/light), library browser with FTS search, song folders/categories
- Song source editor (CodeMirror 6, OpenSong-notation highlighting) on canonical data
- Basic visual editor (sections, lyric edit, chord insert/move/remove)
- Service planning: create/duplicate/reorder services, pick arrangements, custom slides, notes

**Done when:** a user can import, edit, and plan a service entirely in the browser against `apps/server`.

### M5 — Presentation engine + Electron desktop *(baseline present-and-control)*
- Session model: session -> items -> musical position (section + section-instance IDs), persisted recovery state — architected for multiple sessions even though parity needs only one
- Output adapters v1: desktop window (Electron fullscreen borderless per monitor) + browser receiver page (`/receiver`, WS client)
- Remote control surface in the web UI (next/prev/jump/blank) with control-ownership rules
- Electron shell: child-process server, display enumeration/assignment, firewall-prompt detection

**Done when:** import -> edit -> plan -> present on second display -> join from phone browser -> remote control -> restart without data loss.

### M6 — Parity: presentation completeness
- Slide styles (title/body/subtitle font, color, align, border, shadow, fill, auto-scale) with per-slide and per-group overrides — imports PresentSettings/PrintSettings, with font names routed through the font-resolution map (see font strategy above; OpenSong's font files are never used)
- Image backgrounds, logo + logo mask, per-verse backgrounds; announcement loops with timing; transitions
- Blank/freeze/logo modes, alert message overlay, descriptive vs. song subtitles
- Basic stage/confidence view (supersedes OpenSong's stage monitor)

### M7 — Parity: scripture + media
- Scripture per the scripture strategy above: canonical Bible model + provider adapters (`api-bible` primary, `helloao` bulk/no-key fallback), OpenSong Bible XML importer, scripture picker, inline scripture slide groups in services, copyright/license notice carried into rendered output
- Media playback: video/audio files and animated/video backgrounds via HTML5 in the output window (replaces OpenSong's VLC bridge)
- Image sets; external presentation hosting (PowerPoint/OOo Impress) evaluated — niche feature, candidate for deferral note rather than the parity bar

### M8 — Parity: print + export suite *(shared layout engine built here, once)*
- Shared HTML/CSS layout engine (TAS 7.3) driving screen, print, and PDF
- Chord sheets, lyrics sheets, lead sheets, set lists, songbook/TOC reports; transposition and capo-aware print
- PDF export via Chromium `printToPDF`; HTML export (parity with OpenSong's exporter)

### M9 — Parity: library operations + misc
- Song folders, theme/alttheme categories, user-defined fields (user1-3 with MainSettings labels)
- Activity log / song usage history (parity with `Entities/ActivityLog`)
- CCLI metadata fields and reporting basics
- Transpose/key editing completeness; language/i18n plumbing (translations as data)
- NDI output: **decided — not in the base app.** Becomes a plugin once the plugin system exists (see plugin strategy).

**M0–M9 = the initial release: a complete OpenSong replacement that also imports everything a user has.** This is the expanded reading of PRD Section 17 — the 10 criteria are a subset, not the whole bar.

### Beyond parity — new capabilities (PRD phases reordered under this directive)
- M10 — Sessions and musician experience: multiple simultaneous sessions, multiple outputs per session, musician displays, instrument profiles, follow/hybrid navigation, QR/session-code joining, guest access (PRD Phase 2)
- M11 — Sync + deployment: bidirectional sync with conflict resolution, headless server + Docker Compose + PostgreSQL, Windows portable package (PortableApps.com), backup/restore archive (PRD Phase 4)
- M12 — Android app (PRD Phase 5)
- M13 — Extensions and integrations: public plugin API + `pluginInfo.json` manifest schema, plugin store (registry repo + PR submission + CI scanning + in-app manager per the plugin strategy), NDI as an early plugin, additional import/export formats, optional Cast adapter, additional backup destinations (PRD Phase 6)
- M14 — Hosted and organizational features (PRD Phase 7)

Each later phase gets its own short plan when it becomes the active milestone; the specs govern until then.

## 6. Remaining Prototype Validations (TAS Section 19)

Electron commitment removes the shell bake-off, not the underlying risks. Schedule these inside the milestones above:

| # | Validation | Milestone | Why early |
|---|---|---|---|
| P1 | Multi-monitor fullscreen + video + `webContents.printToPDF` in Electron | M5 | Validates projector output and the print/PDF strategy on one stack |
| P2 | SQLite journal modes on exFAT/NTFS removable media | M11 | Portable-mode corruption risk |
| P3 | WS session with reconnects across LAN drops | M3/M5 | Session reliability is a core promise |
| P4 | Android secondary display + cleartext/mixed-content | M12 | Per-device variance (defer until Android phase) |

Closed: shell choice (Electron), core portability rules (Section 4 lint/tests), chord storage model (offsets, validated in M1), casting strategy (OS displays + receivers first), sync model (object revisions, section-level merge, no CRDTs), plugin sandboxing (deferred).

## 7. Test Strategy Anchors

- `packages/core` tests run under `node` **and** `happy-dom` in CI — this is what catches a Node-only dependency sneaking into the shared core.
- Importer fixtures live in `infrastructure/fixtures/opensong-defaults/` (copied from `OpenSong Defaults`) plus generated edge-case files committed alongside.
- Round-trip property tests: canonical model -> OpenSong export -> re-import -> compare.
- Presentation tests at M5+: multi-session, repeated-section instances, follow/hybrid navigation, reconnect — all scripted against the session manager before UI polish.

## 8. Open Items for the Owner

1. ~~License.~~ **Decided: AGPL-3.0-or-later.** Strong copyleft with a network-use clause, so hosted forks must publish source; attribution notices can be required under Section 7(b).
2. **Git remote.** GitHub? Create the remote when ready; until then the repo is local-only.
3. **Publisher domain.** PortableApps third-party AppID is `PraiseSuite.<your-domain>` — needed at M11, placeholder until then. Related: code-signing certificate for Windows builds.
4. **CCLI/SongSelect.** Any integration is subject to CCLI licensing; flagged now because it shapes the "online metadata retrieval" roadmap, not because it blocks anything.
5. **Android folder import scope.** TAS 19.16 — decide at M12 whether first Android release is zip-only.
6. **API.Bible key.** Needed at M7. Registration is free; the key belongs in user settings (or a built-in default — their terms should be checked before embedding one).

## 9. Definition of Done for This Plan

You approve the milestone sequence and the license direction, then M0 begins. Any decision above can change a milestone's contents but not its position in the sequence.
