import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configFromEnv, startServer, type ServerConfig } from './server';

let cfg: ServerConfig;
let server: Awaited<ReturnType<typeof startServer>>;
try {
  // configFromEnv refuses bad settings (e.g. MEETLESS_DEV_AUTH=1 with NODE_ENV=production).
  cfg = configFromEnv();
  server = await startServer(cfg);
} catch (e) {
  // E.g. a schema written by another version: say which event and schema, and exit without writing.
  console.error(`[meetless-server] cannot start: ${(e as Error).message}`);
  process.exit(1);
}
// Says where the renderer is served from, that it is off, or that the directory has no
// index.html (design 2026-11-25 §4: `/` then answers 404, as it does with webDir off).
const web =
  cfg.webDir === null ? 'off' : existsSync(join(cfg.webDir, 'index.html')) ? cfg.webDir : `${cfg.webDir} (no index.html)`;
console.log(
  `[meetless-server] listening on ${server.url} (store: ${server.service.store.kind}, data: ${cfg.dataDir}, office files socket: ${server.filesSocket ?? 'off'}, web: ${web})`,
);
if (cfg.devAuth) {
  console.warn(
    `[meetless-server] DEV-ONLY authentication is enabled: fixed bearer tokens for ${cfg.devUsers.map((u) => u.id).join(', ')}. Do not expose this service.`,
  );
}
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
