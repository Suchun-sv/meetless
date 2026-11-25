import { BRIDGE_METHODS, type BridgeEvent, type MeetlessBridge } from '@meetless/client/bridge';
import { decodeWire, encodeWire } from '../../shared/wire';

declare global {
  interface Window {
    /** Set by the Electron preload script. */
    meetless?: MeetlessBridge;
  }
}

/**
 * Electron: the preload bridge. Otherwise (dev / headless tests only):
 * `?bridge=<url>&bridgeToken=<token>` connects to a dev bridge host process.
 */
export function resolveBridge(): MeetlessBridge | null {
  if (window.meetless) return window.meetless;
  const q = new URLSearchParams(location.search);
  const url = q.get('bridge');
  const token = q.get('bridgeToken');
  return url && token ? createHttpBridge(url, token) : null;
}

/** DEV/TEST transport for the bridge contract (see src/bridge-host). Not used in the Electron app. */
export function createHttpBridge(url: string, token: string): MeetlessBridge {
  const call =
    <M extends keyof Omit<MeetlessBridge, 'subscribe'>>(m: M) =>
    async (...args: Parameters<MeetlessBridge[M]>): Promise<Awaited<ReturnType<MeetlessBridge[M]>>> => {
      const res = await fetch(`${url}/rpc/${m}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-meetless-bridge-token': token },
        body: JSON.stringify({ args: encodeWire(args) }),
      });
      const body = (await res.json()) as { result?: unknown; error?: string };
      if (!res.ok) throw new Error(body.error ?? `bridge ${m} failed`);
      return decodeWire(body.result) as Awaited<ReturnType<MeetlessBridge[M]>>;
    };
  const listeners = new Set<(e: BridgeEvent) => void>();
  let ws: WebSocket | null = null;
  const open = () => {
    ws = new WebSocket(`${url.replace(/^http/, 'ws')}/push?token=${encodeURIComponent(token)}`);
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as BridgeEvent;
      for (const l of listeners) l(e);
    };
    ws.onclose = () => {
      ws = null;
      if (listeners.size > 0) setTimeout(open, 500);
    };
  };
  const methods = Object.fromEntries(BRIDGE_METHODS.map((m) => [m, call(m)])) as unknown as Omit<MeetlessBridge, 'subscribe'>;
  return {
    ...methods,
    subscribe(cb) {
      listeners.add(cb);
      if (!ws) open();
      return () => listeners.delete(cb);
    },
  };
}
