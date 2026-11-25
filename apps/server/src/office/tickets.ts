import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A ticket's lifetime (brief: 15 minutes, long enough for DocumentServer to fetch and re-fetch the file during a view session). */
export const TICKET_TTL_MS = 15 * 60_000;

export type OfficeTicketExt = 'docx' | 'pptx' | 'pdf';

interface TicketFile {
  hash: string;
  mediaType: string;
  ext: OfficeTicketExt;
}

interface TicketPayload extends TicketFile {
  exp: number;
}

const EXTS: ReadonlySet<string> = new Set(['docx', 'pptx', 'pdf']);

function isTicketPayload(v: unknown): v is TicketPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as TicketPayload).hash === 'string' &&
    typeof (v as TicketPayload).mediaType === 'string' &&
    typeof (v as TicketPayload).exp === 'number' &&
    EXTS.has((v as TicketPayload).ext)
  );
}

/**
 * Short-lived, HMAC-signed tickets naming one blob (hash + media type + extension) that the
 * files socket (`startFilesSocket`) will serve without any further auth check — the ticket
 * itself *is* the authorisation (design: "DocumentServer reachability"). One instance's
 * secret must be shared by whatever issues tickets (`OfficeViewer.config`) and whatever
 * verifies them (the socket), so the two always agree; a ticket from a different instance
 * (a different secret, "another server") never verifies here, by construction.
 */
export class OfficeTickets {
  private readonly secret: Uint8Array;
  private readonly now: () => number;

  /** `secret` defaults to 32 random bytes generated once per instance ("per process" in the usual single-instance-per-process server). */
  constructor(secret?: Uint8Array, now?: () => number) {
    this.secret = secret ?? randomBytes(32);
    this.now = now ?? (() => Date.now());
  }

  issue(f: TicketFile): string {
    const payload: TicketPayload = { hash: f.hash, mediaType: f.mediaType, ext: f.ext, exp: this.now() + TICKET_TTL_MS };
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(payloadPart).digest('base64url');
    return `${payloadPart}.${sig}`;
  }

  /** `null` for anything structurally wrong, a bad signature (wrong secret, tampering) or an expired ticket. */
  verify(t: string): TicketFile | null {
    const dot = t.indexOf('.');
    if (dot < 0) return null;
    const payloadPart = t.slice(0, dot);
    const sigPart = t.slice(dot + 1);
    if (sigPart.includes('.')) return null; // exactly two parts

    // Compare the *encoded* signature strings, not the decoded bytes: `Buffer.from(_,
    // 'base64url')` decodes leniently (it silently drops characters a strict decoder would
    // reject), so comparing after decoding could accept a sigPart that is not byte-identical
    // to the one this ticket was actually issued with. Comparing the raw strings (after an
    // explicit length check, so `timingSafeEqual` never sees mismatched buffer lengths) has
    // no such gap.
    const expectedSigPart = createHmac('sha256', this.secret).update(payloadPart).digest('base64url');
    const got = Buffer.from(sigPart, 'utf8');
    const expected = Buffer.from(expectedSigPart, 'utf8');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!isTicketPayload(payload) || this.now() > payload.exp) return null;
    return { hash: payload.hash, mediaType: payload.mediaType, ext: payload.ext };
  }
}
