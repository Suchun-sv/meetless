# Meetless web and phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Meetless server serves the renderer at `/`, a browser bridge signs in with an HttpOnly cookie, the layout works on a 390px phone, and the desktop app is unchanged.

**Architecture:** Server side: a cookie session beside the bearer path (CSRF double submit plus Origin check), static serving of the `vite build` with a CSP header, and a `/office/` reverse proxy to DocumentServer. Client side: a renderer-safe web bridge that reuses an extracted sync protocol and holds state in memory. Renderer: one build, the bridge picked by environment, `snapshot.host === 'web'` for the few differences, and a `max-width: 760px` layout added with tokens only.

**Tech Stack:** TypeScript strict, Fastify 5, ws, React 19, Vite 8, vitest 5, Playwright 1.65, Postgres (meetless-pg), pnpm 12.

**Spec:** `docs/superpowers/specs/2026-11-25-web-mobile-design.md` (binding parents listed in its header).

## Global Constraints

- Every build, test and git command runs on the dev server in `~/github/meetless-web` (branch `web`). Never on the local machine.
- Commit messages are plain, one subject line (optionally a body), with NO trailers: no `Co-authored-by`, no AI attribution.
- Never touch port 4875, schema `meetless_trial`, `~/work/meetless-trial`, `~/work/meetless-mac-pkg`, or the `meetless-pg` container and volume. Docker: only `meetless-*` names, 127.0.0.1 binds, no prune, no sudo.
- This work's isolation: schema `meetless_v3_web` (dev runs), e2e base port 4990 (4990 to 4999), e2e renderer 5196, Xvfb `MEETLESS_XVFB_NAME=meetless-xvfb-web`. Unit tests make their own throw-away schemas as they already do.
- No external AI or model calls. Project-agent output stays rule-based and labelled.
- Private ("Only me") items never reach another user's view, a link, MCP context, search, a dashboard or an answer. The web path goes through the same server filtering; nothing new may bypass it.
- No dot symbols anywhere in the UI: `·`, `•`, `●`, bullet masks, status dots, three-dot chrome. Status is coloured text.
- Stylesheets: no raw colour, font, shadow or radius outside `styles/tokens.css`; every new custom property is a token in `tokens.css` AND `styles/token-names.ts`; violet (`--color-ai*`) only on AI and rule output. `apps/desktop/test/styles.test.ts` must stay green unchanged except for additive allowlist entries a task names.
- Copy in zh-CN and en, both complete (the i18n parity test enforces it), short and product-like. The desktop-only text is exactly 「请在桌面版使用」 / "Use the desktop app for this".
- Cookie names and flags exactly: `ml_session` (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000) and `ml_csrf` (Secure; SameSite=Lax; Path=/; Max-Age=2592000; readable by script). CSRF header `x-meetless-csrf`. Failure code `CSRF_FAILED` (403).
- The web session token never appears in a response body, a URL, `localStorage`, a log line or the renderer.
- Agent (`mla_`) tokens and `/mcp` behave exactly as before; the cookie is never accepted on `/mcp` or on routes whose `from` lacks `'app'`.
- Phone breakpoint exactly `@media (max-width: 760px)`; at 761px and wider the layout is unchanged.
- The desktop app (Electron main, preload, dev bridge, packaged CSP) keeps working unchanged: `pnpm -r test`, `pnpm test:e2e` and `pnpm --filter @meetless/desktop test:electron` stay green.

## Review Focus

1. A page reload on the web keeps the session (cookie) and refetches all events; nothing from before the reload is shown stale. Pinned in Task 4 (`snapshot after a new bridge instance with the same cookie jar`).
2. A session revoked elsewhere (sign-out in another tab, token revoked): the socket closes with 4401 and the web bridge goes to signed out and emits `session: null` instead of reconnecting forever. Pinned in Task 4.
3. A dropped socket or server restart: the web bridge reconnects with backoff and resumes from its in-memory cursor; a `reset` refetches from 0. Pinned in Task 4.
4. Submitting while the socket or network is down answers `rejected` `OFFLINE` with a visible notice; nothing claims it was saved or queued. Pinned in Tasks 4 and 5.
5. Resizing or rotating across 760px with the nav drawer open leaves no stuck scrim: the drawer closes on route change and at wide widths the drawer class has no effect. Pinned in Task 6.

---

### Task 1: Web session on the server (cookie auth, CSRF, Origin, sign-in and sign-out)

