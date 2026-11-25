import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startBridgeHost } from './host';

// DEV/TEST ONLY. Usage: dev:bridge --data-dir .data/dev/client-a --port 4871 --locale zh-CN [--token t]  (pnpm dev uses 4871/4872)
const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    port: { type: 'string', default: '0' },
    locale: { type: 'string', default: 'en-US' },
    token: { type: 'string' },
  },
});
if (!values['data-dir']) throw new Error('--data-dir is required');
const host = await startBridgeHost({
  dataDir: resolve(values['data-dir']),
  port: Number(values.port),
  systemLocales: [values.locale!],
  ...(values.token ? { token: values.token } : {}),
});
console.log(`[meetless-dev-bridge] ${host.url} token=${host.token} data=${resolve(values['data-dir'])} (DEV/TEST ONLY)`);
process.on('SIGINT', () => void host.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void host.close().then(() => process.exit(0)));
