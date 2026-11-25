# @meetless/server

Sync service. It validates every command with `@meetless/core` against its
projection, then appends it to the PostgreSQL event log in one transaction:
the server assigns a gap-free seq, and appends are idempotent on the event id.
Each event is stored with its scope (core `eventScope`: `project_id`,
`private_to`), and every read path keeps an event only for a member of its
project and, if it is private, only for its owner. Sharing events
(`need.shared`, `input.shared`, `artifact.shared`) get their snapshot from the
service's own state. It pushes events over WebSocket so clients can resume from
a cursor, and serves content-addressed blobs (sha256) to users whose view
references them or who uploaded them. A log with an event type this version
does not know is refused at start, before anything is written.

```
pnpm --filter @meetless/server start     # needs infra/dev/deps.sh start
pnpm --filter @meetless/server test      # Postgres-backed; fails loudly if meetless-pg is down
```

Accounts use personal (`mlp_`) and agent (`mla_`) bearer tokens, checked by hash
(`Authenticator` in `src/auth.ts`). `MemoryEventStore` is a unit-test double only.
See docs/ARCHITECTURE.md §5.

## Operator settings

Every setting is an environment variable read once at start (`configFromEnv`). A malformed
value stops the server before it listens.

| Variable | Default | Meaning |
|---|---|---|
| `MEETLESS_HOST` / `MEETLESS_PORT` | `127.0.0.1` / `4870` | Listen address. |
| `MEETLESS_DATA_DIR` | `.data/server` | Blobs, the admin invite file and the office files socket. |
| `MEETLESS_DATABASE_URL` | the dev `meetless-pg` on `127.0.0.1:55433` | PostgreSQL connection string. |
| `MEETLESS_PG_SCHEMA` | `meetless` | Schema holding the log and the account tables. |
| `MEETLESS_LOG` | off | `1` turns on the Fastify request log. |
| `MEETLESS_DEV_AUTH` | off | `1` accepts the fixed dev tokens (`dev-alex` and the rest, or `MEETLESS_DEV_USERS` as JSON). Refused when `NODE_ENV=production`. |
| `MEETLESS_TRUST_PROXY` | `0` | Number of reverse proxies in front of the server (a hop count: `0` none, `1` one proxy). The client address is the X-Forwarded-For entry that many hops from the right, so a client cannot spoof it. Set it only when every request comes through those proxies. |
| `MEETLESS_AGENT_URL` | the request's own `protocol://host` | The public https base URL agents use; the Agents page and `agentSetup` show it. Must be set in production. |
| `MEETLESS_RATE_SIGNIN` | `10/300` | Failed sign-ins allowed per client IP, as `<limit>/<seconds>`. Only failures count (a bad or revoked bearer token); a valid token always passes. |
| `MEETLESS_RATE_REDEEM` | `10/600` | Failed `invites.redeem` calls allowed per client IP, same format and rule. |
| `MEETLESS_PDF_TEXT` | on | `off` disables the PDF text worker; `artifacts.read` then extracts a PDF on read instead. |
| `MEETLESS_OFFICE_URL` | `http://127.0.0.1:55434` | LibreOffice preview converter; `off` disables it. |
| `MEETLESS_ONLYOFFICE_URL` | `http://127.0.0.1:55435` | OnlyOffice DocumentServer; `off` disables document preview. |
| `MEETLESS_ONLYOFFICE_JWT_SECRET` | from `infra/dev/onlyoffice/.env.local` | Secret DocumentServer checks. Without the variable, the `MEETLESS_ONLYOFFICE_JWT_SECRET=` line of that file is used, unquoted or in one pair of quotes. |
| `MEETLESS_PUBLIC_URL` | `http://meetless-onlyoffice-files:8080` | Base URL DocumentServer fetches ticketed files from. |
| `MEETLESS_OFFICE_FILES_SOCKET` | `<dataDir>/office-sock/files.sock` | Unix socket (mode 0600, in a 0700 directory) that alone serves `GET /v1/office-files/:ticket`; never on the TCP port. `off` disables it. |
| `MEETLESS_SKILL_PATH` | `skills/meetless/SKILL.md` in the repo | Skill markdown behind `agent.guide` and the MCP instructions. Missing or empty stops the server. |
| `MEETLESS_SAMPLE` / `MEETLESS_SAMPLE_ME` | none / `u-alex` | `zh-CN` or `en` loads the sample projects into an empty log. |
| `MEETLESS_REPO_ROOT` | this repo | Where the sample data and the OnlyOffice `.env.local` are read from. |

**First start.** With no account yet, the server issues one admin invite, prints it to the
log once and writes it to `<dataDir>/admin-invite.txt` (mode 0600). Redeeming it removes the
file. If the file is lost before that, the next start revokes the old invite and issues a new one.

**MCP.** `POST /mcp` serves the seven Meetless tools over Streamable HTTP (stateless, JSON
responses). Send `Authorization: Bearer <agent token>` and `X-Meetless-Client: <name>`
(`claude-code`, `codex`, or any label); without the header the token's own label is used.
`GET /v1/agent-setup` gives the exact `claude mcp add` command and Codex config.