**Files:**
- Create: `packages/api/src/web.ts` (export from `packages/api/src/index.ts`)
- Create: `apps/server/src/web/cookies.ts`, `apps/server/src/web/session.ts`
- Modify: `apps/server/src/api/frame.ts` (`authenticateRequest`, `defineRoute`), `apps/server/src/http.ts` (`userOf`, websocket upgrade, register the web routes), `apps/server/src/office/onlyoffice.ts` only if `Principal` gains a field it must pass through
- Test: `apps/server/test/web-session.test.ts`

**Interfaces:**
- Produces (in `@meetless/api`, renderer-safe):
  - `WEB_SESSION_COOKIE = 'ml_session'`, `WEB_CSRF_COOKIE = 'ml_csrf'`, `WEB_CSRF_HEADER = 'x-meetless-csrf'`, `WEB_SESSION_PATH = '/v1/web/session'`, `WEB_HOST_META = 'meetless-host'`
  - `type WebSessionReq = { token: string } | { code: string; displayName: string; locale: string }`
  - `interface WebSessionRes { user: { id: Id; displayName: string; locale: string } }`
- Produces (server): `Principal.via: 'bearer' | 'cookie'` (set by `authenticateRequest`; `Authenticator.authenticate` itself stays bearer-only); `parseCookies(header: string | undefined): Record<string, string>`; `allowedOrigins(cfg: ServerConfig, req: { protocol: string; host: string }): Set<string>`; `checkCsrf(req: { method: string; headers: IncomingHttpHeaders; protocol: string; host: string }, cfg): void` (throws `ApiError('CSRF_FAILED')`); `registerWebSession(app, deps)`.
- `authenticateRequest(auth, req: { headers; ip; method?; protocol?; host? }, limiter?, opts?: { cookie?: boolean; cfg?: ServerConfig })`: with no `Authorization` header and `opts.cookie`, uses the `ml_session` cookie; a cookie principal with an unsafe method then runs `checkCsrf`. Failed cookies count on `limiter` like failed bearer tokens.

