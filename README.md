# Meetless

A desktop app for teams that work through needs. Needs come in, people work around artifacts, hand needs
to each other, deliver in rounds, and get feedback. Each person's Claude Code or Codex pulls live need
context and reports progress over MCP. Every project has one shared project agent. It is rule-based and
labelled as such: Meetless makes no model calls (docs/ARCHITECTURE.md §6).

```
apps/server        sync service: Postgres event log, invite-code accounts, HTTP API, MCP over HTTP (/mcp)
apps/desktop       Electron app (main + preload + React renderer), dev bridge host, Playwright e2e
packages/core      event-sourced domain: needs, handoffs, rounds, privacy scopes, rules detection and answers
packages/api       shared HTTP and MCP contract
packages/client    client sync engine, node:sqlite cache, capture (git, Overleaf, Notion)
packages/i18n      zh-CN and en
packages/sample    the prototype's two sample projects, labelled 「样例数据」
skills/meetless    the agent skill for Claude Code and Codex
design/claude-design-v3   the v3 UI prototype
docs/ARCHITECTURE.md   how it is built, what is simulated, settings, tests, gaps
docs/MCP.md            connecting Claude Code and Codex
docs/MACOS.md          the unsigned macOS arm64 build
docs/screenshots/v3/   every page in zh-CN and en at 1440x900
```

## Run (on the dev machine)

```sh
pnpm install --frozen-lockfile
pnpm deps start                     # meetless-pg (127.0.0.1:55433) + meetless-office LibreOffice (127.0.0.1:55434)
pnpm onlyoffice start               # optional: OnlyOffice DocumentServer (127.0.0.1:55435) + relay

pnpm test:blocks
pnpm -r typecheck
pnpm -r test
pnpm test:e2e                       # real server + separate client processes + headless Chromium
MEETLESS_XVFB_NAME=meetless-xvfb-<you> pnpm --filter @meetless/desktop test:electron   # Electron in an Xvfb container

pnpm dev -- --sample zh-CN          # server :4870 (dev auth on), two dev clients, renderer :5173
```

`pnpm dev` turns dev auth on (`dev-alex`, `dev-zhou`, …). A real server keeps it off. On first start it
writes a one-time admin invite to `<dataDir>/admin-invite.txt` (mode 0600). Redeem it on the sign-in page
with your name to create the first account, then invite teammates from a project's Members page.

## Mac

`docs/MACOS.md` covers building the unsigned arm64 dmg and zip on the Mac, the headless smoke check, and
what Gatekeeper does with an unsigned build. The app connects to a server you can reach. During
development that is the dev machine, through an SSH tunnel.

## License

Meetless is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): you may use, study and modify it for any noncommercial purpose. Commercial use is not permitted.
