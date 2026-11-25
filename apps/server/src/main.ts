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
console.log(
  `[meetless-server] listening on ${server.url} (store: ${server.service.store.kind}, data: ${cfg.dataDir}, office files socket: ${server.filesSocket ?? 'off'})`,
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
