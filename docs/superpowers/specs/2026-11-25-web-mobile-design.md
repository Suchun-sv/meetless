# Meetless web and phone (design)

Date: 2026-11-25. Branch `web`, from `v3` at `7fad3a0`. Decisions approved by the user on 2026-11-25.
Binding parents: `2026-11-24-meetless-v3-design.md`, the v3 contract (`../plans/2026-11-24-v3-contract.md`)
and the visual tokens (`2026-11-24-meetless-v3-visual-tokens.md`). Where this doc is silent, they rule.

## 1. Goal

Opening `https://<host>` in a browser, on a phone or a desktop, gives the full Meetless. The desktop app
keeps working unchanged. The web is online only: no offline cache, no outbox. State lives in memory and
is refetched on every page load.

## 2. Shape

```
browser ── https ──> tailscale serve :8445 ──> Meetless server 127.0.0.1:4876
                                                ├── /            renderer build (index.html + assets), CSP header
                                                ├── /v1/...      API, sync, blobs (bearer or web cookie)
                                                ├── /v1/ws       sync websocket (bearer or web cookie + Origin)
                                                ├── /v1/web/...  web sign-in / sign-out
                                                ├── /office/...  reverse proxy to DocumentServer (HTTP + websocket)
                                                └── /mcp         unchanged (agent tokens only)
```

- **One renderer.** The same `apps/desktop/src/renderer` build runs in Electron, behind the dev bridge and
  on the web. Only the bridge differs. `resolveBridge()` picks: `window.meetless` (Electron), else
  `?bridge=` (dev/test), else the web bridge when the page carries `<meta name="meetless-host"
  content="web">`, which only the Meetless server's `/` adds. The renderer reads `snapshot.host`
  (`'electron' | 'dev-bridge' | 'web'`) for the few things that differ (section 6).
- **The web bridge** (`packages/client/src/web-bridge.ts`, no Node imports) implements `MeetlessBridge`
  over same-origin `fetch` and `WebSocket`. It reuses the client's sync protocol: the message handling
  and the resync paging move into a renderer-safe `packages/client/src/sync-protocol.ts` that both
  `ClientNode` and the web bridge use. Events, cursor and epoch are held in memory. `submit` posts once;
  a network failure answers `{ kind: 'rejected', code: 'OFFLINE' }` and is never queued. `outbox` is
  always empty. `cacheKind` is `'memory'`. Blobs are fetched per read (the browser's HTTP cache keeps
  them, the server sends `immutable`). The locale is kept in `localStorage` (`meetless.locale`, not a
  secret) and also recorded in the team log as the desktop does.

## 3. Sign-in and security

Built for the public internet even though the first deployment is tailnet only.

- **Sign-in.** `POST /v1/web/session` takes either `{ code, displayName, locale }` (an invite, the same
  rules and the same redeem rate limit as `invites.redeem`) or `{ token }` (a personal `mlp_` token; dev
  tokens only while dev auth is on). Agent tokens are refused (`NOT_AUTHORISED`). A token sign-in mints
  a **new** personal token row for the web session (label `web`), so signing out of the web never
  revokes the token the user pasted or their desktop session. An invite sign-in uses the personal token
  the redemption creates. The answer is `{ user }`; the token never appears in a body the browser can read.
- **Cookie.** `ml_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days).
  Never in `localStorage`, never in a URL. A second cookie, `ml_csrf=<random>; Secure; SameSite=Lax;
  Path=/` (readable by script), carries the CSRF token.
- **Authentication.** `authenticateRequest` accepts the cookie when there is no `Authorization` header.
  The bearer path is unchanged. The cookie is honoured only on routes reachable from the app (`from`
  includes `'app'`), the `/v1` sync routes, blobs and `/v1/ws`; never on MCP-only routes and never on
  `/mcp`, so agent and MCP tokens are unchanged. A bad or revoked cookie counts as a failed sign-in for the existing rate limit.
- **CSRF.** A cookie-authenticated request with method POST, PUT, PATCH or DELETE must carry
  `x-meetless-csrf` equal to the `ml_csrf` cookie (double submit) **and**, when an `Origin` header is
  present, an allowed origin. Allowed origins: the request's own `protocol://host` (proxy aware through
  `MEETLESS_TRUST_PROXY`) and the origin of `MEETLESS_AGENT_URL`. Failure answers `403 CSRF_FAILED`.
  The `/v1/web/session` POST has no session yet, so it checks Origin only (login CSRF). Bearer requests
  are exempt (no ambient credential).
- **Websocket.** A cookie-authenticated `/v1/ws` upgrade must carry an allowed `Origin`; otherwise 403
  before the protocol switch (cross-site websocket hijacking). Revoking the session closes the socket
  with 4401, as for tokens.
- **Sign-out.** `DELETE /v1/web/session` revokes the session's token row, closes its websockets and
  clears both cookies. It works even with an already revoked cookie (it then only clears).
