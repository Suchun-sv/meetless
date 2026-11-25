/**
 * Minimal HTTP client for the Meetless API route contract (`@meetless/api`).
 * Used by `ClientNode.api()` (routes reachable from the app, with the user's
 * bearer token) and by `redeemInvite` (the one route callable with no
 * session yet). Never throws: every outcome is a coded `Result`.
 */
import { requestParts, type ApiErrorBody, type ApiName } from '@meetless/api';
import type { Result } from './bridge';

export interface CallApiOptions {
  fetchImpl?: typeof fetch;
  /** E.g. `AbortSignal.timeout(ms)`; an abort or a timeout is reported as `TIMEOUT`. */
  signal?: AbortSignal;
}

export async function callApi(base: string, token: string | null, name: ApiName, input: unknown, opts: CallApiOptions = {}): Promise<Result<{ data: unknown }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { method, url, body } = requestParts(name, input, base);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== null ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== null ? { body } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return { ok: false, code: 'TIMEOUT' };
    return { ok: false, code: 'NETWORK', details: (e as Error).message };
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, code: 'NETWORK', details: (e as Error).message };
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = (parsed as ApiErrorBody | null)?.error;
    return { ok: false, code: err?.code ?? `HTTP_${res.status}`, ...(err?.details !== undefined ? { details: err.details } : {}) };
  }
  return { ok: true, data: parsed };
}
