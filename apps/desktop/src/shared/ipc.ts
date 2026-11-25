/** IPC channel names shared by main and preload. One invoke channel per bridge method + one push channel. */
import type { BridgeMethod } from '@meetless/client/bridge';

export const invokeChannel = (m: BridgeMethod) => `meetless:${m}` as const;
export const PUSH_CHANNEL = 'meetless:push';
