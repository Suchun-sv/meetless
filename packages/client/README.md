# @meetless/client

`ClientNode` is the client sync engine that runs in the Electron main process. It keeps a
WebSocket subscription with resume-from-cursor and an outbox for commands that have not yet
been accepted; a rejection is kept and shown, never silently dropped. It also holds a
per-account `node:sqlite` cache (events, cursor, settings) and a permission-checked blob
cache. `@meetless/client/bridge` holds the renderer-safe bridge contract.
