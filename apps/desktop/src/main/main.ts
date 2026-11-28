import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { isWebUrl } from '@meetless/core';
import { BRIDGE_METHODS, ClientNode, createFileLog, type BridgeEvent, type BridgeMethod, type FileLog, type MeetlessBridge } from '@meetless/client';
import { invokeChannel, PUSH_CHANNEL } from '../shared/ipc';
import { BUILD_CHANNEL, BUILD_LABEL, BUILD_NOTE } from './build-info';
import { HotUpdater, type BuildInfo, type Shell } from './hot-update';
import { installKind, ReleaseUpdater } from './release-updater';
import { runSmokeChecks } from './smoke-checks';

/**
 * Electron main process. It owns the sync connection and the local SQLite
 * cache (via ClientNode) and exposes them to the renderer only through the
 * narrow IPC bridge declared in @meetless/client/bridge. The renderer has no
 * Node access (contextIsolation on, nodeIntegration off, sandbox on).
 *
 * Environment (all optional):
 * - MEETLESS_SMOKE=1            headless smoke mode: no window, JSON result on stdout, exit (docs/MACOS.md)
 * - MEETLESS_USER_DATA_DIR      Electron userData (Chromium profile); default is the OS location
 * - MEETLESS_CLIENT_DATA_DIR    client cache/session dir; default <userData>/meetless
 * - MEETLESS_LAUNCH_INACTIVE=1  show the window without activating the app (acceptance runs)
 * - MEETLESS_LOG_DIR            folder of the rotating diagnostics log; default app.getPath('logs')
 * - MEETLESS_LOG_FILE           also append the main-process log lines to this file
 * - MEETLESS_RENDERER_URL       dev only (ignored when packaged): load the renderer from a dev server (Vite, or Expo web)
 * - MEETLESS_UPDATE_BASE        dev only: look for releases here instead of GitHub (docs/RELEASE.md)
 */
const SMOKE = process.env.MEETLESS_SMOKE === '1';
const INACTIVE = process.env.MEETLESS_LAUNCH_INACTIVE === '1';

/** The Expo renderer's origin (a privileged scheme served from dist/renderer, see runApp). */
const APP_ORIGIN = 'app://meetless';
/** The renderer's CSP, as in the legacy renderer's index.html (vite.config.ts) and scripts/build-renderer.mjs. */
const RENDERER_CSP =
  "default-src 'self'; script-src 'self' http://127.0.0.1:55435; frame-src 'self' http://127.0.0.1:55435; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*";
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/**
 * Diagnostics log: in the normal app always written (macOS: ~/Library/Logs/Meetless/main.log), rotating.
 * Covers start-up, sign-in attempts (server URL + result code, never the token), IPC
 * handler errors and uncaught exceptions. Smoke mode keeps stdout for the JSON result only.
 */