- [ ] **Step 1: Write the failing tests** in `apps/server/test/web-session.test.ts` (real Postgres, the helpers in `test/helpers.ts`, `app.inject`):
  - `invite sign-in sets both cookies with the exact flags and returns only the user` — `POST /v1/web/session {code, displayName:'Ana', locale:'en'}` with `origin` = the app's own origin: 200; `set-cookie` has `ml_session=mlp_...; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax` and `ml_csrf=<at least 32 url-safe chars>; ...; Secure; SameSite=Lax` without HttpOnly; the body is exactly `{ user: { id, displayName:'Ana', locale:'en' } }` and the body text contains no `mlp_`.
  - `token sign-in mints a separate web token and leaves the pasted token working` — sign in with a personal token; the cookie token differs from it; after `DELETE /v1/web/session` the pasted token still answers `GET /v1/me` 200 and the cookie token answers 401 `TOKEN_REVOKED`.
  - `agent tokens cannot sign in to the web` — `{ token: mla_... }` → 403 `NOT_AUTHORISED`.
  - `dev tokens sign in only while dev auth is on`.
  - `the cookie authenticates /v1/me, /v1/events, blobs and app routes, never /mcp or MCP-only routes` — `GET /v1/me` 200; `GET /v1/projects` (mcp-only) 401; `POST /mcp` 401.
  - `cookie writes need the CSRF header` — `POST /v1/commands` with cookie and no header → 403 `CSRF_FAILED`; wrong header → 403; right header and own origin → 201; right header with `origin: https://evil.example` → 403; a bearer request with no header → 201.
  - `login CSRF: a cross-origin sign-in is refused` — `POST /v1/web/session` with `origin: https://evil.example` → 403 `CSRF_FAILED`; `MEETLESS_AGENT_URL`'s origin is allowed.
  - `failed cookie sign-ins count on the sign-in limiter` — 11 requests with a bad `ml_session` from one IP, the 11th answers 429 `RATE_LIMITED` with `Retry-After`; invite sign-in failures count on the redeem limiter.
  - `the websocket takes the cookie only from an allowed Origin` — a real listening server and `ws`: cookie + own origin opens and gets `hello`; cookie + `https://evil.example` gets HTTP 403 before upgrade; cookie and no Origin gets 403.
  - `sign-out revokes the token, closes its sockets with 4401 and clears both cookies` — the open socket closes with code 4401; `set-cookie` clears both (`Max-Age=0`); a second `DELETE` with the now-revoked cookie answers 200 and clears again.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @meetless/server exec vitest run test/web-session.test.ts`
Expected: FAIL (route not found / no cookie support).

- [ ] **Step 3: Implement.** The session routes live in `apps/server/src/web/session.ts` as plain Fastify routes (not in `API_ROUTES`, so the API contract and MCP tool table are untouched). Token sign-in mints a `TokenRow` `{ kind: 'personal', label: 'web' }` with `newToken('personal')` and `hashSecret`; invite sign-in calls `InviteService.redeem(req, http.ip)`. Generate the CSRF value with `randomBytes(32).toString('base64url')`. Compare CSRF values with `timingSafeEqual`. `defineRoute` passes `{ cookie: route.from.includes('app'), cfg }`; the `/v1` sync and blob routes in `http.ts` pass `{ cookie: true, cfg }`; `/mcp` passes nothing. The websocket upgrade reads the cookie from `req.headers.cookie` and checks `Origin` against `allowedOrigins` when the principal came from the cookie; its revocation re-check must use the same credential it authenticated with.

- [ ] **Step 4: Run the new tests and the whole server suite**

Run: `pnpm --filter @meetless/server exec vitest run` and `pnpm --filter @meetless/server typecheck` and `pnpm --filter @meetless/api test`
Expected: all PASS.

- [ ] **Step 5: Commit** — `git commit -m "Server: web sessions with an HttpOnly cookie, CSRF double submit and Origin checks, sign-out revokes"`

### Task 2: The server serves the renderer at `/` with a CSP

**Files:**
- Create: `apps/server/src/web/static.ts`
- Modify: `apps/server/src/server.ts` (`ServerConfig.webDir`, `configFromEnv`), `apps/server/src/http.ts` (register), `apps/server/src/main.ts` (one startup line)
- Test: `apps/server/test/web-static.test.ts`

**Interfaces:**
- Consumes: `WEB_HOST_META` from Task 1.
- Produces: `ServerConfig.webDir: string | null` from `MEETLESS_WEB_DIR` (default `<repoRoot>/apps/desktop/dist/renderer`, `off` → null); `registerWebStatic(app, cfg)`; `webCsp(host: string): string`; `prepareIndexHtml(html: string): string` (adds `<meta name="meetless-host" content="web">`, removes any `http-equiv="Content-Security-Policy"` meta).

- [ ] **Step 1: Write the failing tests** (a temp dir with `index.html` carrying the vite CSP meta, `assets/app-abc.js`, `assets/f.woff2`):
  - `GET / serves index.html with the marker, without the CSP meta, with the CSP header` — exact header value is the spec section 3 string with `<host>` replaced by the request host; `x-content-type-options: nosniff`; `referrer-policy: same-origin`; `cache-control: no-store`.
  - `assets get their content type and immutable caching` — `.js` → `text/javascript; charset=utf-8`, `.css` → `text/css; charset=utf-8`, `.woff2` → `font/woff2`, `.svg` → `image/svg+xml`; `cache-control: public, max-age=31536000, immutable`.
  - `traversal and missing files are 404` — `/assets/../../etc/passwd`, `/%2e%2e/x`, `/assets/nope.js` → 404 `NOT_FOUND`.
  - `API, MCP, health and office paths are never shadowed` — a file named `health` in the dir does not change `GET /health`; `GET /v1/me` without a token stays 401.
  - `webDir off or without index.html answers 404 at /`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @meetless/server exec vitest run test/web-static.test.ts`

- [ ] **Step 3: Implement** with `node:fs/promises` and a fixed extension map (no new dependency). Resolve paths with `resolve(webDir, '.' + decoded)` and require the result to start with `webDir + sep`. Read `index.html` per request (it is small; a rebuild needs no restart).

- [ ] **Step 4: Run** — `pnpm --filter @meetless/server exec vitest run` and `typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Server: serve the renderer build at / with a CSP header and the web marker"`

### Task 3: OnlyOffice through `/office/`

**Files:**
- Create: `apps/server/src/web/office-proxy.ts`
- Modify: `apps/server/src/http.ts` (register; route websocket upgrades under `/office/` to the proxy before the `/v1/ws` check), `apps/server/src/office/onlyoffice.ts` (`documentServerUrl` for web sessions), `apps/server/src/api/routes-office.ts` if the principal's `via` must be passed
- Test: `apps/server/test/web-office-proxy.test.ts`

