# Meetless architecture (v3)

Status (2026-11-25, branch `v3`): the v3 design (`docs/superpowers/specs/2026-11-24-meetless-v3-design.md`)
is built. That covers every page of the v3 prototype, real multi-client sync, invite-code accounts, MCP over
HTTP for Claude Code and Codex, OnlyOffice read-only viewing with a LibreOffice fallback, and an unsigned
macOS arm64 build. The project agent, need detection, dashboard cards and suggestions are **rule-based**.
Meetless makes no model calls (see "What is simulated" below).

The binding documents are the design doc, the contract (`docs/superpowers/plans/2026-11-24-v3-contract.md`,
which has the interface names as built in §12) and the UI prototype (`design/claude-design-v3/`). This file
is the map. The v2 architecture (PRD v0.4, PR-style changes, review agents) is in git history before
`d868e05`.

## 1. Story

A need comes in (an imported file, Markdown written in the app, or a chat paste). Rules detect needs,
revisions, hypotheses and actions, and each detected item waits in 「待确认」 (To confirm) until a person
accepts it. People work around artifacts, hand needs to each other, and have their own agents pull live
context and report progress over MCP. A delivery closes a round, freezes the delivered items and records
each need's status. Feedback becomes new input.

The unit of collaboration is a person. The project has one shared, rule-based project agent.

## 2. Layout

```
apps/server        Fastify + ws sync service: Postgres event log, accounts, HTTP API, MCP route, blobs,
                   import extraction, PDF text, LibreOffice worker client, OnlyOffice tickets
apps/desktop       Electron main + preload (narrow IPC bridge), React renderer, dev bridge host,
                   Playwright e2e (e2e/), Electron-under-Xvfb check (e2e-electron/run.mjs)
packages/core      event-sourced domain: types, events, reducer, scope (privacy), queries, search,
                   detect (rules/1), dashboard, agent (rules), context (need context markdown)
packages/api       shared HTTP/MCP contract: API_ROUTES, request/response types, MCP tool names
packages/client    ClientNode: sync engine, outbox, node:sqlite cache, capture (git, Overleaf, Notion MCP)
packages/i18n      zh-CN and en catalogues (complete; a test enforces parity) + typed translator
packages/sample    the prototype's two projects (paper, Atlas) as real core commands, labelled 「样例数据」
skills/meetless    SKILL.md for Claude Code and Codex
design/claude-design-v3   the v3 prototype, verbatim
infra/dev          meetless-pg, meetless-office (LibreOffice), OnlyOffice + relay, Xvfb Electron container
scripts            dev stack (dev.mjs), block isolation table (blocks.mjs)
```

pnpm 12 workspace, TypeScript strict (`noUncheckedIndexedAccess`), vitest, Playwright. Packages export
their TS sources. `packages/core` compiles without Node types, so the renderer can use it.

## 3. Domain (`packages/core`)

- **Events.** The log is append-only. The server assigns `seq`; the client mints event ids, so a retried
  command is a no-op. The 43 event types are frozen (`FROZEN_EVENT_TYPES`, contract §2). `memory.*` is
  reserved and unused.
- **Reducer.** It holds the rules: only the person who sent a handoff can confirm it done, conflicts have
  three outcomes, a private source blocks sharing, and so on. A refused command throws `DomainError` with a
  code that the UI translates.
- **Needs.** There are two kinds: external needs (todo, doing, met, partial, moved, dropped) and own
  hypotheses (untested, testing, held, refuted, parked). Each need has a source (quote and where it came
  from), revisions, an owner, a round, a parent and a private flag. Context version = 1 + revision count.
- **Handoffs.** sent, then accepted, asked or declined, then doing, returned and done. The recipient's
  agent fetches a context version, which is recorded. A later revision makes that version stale; 「提醒刷新」
  asks the recipient to refresh.
- **Privacy (`scope.ts`).** Each event has a scope `(projectId, privateTo)`. The server filters every read
  by membership and scope: the event stream, context, search, MCP tools, blobs and dashboards. Private
  items never leave their owner. Shared items that cite private ids give `NOT_FOUND` on lookup (contract §12.9).
- **Work.** An agent report (`via` claude-code or codex) counts as progress. A capture by the project agent
  (git, Overleaf, Notion, uploaded documents) is marked 「捕获 仅供参考」 and never counts.

## 4. Server (`apps/server`)

- **Store.** `PgEventStore` (one schema per instance) holds the event log, blob metadata, derivations and
  accounts. Blobs are content-addressed files in the data dir. On open, the server replays the log and
  checks every stored scope. An old or foreign schema is refused with the seq and a "reset it" hint; it is
  never migrated silently.
- **Accounts (design §8.7).** On first start the server writes a one-time admin invite to
  `<dataDir>/admin-invite.txt` (mode 0600) and prints it. Project invites are one-time and can carry a role.
  Redeeming one registers a user and returns a personal token. There are no passwords. Personal and agent
  tokens are stored only as hashes and can be revoked. Dev tokens (`dev-<name>`) work only with
  `MEETLESS_DEV_AUTH=1`, which is refused when `NODE_ENV=production`.
