import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, session, shell } from 'electron';
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
 * - MEETLESS_RENDERER_URL       dev only (ignored when packaged): load the renderer from the Vite dev server
 * - MEETLESS_UPDATE_BASE        dev only: look for releases here instead of GitHub (docs/RELEASE.md)
 */
const SMOKE = process.env.MEETLESS_SMOKE === '1';
const INACTIVE = process.env.MEETLESS_LAUNCH_INACTIVE === '1';

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
    if (!rendererOrigin) return url.startsWith('file://');
    try {
      return new URL(url).origin === rendererOrigin;
    } catch {
      return false;
    }
  };

  /** The renderer to load: the bundled one, or a reload-only hot update's once it was applied. */
  let rendererFile = join(__dirname, '../renderer/index.html');

  async function createWindow(): Promise<void> {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
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
    // OnlyOffice viewer (U3): sub-frames may load only the DocumentServer origin, or about:blank.
    win.webContents.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && !(e.url.startsWith('http://127.0.0.1:55435/') || e.url === 'about:blank')) e.preventDefault();
    });
    win.webContents.on('did-finish-load', () => {
      log('renderer loaded');
      // A hot copy that got this far started fine (src/boot/boot.cjs).
      (globalThis as { __meetlessHot?: { ready(): void } }).__meetlessHot?.ready();
    });
    win.webContents.on('render-process-gone', (_e, d) => logError('renderer gone', d));
    log('window created', { inactive: INACTIVE });
    if (rendererUrl) await win.loadURL(rendererUrl);
    else await win.loadFile(rendererFile);
  }

  app.setAboutPanelOptions({
    applicationName: 'Meetless',
    applicationVersion: app.getVersion(),
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
    onChange: (s) => {
      pushUpdate();
      if (s.pending?.apply === 'reload') reloadWhenIdle(s.pending.commit);
    },
  });
  const hotInfo = () => {
    const s = hot.state;
    return { commit: (s.running ?? runningBuild?.commit ?? '').slice(0, 7) || null, restart: s.pending?.apply === 'restart' };
  };
  // A renderer-only update: reload into it once nobody has touched the machine for a minute.
  let idleTimer: NodeJS.Timeout | null = null;
  const reloadWhenIdle = (commit: string) => {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (!win || powerMonitor.getSystemIdleTime() < 60) return;
      clearInterval(idleTimer!);
      idleTimer = null;
      rendererFile = hot.rendererOf(commit);
      log('hot reload', { commit: commit.slice(0, 7) });
      void win.loadFile(rendererFile, { query: { updated: commit.slice(0, 7) } }).then(() => hot.applied(commit));
    }, 15_000);
    idleTimer.unref?.();
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
        check: async () => ({ ...(await updater.check()), hot: hotInfo() }),
        // With no full release on offer, the click restarts into a hot update that needs it.
        install: async () => {
          if (!updater.current.available && hot.state.pending?.apply === 'restart') {
            app.relaunch();
            setTimeout(() => app.quit(), 300);
            return { ok: true };
          }
          return updater.install();
        },
      },
    });
    log('client opened', { session: (await node.snapshot()).session !== null });
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

  app.on('before-quit', () => {
    log('quit');
    void node?.close();
  });
}
