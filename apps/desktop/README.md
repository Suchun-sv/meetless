# @meetless/desktop

- `src/main`, `src/preload`: the Electron main process owns sync and the SQLite cache
  (`@meetless/client`). The preload exposes only the typed `window.meetless` bridge
  (contextIsolation on, sandbox on, no nodeIntegration).
- `src/renderer`: the React UI. It uses the Claude Design prototype's tokens and classes
  (`styles/`), and all text comes from `@meetless/i18n`. It is driven by core state only.
- `src/bridge-host`: **DEV/TEST ONLY**. It runs the same client engine in plain Node so that
  headless Chromium can drive the renderer (`?bridge=…&bridgeToken=…`).
- `e2e/`: Playwright tests in headless Chromium. A real server process and separate client
  processes run behind it.
- `e2e-electron/`: the real Electron app under Xvfb in the `meetless-xvfb` container
  (`pnpm test:electron`).

Linux results are not macOS acceptance. macOS arm64 packaging (unsigned dev build, electron-builder,
`pnpm package:mac`, headless `MEETLESS_SMOKE=1`) and its results are in docs/MACOS.md.
See docs/ARCHITECTURE.md §6–§8.