let fileLog: FileLog | null = null;
function writeExtra(line: string): void {
  if (!process.env.MEETLESS_LOG_FILE) return;
  try {
    appendFileSync(process.env.MEETLESS_LOG_FILE, `${line}\n`);
  } catch {
    // logging must never break the app
  }
}
function log(msg: string, data?: unknown): void {
  const text = `${msg}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
  if (fileLog) fileLog.info(text);
  else if (SMOKE) process.stderr.write(`[meetless] ${new Date().toISOString()} ${text}\n`);
  else console.log(`[meetless] ${text}`);
  writeExtra(`[meetless] ${new Date().toISOString()} ${text}`);
}
function logError(msg: string, e?: unknown): void {
  if (fileLog) fileLog.error(msg, e);
  else console.error(`[meetless] ${msg}`, e);
  writeExtra(`[meetless] ${new Date().toISOString()} ERROR ${msg} ${e instanceof Error ? e.stack ?? e.message : String(e ?? '')}`);
}
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

/** Temp dirs created by this process (smoke mode only); removed before exit. */
const ownTempDirs: string[] = [];
function ownTempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  ownTempDirs.push(d);
  return d;
}

// Must happen before 'ready': Chromium writes its profile to userData.
// Smoke mode never touches the real profile location.
const userData = process.env.MEETLESS_USER_DATA_DIR ?? (SMOKE ? ownTempDir('meetless-smoke-userdata-') : undefined);
if (userData) app.setPath('userData', userData);

if (SMOKE) runSmoke();
else runApp();

// ------------------------------------------------------------------ smoke mode

function runSmoke(): void {
  app.dock?.hide();
  const watchdog = setTimeout(() => {
    process.stdout.write(`${JSON.stringify({ meetlessSmoke: 1, ok: false, error: 'timeout' })}\n`, () => app.exit(2));
  }, 60_000);
  void app.whenReady().then(async () => {
    app.dock?.hide();
    const dataDir = process.env.MEETLESS_CLIENT_DATA_DIR ?? ownTempDir('meetless-smoke-data-');
    const appPath = app.getAppPath();
    const checks = await runSmokeChecks({ dataDir, systemLocales: app.getPreferredSystemLanguages() });
    const windows = BrowserWindow.getAllWindows().length;
    checks.push({ name: 'no BrowserWindow created', ok: windows === 0, detail: { windows } });
    checks.push({ name: 'main bundle loaded from app.asar', ok: !app.isPackaged || appPath.endsWith('app.asar'), detail: { appPath, mainFile: __filename } });
    const result = {
      meetlessSmoke: 1,
      ok: checks.every((c) => c.ok),
      app: { name: app.getName(), version: app.getVersion(), build: BUILD_LABEL, channel: BUILD_CHANNEL, packaged: app.isPackaged },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        execPath: process.execPath,
        dockVisible: app.dock ? app.dock.isVisible() : null,
        systemLocales: app.getPreferredSystemLanguages(),
      },
      dirs: { userData: app.getPath('userData'), dataDir, removedAfterRun: ownTempDirs.length > 0 },
      checks,
    };
    clearTimeout(watchdog);
    for (const d of ownTempDirs) rmSync(d, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify(result)}\n`, () => app.exit(result.ok ? 0 : 1));
  });
}

// ------------------------------------------------------------------ normal app

