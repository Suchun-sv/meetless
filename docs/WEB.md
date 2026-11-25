# Meetless on the web and on a phone

The Meetless server also serves the app itself. Open the server's address in a browser, on a phone or a
desktop, and you get the same Meetless as the desktop app. The web version is online only.

## Open it

The first deployment is private to a Tailscale tailnet. `tailscale serve` gives the server an HTTPS
address on the tailnet and forwards it to the server on loopback:

```sh
tailscale serve status                                   # look first; only add a handler
tailscale serve --bg --https=8445 http://127.0.0.1:4876  # this server's port
tailscale serve --https=8445 off                         # removes only this handler
```

The address is then `https://<machine>.<tailnet>.ts.net:8445`. Start the server with:

- `MEETLESS_AGENT_URL=https://<machine>.<tailnet>.ts.net:8445`, so the web origin is trusted and the agent
  setup commands use it;
- `MEETLESS_TRUST_PROXY=1`, so the server sees `https` and the client's address through the proxy;
- `MEETLESS_WEB_DIR=<repo>/apps/desktop/dist/renderer` after `pnpm --filter @meetless/desktop exec vite build`
  (this is the default path; `off` turns the web app off).

## Sign in on a phone

1. Install Tailscale on the phone and sign in to the same tailnet.
2. Open the address above in the browser.
3. Enter your name and an invite code, or paste a personal token.

The first account comes from the one-time admin invite in `<dataDir>/admin-invite.txt` on the server.
Later accounts come from a project's 「成员」/ Members page, which creates project invites. Never paste an
invite or a token into chat or a document.

## What works where

Everything works on the web: needs, handoffs, inputs and uploads, artifacts (OnlyOffice view and the page
image fallback), deliveries, the project agent, invites and agent tokens.

Three things need the desktop app, because they read the local disk or run a local OAuth callback. The web
shows 「请在桌面版使用」 / "Use the desktop app for this" in their place:

- capture from a local git repository;
- Overleaf git capture;
- Notion connect.

The web keeps no offline copy. If the connection drops, a change is refused with 「未连接服务器，没有保存」
/ "Not connected. Nothing was saved." and nothing is queued. A reload signs you back in and fetches
everything again.

## Phone layout

Below 760px wide:

- the sidebar is a drawer behind the menu button;
- cards stack in one column;
- a need opens as a full page with a back button;
- dialogs open as bottom sheets;
- the composer stays at the bottom, above the on-screen keyboard;
- touch targets are at least 44px.

Wider windows look like the desktop app.

## Security

- **Session.** Signing in sets `ml_session`, an `HttpOnly; Secure; SameSite=Lax` cookie that lasts 30 days.
  Script can never read it, and it is never put in `localStorage` or a URL.
  - A token sign-in creates a separate web token, so signing out of the web never ends the desktop
    session or revokes the pasted token.
  - Signing out revokes the web session and closes its connections.
- **Writes.** A write made with the cookie needs the `x-meetless-csrf` header to match the `ml_csrf`
  cookie (double submit). It also needs an allowed `Origin`, when the browser sends one. The websocket
  needs an allowed `Origin` too. The allowed origins are the server's own and that of `MEETLESS_AGENT_URL`.
- **Scope.** The cookie is accepted only on routes the app uses, never on `/mcp`. Agent tokens and MCP
  work as before.
- **Rate limits.** Failed sign-ins and failed invite redemptions count against the same per-IP limits as
  on the desktop.
- **Page headers.** Pages are served with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`),
  `nosniff` and `Referrer-Policy: same-origin`.
- **Error reports.** `POST /v1/client-error` takes boot and render errors from the page with no sign-in.
  It allows 30 reports per IP per 10 minutes, caps the body at 8 KB, and keeps only fixed fields. Each
  report becomes one line in the server log, prefixed `[meetless-client-error]`. Cookies and query
  strings are never logged.

## OnlyOffice through the server

A browser cannot reach DocumentServer on the server's loopback. So the server proxies it under `/office/`
(HTTP and websocket). The proxy strips the `/office` prefix, drops the browser's cookies, and tells
DocumentServer its public path through `X-Forwarded-Host`. Web sessions get `<origin>/office` as the
DocumentServer URL; the desktop keeps the direct one.

On a tailnet this is fine. Two limits matter for a public deployment:

- the editor runs on the same origin as Meetless;
- anyone who can reach the server can reach DocumentServer under `/office/`, without signing in.

A public deployment should give DocumentServer its own origin, or require a session on `/office/`.

## Slow links

A phone on a relayed Tailscale connection (DERP) can be slow and lossy. The server compresses text assets
(brotli or gzip), which brings the boot download to about 160 KB. `boot.js` loads before the app and does
three things:

- it retries a stylesheet or script that failed to load, twice;
- if the page still cannot start, it shows the reason with a 「重试 / Retry」 button;
- it reports the error to the server, retrying the report until it gets through.

The server log has one `[meetless-web-asset]` line per asset transfer, with its status, size, encoding,
duration and whether it was cut off.

## Limits

- Online only: no offline edits, no outbox.
- No push notifications and no installable app (no PWA manifest or service worker).
- The browser build targets Safari 15 and newer, and current Chrome, Edge and Firefox.
- Local git, Overleaf and Notion capture are desktop only.
