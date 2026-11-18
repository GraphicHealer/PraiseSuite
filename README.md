# PraiseSuite

An offline-first worship presentation and song management system — a modern successor to OpenSong.

**Status:** early development (milestone M0 — foundations).

## Documentation

- [Product Requirements Document](docs/Product_Requirements_Document.md)
- [Technical Architecture Specification](docs/Technical_Architecture_Specification.md)
- [Implementation Plan](docs/Implementation_Plan.md)

## Layout

```text
packages/core            Isomorphic domain core (Node, browser, Android WebView)
packages/api-contracts   Zod API contracts -> OpenAPI
infrastructure/          Database migrations, test fixtures, packaging
apps/                    (server, web, desktop — upcoming milestones)
docs/                    Specifications, plan, architecture decision records
```

## Getting started

Requires Node >= 22 and pnpm 10.

```bash
pnpm install
pnpm test        # all workspace tests (core runs in Node AND happy-dom)
pnpm typecheck
pnpm lint
```

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2025–2026 PraiseSuite contributors.