- **Rate limits.** The existing sign-in and redeem limiters apply to the web routes unchanged.
- **CSP** on every page the server serves at `/`, as a header (the build's desktop CSP meta is removed):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
  font-src 'self'; connect-src 'self' wss://<host> ws://<host>; frame-src 'self'; worker-src 'self'
  blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. `index.html` is `no-store`; hashed
  assets are `immutable`.

## 4. Serving the web app

`MEETLESS_WEB_DIR` (default `<repoRoot>/apps/desktop/dist/renderer`; `off` disables) holds a normal
`vite build`. `GET /` and `GET /index.html` serve the HTML with the meta marker added and the CSP meta
removed. `GET /assets/*` and other files in the directory are served with a content type from the
extension; anything that resolves outside the directory, or a missing file, is 404. `/v1`, `/mcp`,
`/health` and `/office` are never shadowed. The renderer has no URL routing, so there is no SPA
fallback. If the directory has no `index.html`, `/` answers 404 and startup logs one line saying so.

## 5. OnlyOffice on the web

The browser must reach DocumentServer's `api.js` and editor without DocumentServer being exposed. The
Meetless server reverse-proxies `/office/*` to `MEETLESS_ONLYOFFICE_URL` (HTTP and websocket upgrade),
stripping the `/office` prefix, dropping the browser's `Cookie` and `Authorization` headers, and setting
`X-Forwarded-Host: <host>/office` and `X-Forwarded-Proto`, which is DocumentServer's documented way to
run under a virtual path. `office.config` answers `documentServerUrl = <request origin>/office` when the
caller is a web session; the desktop still gets `MEETLESS_ONLYOFFICE_URL`. The file fetch path (relay
container, Unix socket, tickets) is unchanged. With OnlyOffice off or down, the existing fallback
(LibreOffice page images) works on the web as on the desktop.

Known risk, documented in `docs/WEB.md`: the proxied editor runs on the same origin as Meetless. That is
fine on the tailnet. A public deployment should give `/office` its own origin.

## 6. What differs on the web

Desktop only (they need the local filesystem, a local git binary or a local OAuth callback). On the web
each shows 「请在桌面版使用」 / "Use the desktop app for this" in place of its controls:

- capture from a local git repository (pick, bind, run for code artifacts);
- Overleaf git capture (token, sync);
- Notion connect.

The web bridge answers `DESKTOP_ONLY` for those methods and for `openLogs`, `updatesCheck` and
`updatesInstall`; the renderer hides the update entry and the logs link when `host === 'web'`.
Uploads, artifact viewing (OnlyOffice and the fallback), inputs, handoffs and the project agent all work.

The sign-in page on the web has no server field (the server is the page's origin) and offers the
invite form and a personal-token form. The token form is not labelled "dev only" on the web.

## 7. Phone layout

Tokens only, under the existing style guards (no dots, violet only for AI, no raw values outside
`tokens.css`). One breakpoint: `@media (max-width: 760px)`. At wide widths nothing changes.

- The sidebar becomes a drawer opened by a hamburger button in the top bar, over a scrim; choosing a
  destination or tapping the scrim closes it.
- Dashboard cards go to one column.
- The need drawer becomes a full-screen page with a back button in its header.
- Modals become bottom sheets (full width, anchored to the bottom, top corners rounded, scrollable).
- The composer is fixed at the bottom and stays above the on-screen keyboard: a small hook reads
  `window.visualViewport` and sets the `--kb-inset` custom property on the root (a token whose
  default is `0px`), which the composer uses as its bottom offset.
- Touch targets are at least 44px (a `--touch-min` token) on buttons, nav rows, chips and inputs.
- Tables and boards scroll horizontally (the board) or stack (key-value tables).
- `index.html` gets `viewport-fit=cover`; safe-area insets pad the composer and the top bar.

## 8. Deployment (tailnet only, for now)

- `tailscale serve --bg --https=8445 http://127.0.0.1:4876`, after `tailscale serve status`, adding
  only that handler (8443 Gleeok and 8444 stay as they are). URL:
  `https://<dev-server>.<tailnet>.ts.net:8445`.
- The v3 trial server restarts on the new `v3` HEAD (worktree `~/work/meetless-v3-trial`, data
  `~/work/meetless-v3-trial-data`, schema `meetless_trial_v3`) with `MEETLESS_AGENT_URL` set to that
  URL, `MEETLESS_TRUST_PROXY=1`, and the renderer built in the trial worktree.
- Sign in on a phone: install Tailscale, join the tailnet, open the URL, redeem an invite.

## 9. Tests

- Server (real Postgres): cookie sign-in by invite and by token, the cookie flags, a web session never
  in a response body, agent tokens refused, CSRF (missing, wrong, cross-origin, bearer exempt), the
  websocket Origin check, sign-out revokes and closes sockets, rate limits on the web routes, static
  serving (CSP header, marker, traversal 404, no shadowing), the `/office` proxy against a fake
  DocumentServer (HTTP and websocket, cookies stripped, forwarded host).
- Client: the web bridge against a real in-process server (sign-in, snapshot, live events, reset
  resync, submit, blobs, api, sign-out, desktop-only codes) and `ClientNode` still green after the
  `sync-protocol` extraction.
- Renderer: bridge selection, the web sign-in form, the desktop-only notices, the hamburger drawer,
  the need page back button, the keyboard hook, style guards.
- Playwright, against the server serving the built renderer, at 390x844 and 1440x900, in zh-CN and en:
  sign in, the home dashboard, a project, opening a need, handing it off, the composer answer, a
  keyboard-safe composer (a reduced visual viewport keeps the composer input visible). A two-client
  e2e with one web client and one desktop-bridge client. Privacy and dot scans on every web page.
  Screenshots to `docs/screenshots/v3/mobile/`.

## 10. Isolation for this work

Branch `web`, worktree `~/github/meetless-web`. Postgres schema `meetless_v3_web`, dev server 4886,
e2e base 4990 (4990 to 4999), e2e renderer 5196, Xvfb `meetless-xvfb-web`. The user's 4875 trial,
`meetless_trial`, `~/work/meetless-trial` and `~/work/meetless-mac-pkg` are never touched.
