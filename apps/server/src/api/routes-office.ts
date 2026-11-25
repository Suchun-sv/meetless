import type { Handler } from './frame';

/**
 * `office.config`: `OfficeViewer` does all the real work (privacy check, config shape,
 * signing). The real server always wires `deps.officeViewer` (`buildApp`, sharing one
 * `OfficeTickets` with the files socket so a ticket this issues is one the socket can
 * verify). A hand-built `ApiDeps` that never wired one (e.g. a unit test of the frame itself)
 * answers `not_configured` directly, rather than standing up a throwaway `OfficeViewer` whose
 * ticket secret could never match any real files socket anyway.
 */
const officeConfig: Handler<'office.config'> = async ({ p, req, http, deps }) => {
  if (!deps.officeViewer) return { available: false, reason: 'not_configured' };
  // A web session loads DocumentServer through this server's /office proxy (design 2026-11-25 §5).
  return deps.officeViewer.config(p, req, p.via === 'cookie' ? `${http.protocol}://${http.host}` : null);
};

/** Spread into `HANDLERS` in `api/index.ts`. */
export const OFFICE_HANDLERS = {
  'office.config': officeConfig,
};