function runApp(): void {
  let node: ClientNode | null = null;
  let win: BrowserWindow | null = null;
  const logDir = () => process.env.MEETLESS_LOG_DIR ?? app.getPath('logs');

  // A packaged app always loads its own renderer: an environment variable must not be able to give
  // a remote page the preload bridge.
  const rendererUrl = app.isPackaged ? undefined : process.env.MEETLESS_RENDERER_URL;
  const rendererOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
  const ownPage = (url: string): boolean => {
    if (!rendererOrigin) return url.startsWith('file://') || url.startsWith(`${APP_ORIGIN}/`);
    try {
      return new URL(url).origin === rendererOrigin;
    } catch {
      return false;
    }
  };

  /** The renderer to load: the bundled one, or a reload-only hot update's once it was applied. */
  let rendererDir = join(__dirname, '../renderer');
  /**
   * Which UI dist/renderer holds (MEETLESS_UI at build time, scripts/build-renderer.mjs): the Expo web
   * export (apps/app, served on app://meetless with a single-page fallback, since its asset paths are
   * absolute and Expo Router owns the path) or the legacy Vite renderer (file://).
   */
  const isExpo = (dir: string) => existsSync(join(dir, '_expo'));
  // Expo Router web reads the route from the path, which file:// cannot carry: a standard, secure
  // scheme of our own. Registered before 'ready'; served in whenReady below.
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const serveRenderer = (req: Request): Response => {
    const url = new URL(req.url);
    if (url.host !== 'meetless') return new Response(null, { status: 404 });
    const root = rendererDir;
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return new Response(null, { status: 403 });
    const isFile = (f: string) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    };
    if (!isFile(file)) {
      // A missing asset is a 404; any other path is a route, which index.html renders.
      if (/^\/(_expo|assets|fonts)\//.test(path) || extname(path)) return new Response(null, { status: 404 });
      file = join(root, 'index.html');
    }
    const html = file.endsWith('.html');
    return new Response(readFileSync(file), {
      headers: {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
        // The same policy as the meta tag the build puts in index.html.
        ...(html ? { 'content-security-policy': RENDERER_CSP } : {}),
      },
    });
  };
  /** Loads the current renderer into `w`, on `route` when it is one for that UI (Expo: a path; legacy: the route object). */
  const loadRenderer = async (w: BrowserWindow, route: unknown): Promise<void> => {
    if (rendererUrl) return w.loadURL(rendererUrl);
    if (isExpo(rendererDir)) {
      let target = `${APP_ORIGIN}/`;
      if (typeof route === 'string' && route.startsWith('/') && !route.startsWith('//')) {
        const u = new URL(route, `${APP_ORIGIN}/`);
        if (u.host === 'meetless') target = u.href;
      }
      return w.loadURL(target);
    }
    const legacyRoute = route && typeof route === 'object' ? route : null;
    return w.loadFile(join(rendererDir, 'index.html'), legacyRoute ? { query: { route: JSON.stringify(legacyRoute) } } : undefined);
  };

  async function createWindow(): Promise<void> {
    // After a silent hot-update relaunch: the window where it was, on the route it showed.
    const back = restore;
    restore = null;
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      ...(back?.bounds ?? {}),
      minWidth: 960,
      minHeight: 600,
      title: 'Meetless',
      show: !INACTIVE,
      webPreferences: {
        preload: join(__dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    if (INACTIVE) {
      const w = win;
      w.once('ready-to-show', () => {
        w.showInactive();
        log('window shown inactive', { focused: w.isFocused() });
      });
    }
    // Links open in the system browser, never inside the app window, and only http(s): any other
    // scheme (file:, smb:, protocol handlers) would be handed straight to the OS.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url);
      else log('blocked link', { scheme: url.split(':', 1)[0]?.slice(0, 20) ?? '' });
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!ownPage(url)) e.preventDefault();
    });
    // OnlyOffice viewer (U3): sub-frames may load only the DocumentServer origin, about:blank, or the
    // Expo renderer's own host page for it (apps/app/public/office-frame.html, which has no bridge).
    win.webContents.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && !(e.url.startsWith('http://127.0.0.1:55435/') || e.url === 'about:blank' || e.url === `${APP_ORIGIN}/office-frame.html`)) e.preventDefault();
    });
    win.webContents.on('did-finish-load', () => {
      log('renderer loaded');
      // A hot copy that got this far started fine (src/boot/boot.cjs).
      (globalThis as { __meetlessHot?: { ready(): void } }).__meetlessHot?.ready();
    });
    win.webContents.on('render-process-gone', (_e, d) => logError('renderer gone', d));
    // The Expo renderer's route is its path: kept as it changes, saved when the window closes.
    win.webContents.on('did-navigate', (_e, url) => rememberRoute(url));
    win.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) rememberRoute(url);
    });
    win.on('close', () => saveRoute());
    log('window created', { inactive: INACTIVE, ui: rendererUrl ? 'dev' : isExpo(rendererDir) ? 'expo' : 'legacy' });
    await loadRenderer(win, back?.route ?? lastRoute);
    if (back?.minimized) win.minimize();
  }

  app.setAboutPanelOptions({
    applicationName: 'Meetless',
    applicationVersion: `${app.getVersion()}${(globalThis as { __meetlessHot?: { commit: string } }).__meetlessHot ? ` ${(globalThis as { __meetlessHot?: { commit: string } }).__meetlessHot!.commit.slice(0, 7)}` : ''}`,
    version: BUILD_LABEL,
    credits: BUILD_NOTE,
  });

  // App updates (docs/RELEASE.md): checks on start and every 6 hours, installs only on the user's click.
  // A dev run checks only when pointed at a test server.
  const devUpdateBase = app.isPackaged ? undefined : process.env.MEETLESS_UPDATE_BASE;
  /**
   * Every updater request: the default session first (the system proxy and PAC); on a network-level
   * failure (connection, proxy or tunnel error, timeout) once more through a session with no proxy,
   * for a flaky local proxy port while a TUN route still works. The checks on the answer are the
   * callers' own (final-URL allowlist, size caps, signature, SHA-512, codesign).
   */
  let directSession: Promise<Electron.Session> | null = null;
  const NET_ERROR = /ERR_(CONNECTION|PROXY|TUNNEL)_|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_SOCKS/;
  const netError = (e: unknown) => {
    const err = e as { name?: string; message?: string } | null;
    return err?.name === 'TimeoutError' || err?.name === 'AbortError' || NET_ERROR.test(String(err?.message ?? ''));
  };
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  };
  async function updaterFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      const res = await net.fetch(url, init);
      log('updater request', { via: 'proxy', host: hostOf(url) });
      return res;
    } catch (e) {
      if (!netError(e)) throw e;
      directSession ??= (async () => {
        const s = session.fromPartition('meetless-updater-direct');
        await s.setProxy({ mode: 'direct' });
        return s;
      })();
      const s = await directSession;
      // A timed-out first try has used up its signal: the retry gets its own.
      const signal = init.signal?.aborted ? AbortSignal.timeout(/\.zip(\?|$)/.test(url) ? 30 * 60_000 : 20_000) : init.signal;
      const res = await s.fetch(url, { ...init, ...(signal ? { signal } : {}) });
      log('updater request', { via: 'direct', host: hostOf(url), after: String((e as Error).message ?? e).slice(0, 80) });
      return res;
    }
  }

  // Hot updates from the beta channel (src/main/hot-update.ts), packaged builds only.
  const readJson = <T>(f: string): T | null => {
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as T;
    } catch {
      return null;
    }
  };
  const runningBuild = readJson<BuildInfo>(join(__dirname, '../build.json'));
  const relaunchFile = join(app.getPath('userData'), 'hot', 'relaunch.json');
  let restore = readJson<{ bounds?: Electron.Rectangle; minimized?: boolean; route?: unknown }>(relaunchFile);
  rmSync(relaunchFile, { force: true });
  // A normal quit and reopen (or a closed and reopened window on macOS) comes back on the last route
  // too: the Expo renderer's path, saved in <userData>/last-route.json. The legacy renderer has none.
  const lastRouteFile = join(app.getPath('userData'), 'last-route.json');
  let lastRoute: string | null = readJson<{ route?: unknown }>(lastRouteFile)?.route as string | null;
  if (typeof lastRoute !== 'string' || !lastRoute.startsWith('/')) lastRoute = null;
  const rememberRoute = (url: string) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) return;
    const u = new URL(url);
    lastRoute = `${u.pathname}${u.search}`;
  };
  const saveRoute = () => {
    try {
      mkdirSync(dirname(lastRouteFile), { recursive: true });
      writeFileSync(lastRouteFile, JSON.stringify({ route: lastRoute }));
    } catch (e) {
      logError('saving the route failed', e);
    }
  };
  const rendererRoute = async (w: BrowserWindow) => {
    try {
      // Legacy renderer: its route object. Expo: the path Expo Router shows.
      const js = `JSON.stringify(window.__meetlessRoute ? window.__meetlessRoute() : location.protocol === 'app:' ? location.pathname + location.search : null)`;
      return JSON.parse((await w.webContents.executeJavaScript(js, true)) as string) as unknown;
    } catch {
      return null;
    }
  };
  const installedShell = readJson<Shell>(join(app.getAppPath(), 'dist', 'shell.json'));
  const runningHot = (globalThis as { __meetlessHot?: { commit: string } }).__meetlessHot?.commit ?? null;
  const pushUpdate = () => {
    const e: BridgeEvent = { type: 'update', update: { ...updater.current, hot: hotInfo() } };
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(PUSH_CHANNEL, e);
  };
  const hot = new HotUpdater({
    hotDir: join(app.getPath('userData'), 'hot'),
    running: runningBuild ?? { commit: 'dev', version: app.getVersion(), built: new Date().toISOString(), parts: { main: '', preload: '', renderer: '' } },
    shell: installedShell ?? { electron: process.versions.electron, abi: process.versions.modules, fuses: '' },
    runningHot,
    enabled: app.isPackaged && !!runningBuild && !!installedShell && process.env.MEETLESS_NO_HOT !== '1',
    ...(process.env.MEETLESS_HOT_BASE && !app.isPackaged ? { baseUrl: process.env.MEETLESS_HOT_BASE } : {}),
    fetch: updaterFetch,
    log: (m) => log(m),
    onChange: () => pushUpdate(),
  });
  const hotInfo = () => {
    const s = hot.state;
    return { commit: (s.running ?? runningBuild?.commit ?? '').slice(0, 7) || null, restart: s.pending?.apply === 'restart', pending: s.pending };
  };
  /**
   * The user's click on a hot update (nothing applies it on its own; it runs at the next start
   * anyway): a renderer-only one reloads the window on the same route, any other relaunches with
   * the window's bounds and route kept.
   */
  const applyHot = async (): Promise<boolean> => {
    const p = hot.state.pending;
    const w = win;
    if (!p || !w) return false;
    const route = await rendererRoute(w);
    if (p.apply === 'reload') {
      rendererDir = dirname(hot.rendererOf(p.commit));
      log('hot reload', { commit: p.commit.slice(0, 7), ui: isExpo(rendererDir) ? 'expo' : 'legacy' });
      await loadRenderer(w, route);
      hot.applied(p.commit);
      return true;
    }
    mkdirSync(dirname(relaunchFile), { recursive: true });
    writeFileSync(relaunchFile, JSON.stringify({ bounds: w.getNormalBounds(), minimized: w.isMinimized(), route }));
    log('hot relaunch', { commit: p.commit.slice(0, 7) });
    app.relaunch();
    app.quit();
    return true;
  };

  const updater = new ReleaseUpdater({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    kind: installKind({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE }),
    enabled: app.isPackaged || !!devUpdateBase,
    ...(devUpdateBase ? { baseUrl: devUpdateBase, apiUrl: `${devUpdateBase}/api` } : {}),
    // The running bundle: .../Meetless.app/Contents/MacOS/Meetless.
    bundlePath: process.platform === 'darwin' ? resolve(app.getPath('exe'), '..', '..', '..') : undefined,
    relaunch: () => {
      app.relaunch();
      setTimeout(() => app.quit(), 500);
    },
    log: (m) => log(m),
    // Chromium's network stack: the macOS system proxy and PAC apply, which Node's fetch ignores.
    fetch: updaterFetch,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    onChange: () => pushUpdate(),
  });

  app.whenReady().then(async () => {
    fileLog = createFileLog(logDir(), { echo: true });
    log('start', {
      version: app.getVersion(),
      build: BUILD_LABEL,
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      logs: fileLog.file,
    });
    node = await ClientNode.open({
      log: (m: string) => log(m),
      openLogs: async () => (await shell.openPath(logDir())) === '',
      dataDir: process.env.MEETLESS_CLIENT_DATA_DIR ?? join(app.getPath('userData'), 'meetless'),
      systemLocales: app.getPreferredSystemLanguages(),
      host: 'electron',
      // The only way a local path enters the app: the user picks a folder. The renderer's hint is ignored.
      pickDirectory: async () => {
        const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : null;
        return r && !r.canceled ? (r.filePaths[0] ?? null) : null;
      },
      updates: {
        check: async () => {
          void hot.check();
          return { ...(await updater.check()), hot: hotInfo() };
        },
        // The click: a full release when one is offered (it swaps the bundle), else the hot update waiting.
        install: async () => {
          if (updater.current.available) return updater.install();
          return (await applyHot()) ? { ok: true } : { ok: false, code: 'UPDATE_NONE' };
        },
      },
    });
    log('client opened', { session: (await node.snapshot()).session !== null });
    protocol.handle('app', (req) => serveRenderer(req));
    node.subscribe((e) => {
      if (e.type === 'status') log('sync status', { state: e.status.state });
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(PUSH_CHANNEL, e);
    });
    for (const m of BRIDGE_METHODS) {
      ipcMain.handle(invokeChannel(m), async (event, ...args: unknown[]) => {
        // Only our own window may call the bridge (compared by id: sender objects need not be identical).
        if (!win || event.sender.id !== win.webContents.id) {
          logError(`IPC ${m} rejected: unknown sender ${event.sender.id}`);
          throw new Error('unknown sender');
        }
        const fn = node![m as BridgeMethod] as (...a: unknown[]) => Promise<unknown>;
        try {
          return (await fn.apply(node, args)) as Awaited<ReturnType<MeetlessBridge[typeof m]>>;
        } catch (e) {
          logError(`IPC ${m} failed`, e);
          throw e;
        }
      });
    }
    await createWindow();
    updater.start();
    hot.start();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // A full release downloaded in the background and never clicked goes in as the app quits.
  app.on('will-quit', () => updater.installOnQuit());

  app.on('before-quit', () => {
    log('quit');
    saveRoute();
    void node?.close();
  });
}