- **Rate limits.** Only failures count: 10 failed sign-ins per 5 min and 10 failed redemptions per
  10 min, per client IP. A valid token always passes. Over the limit, the answer is `429 RATE_LIMITED`
  with `retryAfter`.
- **HTTP API.** The routes are in `packages/api/src/routes.ts`: me, invites, tokens, agent calls, agent
  setup and guide, input import, office config, need context, and the agent-only reads and writes used by
  MCP.
- **MCP.** `POST /mcp` is Streamable HTTP, stateless, through the official SDK in the server process, and
  authenticated with an agent token. Each tool runs an API route (`MCP_TOOL_ROUTE`), so privacy filtering,
  `via` and the fetched-version record are the same as over HTTP. Every call lands in the agent call log.
  See `docs/MCP.md`.
- **Imports.** Upload, then blob, then text extraction (txt, md, docx, pdf), then rules detection
  (`detector: "rules/1"`). Detected items go to 「待确认」.
- **PDF text.** A worker writes each page of an artifact version's text to `derived.texts`, so the project
  agent can cite a page.
- **Office.** LibreOffice (`meetless-office`) renders page images for the fallback preview. OnlyOffice
  DocumentServer (`meetless-onlyoffice`, read-only, JWT) fetches files through the relay
  `meetless-onlyoffice-files`. The relay reaches the server only through a Unix socket
  (`<dataDir>/office-sock/files.sock`) that serves signed tickets, so the TCP listener never serves office
  files.

## 5. Desktop (`apps/desktop`)

- **Main process.** `ClientNode` from `packages/client` keeps the session, a node:sqlite cache of accepted
  events, the outbox and the resume cursor, and pushes over WebSocket. The renderer has no Node; it talks
  through `window.meetless` (`BRIDGE_METHODS`). The main process writes a rotating file log, without
  tokens.
- **Dev bridge host** (`src/bridge-host`). It runs the same `ClientNode` in a plain Node process over HTTP,
  so two clients can run in two browser tabs (development and Playwright).
- **Renderer.** It follows the v3 prototype: grey sidebar (New input, 「我的」, project tree with eight
  views, Agents, user row with 中/EN), top bar (project, members, 「待确认」), the project agent composer
  at the bottom of every page, drawers and overlays. Folders: `shell`, `dash`, `chat`, `setup` (U1),
  `needs`, `collab` (U2), `inputs`, `artifacts`, `stream`, `deliveries` (U3), and `ui`, `styles`, `app`
  (base).
- **Visual rules.** The tokens are in `docs/superpowers/specs/2026-11-24-meetless-v3-visual-tokens.md`:
  warm monochrome, violet only on AI and rule output, status as coloured text. There are no dot symbols
  anywhere. `guards()` runs on every rendered screen in unit tests, and the e2e specs scan whole pages in
  both locales.

## 6. What is simulated

Meetless v3 makes **no external AI or model calls**. Everything that looks like agent output comes from
rules or retrieval over the asker's own view of the project record, and the UI labels it.

