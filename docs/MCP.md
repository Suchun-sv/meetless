# Connecting Claude Code and Codex (MCP)

The Meetless server is the MCP server. It answers Streamable HTTP at `<serverUrl>/mcp`, with no state
between calls, and every request needs an **agent token**. You install nothing per machine.

## 1. Get a token

1. Sign in to the Meetless app.
2. Open **Agent 接入 / Agents** at the bottom of the sidebar.
3. Enter a label (e.g. "MacBook Claude Code") and create a token. The app shows it **once**. Store it the
   way you store any other secret. The server keeps only its hash.
4. You can revoke a token on the same page. The page also lists your agents' recent calls.

The agent token belongs to your account. Your agent sees exactly what you see: your shared projects, plus
your own private items. It never sees anyone else's private items.

## 2. The commands

The Agents page shows these with your token filled in. The server builds them in
`apps/server/src/accounts/setup.ts` (`agentSetup`). `<serverUrl>` is `MEETLESS_AGENT_URL` when the server
has one, else the host you reached it by. With the SSH tunnel below it is `http://127.0.0.1:4876`.

### Claude Code

```sh
claude mcp add --transport http meetless <serverUrl>/mcp --header "Authorization: Bearer <TOKEN>" --header "X-Meetless-Client: claude-code"
```

For the v3 trial through the tunnel:

```sh
claude mcp add --transport http meetless http://127.0.0.1:4876/mcp --header "Authorization: Bearer <TOKEN>" --header "X-Meetless-Client: claude-code"
```

`claude mcp list` should then show `meetless` as connected.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.meetless]
url = "<serverUrl>/mcp"
bearer_token_env_var = "MEETLESS_TOKEN"
http_headers = { "X-Meetless-Client" = "codex" }
```

Then export the token in the shell that starts Codex:

```sh
export MEETLESS_TOKEN=<TOKEN>
```

The `X-Meetless-Client` header is what makes reports show up as `claude-code` or `codex` in the stream and
in the call log. Without it, the token's label is used.

### The skill

Copy `skills/meetless/SKILL.md` to `~/.claude/skills/meetless/SKILL.md` (Claude Code) or
`~/.codex/skills/meetless/SKILL.md` (Codex). It tells the agent to pull context before it starts, report
at milestones, and ask the person to press 「交回」 (Return) when done. `GET /v1/agent/guide` returns the
same commands plus the skill as one Markdown page.

## 3. Tools

| Tool | Input | What it does |
|---|---|---|
| `get_need_context` | `{ link }` (`meetless://<projectId>/<code>`) or `{ projectId, code }`, optional `locale` | Live context Markdown and its version. If you hold a handoff for the need, the version you fetched is recorded, so the sender can see when it goes stale. |
| `list_needs` | `{ projectId }`, optional `kind`, `status`, `round` | Needs you can see: code, title, kind, status, round |
| `search` | `{ q }`, optional `projectId`, `limit` | Needs, inputs, artifacts and work in your view |
| `read_artifact` | `{ projectId, artifactId, versionId? }` | Version text and linked need codes |
| `record_work` | need ref, `text`, optional `why`, `effect`, `date` | A work report. **It counts as progress** and is labelled with the client. |
| `propose_need` | `{ projectId, kind, title }`, optional `accept`, `expect`, `verify`, `why`, `parentCode` | Goes to 「待确认」 (To confirm); nothing is created until a person accepts it |
| `set_verdict` | need ref, `status` (testing, held, refuted, parked), `verdict` | A verdict on a hypothesis |

`remember` and `recall` are reserved for project memory and not built.

## 4. Reaching the trial server from the Mac

The v3 trial server listens on 127.0.0.1:4876 on the dev server. Forward it:

```sh
ssh -N -L 4876:127.0.0.1:4876 <user>@<dev-server>
```

In the app, sign in to `http://127.0.0.1:4876`, then run the commands above with that URL. The tunnel is
for development only. A public deployment would put HTTPS in front of the server, and DocumentServer
would stay on the private network (contract §12.13).

## 5. Checking it by hand

```sh
curl -s -X POST http://127.0.0.1:4876/mcp \
  -H "Authorization: Bearer <TOKEN>" -H "X-Meetless-Client: claude-code" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A bad or revoked token gives 401. After 10 failures in 5 minutes from one IP, you get 429 with
`retryAfter`.