**Interfaces:**
- Consumes: `Principal.via` (Task 1).
- Produces: `registerOfficeProxy(app, cfg)`; `OFFICE_PROXY_PREFIX = '/office'`; `office.config` answers `documentServerUrl: '<request protocol>://<request host>/office'` when `p.via === 'cookie'`, else `cfg.onlyoffice.url` as today.

- [ ] **Step 1: Write the failing tests** against a fake DocumentServer (`node:http` server plus a `ws` server on an ephemeral port, set as `MEETLESS_ONLYOFFICE_URL`):
  - `GET /office/web-apps/apps/api/documents/api.js is proxied with the prefix stripped` — the fake sees path `/web-apps/apps/api/documents/api.js`, `x-forwarded-host: <host>/office`, `x-forwarded-proto: http`, and no `cookie` or `authorization` header even though the browser request had both; status, content type and body pass through.
  - `POST bodies and query strings pass through` (a 64 KB body arrives intact).
  - `a websocket under /office/ is proxied both ways` — `ws` client to `/office/doc/x/c/?EIO=4&transport=websocket`; the fake receives the upgrade at `/doc/x/c/?EIO=4&transport=websocket` and an echo round-trips.
  - `onlyoffice off answers 404 under /office/` and `the fake being down answers 502 BAD_GATEWAY`.
  - `office.config gives a web session the proxied url and the desktop the direct url` — reuse the fixture style of `test/onlyoffice.test.ts`.
  - `proxied responses do not carry the app CSP` and set-cookie headers from DocumentServer are dropped.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @meetless/server exec vitest run test/web-office-proxy.test.ts`

- [ ] **Step 3: Implement** with `node:http.request` for HTTP (stream request and response bodies; register `/office/*` with a content-type parser that leaves the body unparsed, or use Fastify's `onRequest` with `reply.hijack()`), and a raw `net`/`http` upgrade pass-through for websockets. No new dependency.

- [ ] **Step 4: Manual check against the real DocumentServer** — start a throw-away server on port 4986 with `MEETLESS_ONLYOFFICE_URL=http://127.0.0.1:55435`, schema `meetless_v3_web`, then `curl -s http://127.0.0.1:4986/office/web-apps/apps/api/documents/api.js | head -c 200` shows JavaScript and `curl -s http://127.0.0.1:4986/office/healthcheck` prints `true`. Stop the server. Record the output in the report.

- [ ] **Step 5: Run** the server suite and typecheck. Expected: PASS.

- [ ] **Step 6: Commit** — `git commit -m "Server: proxy DocumentServer under /office for web sessions"`

### Task 4: The web bridge (shared sync protocol, in-memory state)

**Files:**
- Create: `packages/client/src/sync-protocol.ts`, `packages/client/src/web-bridge.ts`
- Modify: `packages/client/src/node.ts` (use `sync-protocol`), `packages/client/src/bridge.ts` (`ClientSnapshot.host` adds `'web'`; `cacheKind` doc adds `"memory"`), `packages/client/src/api-call.ts` (`CallApiOptions.headers`), `packages/client/package.json` (`"./web": "./src/web-bridge.ts"`)
- Test: `packages/client/test/sync-protocol.test.ts`, `apps/server/test/web-bridge.e2e.test.ts`

**Interfaces:**
- Consumes: Task 1 constants and routes.
- Produces:
  - `sync-protocol.ts` (no Node imports): `type ServerMessage` (moved from `node.ts`); `interface SyncStore { readonly cursor: Seq; readonly epoch: Id | null; append(events: DomainEvent[], cursor: Seq, epoch: Id | null): DomainEvent[]; replace(events: DomainEvent[], cursor: Seq, epoch: Id | null): void }`; `subscribeMessage(store): string`; `fetchAllEvents(fetchPage: (after: Seq) => Promise<{ events; cursor; head; epoch }>): Promise<{ events: DomainEvent[]; cursor: Seq; epoch: Id | null }>`; `MemorySyncStore implements SyncStore`.
  - `createWebBridge(opts: { origin: string; fetchImpl?: typeof fetch; WebSocketImpl?: new (url: string) => WebSocket; storage?: Pick<Storage, 'getItem' | 'setItem'>; systemLocales?: string[]; minBackoffMs?: number; maxBackoffMs?: number }): MeetlessBridge`
  - Snapshot: `host: 'web'`, `cacheKind: 'memory'`, `outbox: []`, `session.serverUrl = origin`. On first `snapshot()` the bridge calls `GET /v1/me`; 200 means signed in (then connect), 401 means signed out.
  - `submit` → `POST /v1/commands` with `x-meetless-csrf` from `document.cookie` (`ml_csrf`); a network error or 5xx answers `{ kind: 'rejected', code: 'OFFLINE' }`. `dismissOutbox` is a no-op.
  - `signIn(_, token)` / `redeemInvite(_, code, name)` → `POST /v1/web/session`; same result codes as `ClientNode` (`TOKEN_MISSING`, `RATE_LIMITED` with `details.retryAfter`, `INVITE_INVALID`, `NETWORK`, `TIMEOUT`); `details.url` is the origin.
  - `signOut` → `DELETE /v1/web/session`, then `session: null`, `reset []`, status `signed_out`.
  - `uploadBlob` hashes with `crypto.subtle.digest('SHA-256')`; `readBlob` fetches and verifies the hash, no local copy.
  - `api` → `callApi(origin, null, name, input, { headers: { 'x-meetless-csrf': ... } })`, refusing non-app routes with `NOT_AVAILABLE` like `ClientNode`.
  - `setLocale` stores `meetless.locale` in `storage` and records `user.locale_changed` when online.
  - `pickRepo`, `listRepos` (returns `[]`), `repoLog`, `repoDiff`, `repoPatch`, `repoSnapshot`, `captureStatus`, `captureBindRepo`, `captureRun`, `overleafSetToken`, `overleafSync`, `notionConnect`, `notionDisconnect`, `notionPage`, `openLogs`, `updatesCheck`, `updatesInstall` answer `{ ok: false, code: 'DESKTOP_ONLY' }`.
  - A socket closed with 4401 → signed out (`session: null`), no reconnect. Other closes reconnect with backoff (250 ms doubling to 5 s).

- [ ] **Step 1: Write the failing tests.**
  - `sync-protocol.test.ts`: `fetchAllEvents pages until cursor reaches head`; `MemorySyncStore.append returns only new events and never moves the cursor back`; `replace swaps everything`.
  - `web-bridge.e2e.test.ts` (real server via the existing test helpers, dev auth on; `fetchImpl` and `WebSocketImpl` share a small cookie jar and send `origin: <server url>`; the `WebSocketImpl` adapter wraps `ws` with the jar's cookie header): `starts signed out`; `redeems an invite and receives the visible log`; `a new bridge with the same jar is signed in after a reload and refetches every event` (Review Focus 1); `live events from another client arrive`; `a reset (membership change) refetches from 0`; `submit is accepted, and answers OFFLINE once the server is closed` (Review Focus 4); `uploads and reads a blob`; `api calls work and MCP-only routes are NOT_AVAILABLE`; `desktop-only methods answer DESKTOP_ONLY`; `sign-out in another bridge on the same jar signs this one out with no reconnect loop` (Review Focus 2: no new upgrade attempts within 2 s after the 4401 close); `after the socket drops the bridge reconnects and resumes from its cursor without duplicates` (Review Focus 3: terminate server-side sockets, then a new event arrives once).
  - Existing `packages/client/test/*` stay green unchanged (the `ClientNode` refactor is behaviour-preserving).

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @meetless/client exec vitest run test/sync-protocol.test.ts` and `pnpm --filter @meetless/server exec vitest run test/web-bridge.e2e.test.ts`

- [ ] **Step 3: Implement** `sync-protocol.ts`, switch `ClientNode` to it, then `web-bridge.ts`. `web-bridge.ts` imports only `@meetless/core`, `@meetless/api`, `./bridge`, `./api-call`, `./sync-protocol` (check: `grep -E "node:|from 'ws'" packages/client/src/web-bridge.ts packages/client/src/sync-protocol.ts` prints nothing).

- [ ] **Step 4: Run** — `pnpm --filter @meetless/client test`, `pnpm --filter @meetless/server test`, `pnpm -r typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Client: web bridge over same-origin HTTP and WebSocket, in memory; sync protocol shared with ClientNode"`

### Task 5: Renderer on the web (bridge selection, sign-in, desktop-only features)

**Files:**
- Modify: `apps/desktop/src/renderer/app/bridge.ts` (`resolveBridge`), `apps/desktop/src/renderer/setup/SignIn.tsx`, `apps/desktop/src/renderer/artifacts/SourcePanel.tsx` (and `capture-ui.tsx` where the capture run button lives), the update entry and logs link (`shell/UpdateEntry.tsx`, wherever `openLogs` is offered), `apps/desktop/src/renderer/app/AppContext.tsx` (`submit` notice for `OFFLINE`), `packages/i18n/resources/{zh-CN,en}.json` (through `packages/i18n/scripts/catalogue.py` if that is the source of truth), `apps/desktop/src/renderer/index.html` (`viewport-fit=cover`)
- Create: `apps/desktop/src/renderer/ui/DesktopOnly.tsx`
- Test: `apps/desktop/test/web/bridge-select.test.ts`, `apps/desktop/test/web/signin-web.test.tsx`, `apps/desktop/test/web/desktop-only.test.tsx`

**Interfaces:**
- Consumes: `createWebBridge` from `@meetless/client/web`, `WEB_HOST_META` from `@meetless/api`, `snapshot.host === 'web'`.
- Produces: `resolveBridge(win = window, doc = document): MeetlessBridge | null` order: `win.meetless`, then `?bridge=&bridgeToken=`, then `<meta name="meetless-host" content="web">` → `createWebBridge({ origin: location.origin })`, else null. `isWeb(app: Pick<AppApi, 'snapshot'>): boolean`. `<DesktopOnly testId?: string />` renders `t('web.desktopOnly')` as muted text with `data-testid="desktop-only"`.
- i18n keys (exact copy):
  - `web.desktopOnly`: 「请在桌面版使用」 / "Use the desktop app for this"
  - `web.menu`: 「菜单」 / "Menu"
  - `web.back`: 「返回」 / "Back"
  - `signin.tokenTitle`: 「用个人令牌登录」 / "Sign in with a personal token"
  - `error.OFFLINE`: 「未连接服务器，没有保存」 / "Not connected. Nothing was saved."
  - `error.CSRF_FAILED`: 「会话校验失败，请刷新页面」 / "Session check failed. Reload the page."
  - `error.DESKTOP_ONLY`: 「请在桌面版使用」 / "Use the desktop app for this"

- [ ] **Step 1: Write the failing tests.**
  - `bridge-select.test.ts`: Electron bridge wins; dev params win over the meta; the meta alone gives a bridge whose `snapshot()` reports `host: 'web'` (stub `fetch` 401 for `/v1/me`); no meta and no params gives null.
  - `signin-web.test.tsx` (the `test/support/app.tsx` harness with `snapshot.host = 'web'`): no `signin-server` field; the invite form and the token form are shown; the token form's heading is `signin.tokenTitle` and there is no `signin.devOnly` text; redeem calls `bridge.redeemInvite(location.origin, code, name)`; `guards()` passes in both locales. With `host: 'dev-bridge'` the page is exactly as before (server field present).
  - `desktop-only.test.tsx`: on the web the code artifact source panel shows `desktop-only` instead of `af.pickRepo`; the Overleaf panel shows it instead of the token field and sync button; the Notion panel shows it instead of `af.notionConnect`; uploads and the artifact viewer controls are still present; the update entry and the logs link are absent; on `electron` all of them are present as before. `guards()` on each render.
  - An `AppContext` test: a submit answering `rejected OFFLINE` shows the `error.OFFLINE` notice.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @meetless/desktop exec vitest run test/web`

- [ ] **Step 3: Implement.** Branch only on `isWeb(app)`; no other renderer behaviour changes. Add the i18n keys in both catalogues.

- [ ] **Step 4: Run** — `pnpm --filter @meetless/desktop test`, `pnpm --filter @meetless/i18n test`, `pnpm -r typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Renderer: pick the web bridge on the server's page; web sign-in; desktop-only notices for local git, Overleaf and Notion"`

### Task 6: Phone layout (tokens only)

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`, `styles/token-names.ts` (add `--touch-min: 44px`, `--kb-inset: 0px`, and any sheet or drawer width token), `styles/base.css`, `shell/shell.css`, `shell/Shell.tsx`, `shell/Topbar.tsx`, `dash/dash.css`, `needs/needs.css`, `needs/NeedDrawer.tsx`, `chat/chat.css`, the board and table stylesheets the 390px screens need (`needs/BoardPage` styles, `setup/setup.css`, `inputs/inputs.css`, `artifacts/artifacts.css`, `deliveries/deliveries.css`, `stream/stream.css`, `collab/collab.css`)
- Create: `apps/desktop/src/renderer/ui/viewport.ts`
- Test: `apps/desktop/test/web/phone-shell.test.tsx`, `apps/desktop/test/web/viewport.test.ts`, additions to `apps/desktop/test/styles.test.ts` only as new `it(...)` blocks

**Interfaces:**
- Produces: `keyboardInset(vv: { height: number; offsetTop: number } | null, innerHeight: number): number` (pure: `max(0, round(innerHeight - vv.height - vv.offsetTop))`, 0 for null); `installKeyboardInset(win: Window): () => void` (listens to `visualViewport` `resize` and `scroll`, sets `--kb-inset` on `document.documentElement` in px, returns the remover; called once from `Shell`). Shell state `navOpen` with class `nav-open` on `.app`; Topbar button `data-testid="nav-toggle"` `aria-label={t('web.menu')}` `aria-expanded`; the scrim `data-testid="nav-scrim"`; NeedDrawer button `data-testid="drawer-back"` with text `t('web.back')` calling `closeNeed`.
- Layout under `@media (max-width: 760px)` exactly as spec section 7. The nav toggle and the drawer back button are `display: none` above 760px. The hamburger icon is three horizontal lines drawn as an inline SVG of `<path>` strokes (no round caps, no dot characters).

- [ ] **Step 1: Write the failing tests.**
  - `viewport.test.ts`: `keyboardInset(null, 844) === 0`; `keyboardInset({height: 500, offsetTop: 0}, 844) === 344`; `keyboardInset({height: 900, offsetTop: 0}, 844) === 0`; `installKeyboardInset` with a fake `visualViewport` EventTarget sets `--kb-inset: 344px` after a `resize` and the remover detaches.
  - `phone-shell.test.tsx`: `nav-toggle` toggles `nav-open` and `aria-expanded`; `nav-scrim` click closes it; a route change closes it (Review Focus 5); the need drawer has `drawer-back` and clicking it calls `closeNeed` (route `needId` becomes null); `guards()` on each render.
  - `styles.test.ts` additions: `the phone breakpoint is exactly max-width: 760px` (every `@media` with `max-width` other than the existing 1200px rules uses `760px`); `inside the phone breakpoint, .btn, .nav, .chip, .inp and the composer input have min-height var(--touch-min)`; `the composer uses var(--kb-inset) for its bottom offset under the breakpoint`; `.nav-toggle and .drawer-back are hidden outside the breakpoint`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @meetless/desktop exec vitest run test/web test/styles.test.ts`

- [ ] **Step 3: Implement** the CSS and the small React additions. Look at each page at 390x844 with the dev stack (`pnpm dev -- --sample zh-CN` uses its own ports; for this task start it with `MEETLESS_PORT=4986` and `MEETLESS_PG_SCHEMA=meetless_v3_web` and check that the bridge and Vite ports are free first) and a headless Playwright script, fixing horizontal overflow (`document.documentElement.scrollWidth <= 390` on home, a project dashboard, board, inputs, artifacts, stream, deliveries, members, agents). Put that check script in `apps/desktop/e2e/support/overflow.ts` so Task 7 reuses it.

- [ ] **Step 4: Run** — `pnpm --filter @meetless/desktop test`, `pnpm -r typecheck`. Expected: PASS, including the unchanged style guards.

- [ ] **Step 5: Commit** — `git commit -m "Renderer: phone layout under 760px with tokens only; hamburger drawer, full-screen need page, bottom sheets, keyboard-safe composer, 44px targets"`

### Task 7: End-to-end on the web (phone and desktop widths, two clients, scans, screenshots)

**Files:**
- Modify: `apps/desktop/e2e/global-setup.ts` (build the renderer once into `<E2E.root>/web-dist` with `vite build --outDir`, pass `MEETLESS_WEB_DIR` to the server), `apps/desktop/e2e/env.ts` (`webUrl = serverUrl`)
- Create: `apps/desktop/e2e/web-support.ts`, `apps/desktop/e2e/web-mobile.spec.ts`, `apps/desktop/e2e/web-two-client.spec.ts`, `apps/desktop/e2e/web-screenshots.spec.ts`
- Output: `docs/screenshots/v3/mobile/*.png`

**Interfaces:**
- Consumes: everything above; the existing helpers in `e2e/procs.ts`, `e2e/env.ts`, `e2e/i18n.ts`, the dot scan and privacy patterns in `e2e/story.spec.ts`, and `e2e/support/overflow.ts` from Task 6.
- Produces: `webSignIn(page, { token } | { code, name })`; `scanPage(page)` (no `DOT_CHARS` in `document.body.innerText` or in `::before`/`::after` content, and no horizontal overflow at the current width); `fakeKeyboard(page, height)` via `addInitScript` replacing `window.visualViewport` with a controllable EventTarget.

- [ ] **Step 1: Write the specs.**
  - `web-mobile.spec.ts`, for each of `{390x844, 1440x900}` × `{zh-CN, en}` (`locale` and `viewport` per describe): sign in on the web with a dev token (`dev-alex` for zh-CN, `dev-ben` for en; both members of the sample); the cookie `ml_session` is HttpOnly (`context.cookies()`) and `document.cookie` lacks it; the home dashboard shows its cards (one column at 390: every card's left edge equal); open the sample project; open a need (at 390 the need page fills the viewport and `drawer-back` returns); hand the need off to another member and see the handoff block; ask the composer a question and see a rule-based answer with its 「规则生成」/"Rule-based" label; at 390, open and close the nav drawer; `scanPage` on every page visited; the desktop-only notice shows on a code artifact's source panel. Keyboard: with `fakeKeyboard(page, 450)` at 390x844, focus the composer input; its bounding box bottom is at most 450 and it is visible. At 1440 the nav toggle is not visible and the sidebar is.
  - `web-two-client.spec.ts`: client A is the web (a browser page on the server origin, dev token `dev-alex`), client B is a dev bridge host (`startBridgeProc`, slot 1, `dev-zhou`) on the Vite renderer. A hands a need to B; B sees and accepts it; A sees it accepted without reload. A creates a private need; B's view, B's search and B's dashboard never show its title. B edits a shared need's title; A sees it live. A reloads; still signed in, still sees the edit. A signs out; reloading shows the sign-in page and `GET /v1/me` with the old cookie is 401.
  - `web-screenshots.spec.ts` (only with `MEETLESS_SHOTS_WEB=1`): at 390x844 in both locales writes `docs/screenshots/v3/mobile/<locale>-<name>.png` for `signin`, `home`, `nav-open`, `project`, `board`, `need`, `handoff-sheet`, `composer-answer`, `artifact`, and one `desktop-<locale>-home.png` at 1440x900.

- [ ] **Step 2: Run** — `MEETLESS_E2E_BASE=4990 MEETLESS_E2E_RENDERER_PORT=5196 pnpm --filter @meetless/desktop exec playwright test web-` then the full `pnpm test:e2e` with the same ports, then `MEETLESS_SHOTS_WEB=1` for the screenshots. Fix whatever fails at its root (renderer, CSS or bridge), committing fixes with their own messages.

- [ ] **Step 3: Electron still works** — `MEETLESS_XVFB_NAME=meetless-xvfb-web pnpm --filter @meetless/desktop test:electron`. Expected: PASS.

- [ ] **Step 4: Commit** — `git commit -m "e2e: the web at 390 and 1440 in zh-CN and en, a web and a desktop client together, dot and privacy scans; mobile screenshots"`

### Task 8: Docs

**Files:**
- Create: `docs/WEB.md`
- Modify: `README.md` (a "Web and phone" section), `docs/ARCHITECTURE.md` (a "Web and phone" section; the layout table gains `apps/server/src/web`; section 7.1 gains `MEETLESS_WEB_DIR`; section 9 known gaps updated)

- [ ] **Step 1: Write** `docs/WEB.md`: the URL `https://<dev-server>.<tailnet>.ts.net:8445`; how to sign in on a phone (install Tailscale, sign in to the same tailnet, open the URL, enter your name and an invite code, or paste a personal token); how an admin gets an invite (the admin invite file in the trial data dir, `~/work/meetless-v3-trial-data/admin-invite.txt`, or 「成员」/Members to create a project invite) without printing any code; what is desktop only; online only (no offline edits); the security model (cookie flags, CSRF, Origin, CSP, sign-out revokes); the OnlyOffice proxy and its same-origin note; the `tailscale serve` command used and how to remove only that handler (`tailscale serve --https=8445 off`); limits (no push notifications, no offline, no installable app).

- [ ] **Step 2: Check** — `grep -nP "[\x{00B7}\x{2022}\x{25CF}]" docs/WEB.md README.md docs/ARCHITECTURE.md` prints nothing; no invite code or token value appears in any doc.

- [ ] **Step 3: Commit** — `git commit -m "Docs: web and phone (WEB.md, README, architecture)"`
