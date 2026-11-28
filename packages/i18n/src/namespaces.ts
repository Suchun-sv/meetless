/**
 * Namespace ownership for the shared i18n catalogue (contract §6).
 *
 * Each key's first `.`-separated segment is its namespace (e.g. `nav.home` → `nav`,
 * or the bare key `close` → `close`). One parallel block owns each namespace, so
 * two blocks never collide on the same key. `catalogue.py` marks each block's
 * append-only section with a `# === <owner>` comment; blocks append only inside
 * their own section.
 */
export type Owner = 'base' | 'S' | 'U1' | 'U2' | 'U3';

/** Namespace → owning block, from contract §6. */
export const NAMESPACE_OWNERS: Readonly<Record<string, Owner>> = {
  // base
  app: 'base',
  common: 'base',
  close: 'base',
  error: 'base',
  sync: 'base',
  outbox: 'base',
  user: 'base',
  kind: 'base',
  st: 'base',
  ef: 'base',
  src: 'base',
  round: 'base',
  tl: 'base',
  afk: 'base',
  cp: 'base',
  t: 'base',
  ai: 'base',
  res: 'base',
  upd: 'base',
  // web and phone (design 2026-11-25)
  web: 'base',
  // Expo app shell (apps/app, P0). Expo page agents add their own namespaces next to it.
  xp: 'base',
  // A3 (chat, import, handoff, lineage pages)
  imp: 'U3',
  hx: 'U2',
  lnv: 'U2',
  dock: 'U1',
  cc: 'U1',
  inb: 'U3',
  // Expo A4 (search, settings)
  search: 'base',
  set: 'base',
  // S (server) — new; only if the server needs user-visible text
  srv: 'S',
  // U1 (shell and dashboards)
  signin: 'U1',
  nav: 'U1',
  cm: 'U1',
  top: 'U1',
  pj: 'U1',
  home: 'U1',
  ch: 'U1',
  ans: 'U1',
  sg: 'U1',
  db: 'U1',
  w: 'U1',
  pg: 'U1',
  mb: 'U1',
  rk: 'U1',
  sr: 'U1',
  wk: 'U1',
  mine: 'U1',
  ag: 'U1',
  inv: 'U1',
  rem: 'U1',
  // U2 (needs and collaboration)
  board: 'U2',
  nn: 'U2',
  dr: 'U2',
  view: 'U2',
  filter: 'U2',
  col: 'U2',
  card: 'U2',
  ho: 'U2',
  lk: 'U2',
  pv: 'U2',
  own: 'U2',
  ask: 'U2',
  cf: 'U2',
  pr: 'U2',
  lin: 'U2',
  // A2 (Expo needs and To confirm)
  need: 'U2',
  cfm: 'U2',
  rv: 'U2',
  // U3 (inputs and artifacts)
  in: 'U3',
  af: 'U3',
  stream: 'U3',
  dl: 'U3',
  cap: 'U3',
};

/**
 * The exact keys `contextLabels()` reads (see `src/index.ts`). Most of these live
 * under U2's `dr` namespace, but they are owned by base because they shape the
 * MCP context text that every block relies on (contract §6).
 */
export const CONTEXT_LABEL_KEYS: readonly string[] = [
  'round',
  'round.due',
  'dr.version',
  'dr.accept',
  'dr.expect',
  'dr.verify',
  'dr.verdict',
  'dr.source',
  'dr.rev',
  'dr.work',
  'dr.children',
  'dr.parent',
  'dr.artifacts',
  'cp.refuted',
  'cp.owner',
  'dr.requester',
  'cp.handoff',
  'cp.captured',
  'cp.mcp',
  'cp.report',
];
