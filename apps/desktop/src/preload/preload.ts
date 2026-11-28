import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { BRIDGE_METHODS, type BridgeEvent, type MeetlessBridge } from '@meetless/client/bridge';
import { invokeChannel, PUSH_CHANNEL } from '../shared/ipc';

// Exposes exactly the typed bridge surface; no ipcRenderer, no Node APIs reach the renderer.
const call =
  <M extends keyof Omit<MeetlessBridge, 'subscribe'>>(m: M) =>
  (...args: Parameters<MeetlessBridge[M]>) =>
    ipcRenderer.invoke(invokeChannel(m), ...args) as ReturnType<MeetlessBridge[M]>;

const methods = Object.fromEntries(BRIDGE_METHODS.map((m) => [m, call(m)])) as Omit<MeetlessBridge, 'subscribe'>;

const bridge: MeetlessBridge = {
  ...methods,
  subscribe(cb) {
    const listener = (_e: IpcRendererEvent, msg: BridgeEvent) => cb(msg);
    ipcRenderer.on(PUSH_CHANNEL, listener);
    return () => ipcRenderer.removeListener(PUSH_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld('meetless', bridge);

// What this host can do beyond the network bridge, for UIs that run on the web too (the Expo app):
// a button for one of these shows only when it is listed. Plain data, no functions.
contextBridge.exposeInMainWorld('meetlessShell', {
  host: 'electron',
  platform: process.platform,
  capabilities: ['localGit', 'overleafGit', 'notionMcp', 'pickDirectory', 'appUpdates', 'openLogs'],
});
