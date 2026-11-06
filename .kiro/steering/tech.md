# Tech

## Stack
TypeScript 5, Node 22+ (developed on 26), pnpm workspaces. Packages are consumed as TypeScript source (tsx, Vitest, Vite). No build step for packages.

| Layer | Choice |
| --- | --- |
| API | Fastify 5 + zod, SSE for live events |
| Events | DuckDB (`@duckdb/node-api`), file `data/crypt.duckdb` |
| App state | SQLite through built-in `node:sqlite` (loaded with `createRequire`, Vite strips the `node:` prefix) |
| AI | Amazon Bedrock Converse or Anthropic API behind one `LlmClient` interface; none = regex-only |
| RPA | Playwright (Chromium), `pdf-parse@1.1.4` (deep import `pdf-parse/lib/pdf-parse.js`) |
| Legacy mock | Express 5 app `apps/rxterm98` |
| Web | React 18, Vite 7, React Router (hash), TanStack Query, `@zxing/browser`, `bwip-js` |
| Tests | Vitest 3 + fast-check |

## Monorepo rules
- Workspace package names are `@bsrx/<name>`; each exports from `src/index.ts`.
- `apps/api/src/types.ts` is the wire contract. `apps/web/src/lib/types.ts` is a verbatim copy. Change both.
- Pin exact dependency versions. No ranges.
- Packages must not import from apps. Only `apps/api` composes the organs.
- Requirement IDs (COR-3, TRK-1 ...) appear in tests and commit messages: `TRK-3: add orphan-serial check`.

## Commands
- `pnpm install` then `pnpm seed` (crypt + fax PDFs), `pnpm dev` (rxterm98, api, web)
- `pnpm test` (all Vitest), `pnpm typecheck`, `pnpm build:web`, `pnpm labels`

## Environment
See `.env.example`. Secrets never go in the repo. `LLM_PROVIDER=none` is a supported, tested mode.