| Feature | How it works | Label |
|---|---|---|
| Need detection on import | Keyword and sentence-pattern rules (`core/detect.ts`, `detector: "rules/1"`) | 「规则识别」 / "Rule-matched" |
| Project agent answers | Keyword retrieval over needs, quotes, revisions, work, input paragraphs and artifact page text, arranged by templates, with need chips and material citations (`core/search.ts`, `core/agent.ts`) | 「规则生成」 / "Rule-based" |
| Agent actions in chat | Intent rules (add a card, import, hand off, check stale), each a button the person presses | 「规则生成」 / "Rule-based" |
| Dashboard cards, suggestion bar | Computed from the project record (`core/dashboard.ts`) | 「规则生成」 / "Rule-based" |
| Capture | Real reads of linked git repos, Overleaf git, Notion (via the user's own Notion MCP OAuth) and uploaded documents, matched to needs by code and keyword rules | 「捕获 仅供参考」 |
| Round picked for a need | Rules (`Need.autoRound`) | 「规则识别」 |

The provider interface stays in place. `apps/server/src/agents/claude.ts` is an inert placeholder: the
server never constructs it, and it reads no key and makes no network call. The UI never says "AI reviewed".
Agent reports over MCP are real reports from the user's own Claude Code or Codex, shown with the client
name.

Each user's chat with the project agent is stored privately, so only that user sees it. Answers use only
what the asker can see. The 「项目 / 仅自己」 switch decides whether what a message creates (inputs, needs,
work) is shared.

## 7. Running it

All development, tests and screenshots run on the shared dev machine.

```sh
pnpm install --frozen-lockfile
pnpm deps start                 # meetless-pg 127.0.0.1:55433 + meetless-office 127.0.0.1:55434
pnpm onlyoffice start           # optional: meetless-onlyoffice 127.0.0.1:55435 + relay (secret in infra/dev/onlyoffice/.env.local)

pnpm test:blocks                # isolation table
pnpm -r typecheck
pnpm -r test                    # unit tests; the server's use the real Postgres
pnpm test:e2e                   # Playwright: real server, separate client processes, headless Chromium
MEETLESS_XVFB_NAME=meetless-xvfb-<you> pnpm --filter @meetless/desktop test:electron   # Electron in Xvfb container

pnpm dev -- --sample zh-CN      # server :4870 (dev auth on) + two dev clients + renderer :5173
```

`pnpm dev` prints two client URLs (zh-CN and en). Sign in with `dev-alex`, `dev-zhou` and so on (the dev
users are in `apps/server/src/auth.ts`). Port and schema isolation for parallel work is in
`scripts/blocks.mjs` (contract §12.18). Electron runs only inside the Xvfb container, never on a desktop.

### 7.1 Server settings

| Variable | Default | Meaning |
|---|---|---|
| `MEETLESS_HOST` / `MEETLESS_PORT` | `127.0.0.1` / `4870` | listen address |
| `MEETLESS_DATABASE_URL` / `MEETLESS_PG_SCHEMA` | meetless-pg / `meetless` | event and account store |
| `MEETLESS_DATA_DIR` | `.data/server` | blobs, admin invite, office socket |
| `MEETLESS_DEV_AUTH` | off | `1` accepts `dev-<name>` tokens (development and tests only) |
| `MEETLESS_SAMPLE` / `MEETLESS_SAMPLE_ME` | unset / `u-alex` | load the sample projects in `zh-CN` or `en` |
| `MEETLESS_AGENT_URL` | request host | public base URL used in the agent setup commands |
| `MEETLESS_TRUST_PROXY` | `0` | reverse-proxy hop count for the client IP |
| `MEETLESS_RATE_SIGNIN` / `MEETLESS_RATE_REDEEM` | `10/300` / `10/600` | failure limits, `<n>/<seconds>` |
| `MEETLESS_OFFICE_URL` | `http://127.0.0.1:55434` | LibreOffice service, `off` to disable |
| `MEETLESS_ONLYOFFICE_URL` | `http://127.0.0.1:55435` | DocumentServer, `off` to use the fallback only |
| `MEETLESS_ONLYOFFICE_JWT_SECRET` | from `infra/dev/onlyoffice/.env.local` | DocumentServer JWT |
| `MEETLESS_OFFICE_FILES_SOCKET` | `<dataDir>/office-sock/files.sock` | ticketed file socket for the relay |
| `MEETLESS_PDF_TEXT` | on | `off` disables per-page PDF text |
| `MEETLESS_EXTRACT_HEAP_MB` / `MEETLESS_EXTRACT_TIMEOUT_MS` / `MEETLESS_EXTRACT_CONCURRENCY` | `384` / `30000` / `2` | DOCX and PDF parsing runs in worker threads with this heap limit, kill timeout and concurrency |
| `MEETLESS_PDF_MAX_PAGES` | `2000` | a PDF with more pages is not parsed (`TOO_LARGE`) |

### 7.2 Trial servers

A trial server is an ordinary server with dev auth off, its own port, Postgres schema and data dir.
Sign in with the admin invite in that data dir. Reach it from a laptop through an SSH tunnel
(`docs/MCP.md`).

## 8. Tests

- Core unit tests cover the need lifecycle, accepting and ignoring detected items, versions, stale
  handoffs, the handoff state machine and its permissions, conflicts, privacy at every exit, dashboard
  cards, detection and cited answers.
- Server tests run against the real Postgres: accounts, rate limits, imports, office, PDF text and sample
  loading. `mcp.e2e.test.ts` connects the official SDK client over HTTP to a running server.
- The desktop unit tests render every screen and run `guards()` on each (no dots, no marks before codes).
  `client-state.test.ts` checks that each user's client state equals `viewFor` for that user.
- e2e: the block specs (`u1-*`, `u2-*`, `u3-*`, `skeleton`, `signin`) plus `story.spec.ts`, which runs
  design §10 in one go. Two clients (zh-CN and en) sign in with invite codes. A hands a need to B. B accepts
  and copies the prompt. B's agent reads the context and reports over MCP/HTTP, and A sees the report. A's
  revision makes the handoff stale, and the refresh request reaches B. A's private need never reaches B. A
  composer card survives a reload. A material citation opens the artifact at its page. The dot scan passes
  in both locales.
- `screenshots.spec.ts` (only with `MEETLESS_SHOTS_V3=1`) writes `docs/screenshots/v3/`.
- Electron: `e2e-electron/run.mjs` in Xvfb covers launch, sign-in, persistence and restart.
  `e2e-electron/mac-packaged.mjs` is the same flow against the packaged Mac app. It opens a window, so it
  runs only with the user's approval.

## 9. Known gaps

- No signing or notarization. The macOS build is ad-hoc signed and arm64 only (`docs/MACOS.md`).
- No public deployment yet. HTTPS, a reverse proxy (`MEETLESS_TRUST_PROXY`) and keeping OnlyOffice on the
  private network are designed (contract §12.13) but not set up.
- Real Overleaf and Notion accounts have not been tried. Tests use a local bare git repo and a fake Notion
  MCP server.
- Project memory (`remember` and `recall`, `memory.*`) is reserved and not built (design §12).
- Role-based visibility, agent-to-agent conversations and client (customer) access are out of scope.
