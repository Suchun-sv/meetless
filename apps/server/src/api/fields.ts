import { ApiError } from './frame';

/**
 * Request field guards. A route's TS types say what each field is, but nothing enforces that on
 * the wire: a JSON body or query can carry a number, an object or nothing at all where a string
 * belongs. Every handler runs its fields through these before doing anything else, so a caller's
 * mistake answers `400 BAD_REQUEST { field }` instead of a `TypeError` deep inside (`500
 * INTERNAL`), and nothing is appended. They check types only; whether a value is allowed (an
 * enum, a date, a non-empty title) stays the handler's or core's rule.
 */

const bad = (field: string): ApiError => new ApiError('BAD_REQUEST', { field });

/** A required string (it may be empty; the caller decides whether that is allowed). */
export function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw bad(field);
  return v;
}

/** An optional or nullable string: absent or `null` is `null`; any other non-string is BAD_REQUEST. */
export function optString(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw bad(field);
  return v;
}

/** A required boolean: exactly `true` or `false`; missing, `"yes"`, `1` and the like are BAD_REQUEST. */
export function reqBool(v: unknown, field: string): boolean {
  if (v !== true && v !== false) throw bad(field);
  return v;
}

/** An optional integer (a query's plain digits already arrive as a number): absent or `null` is `undefined`. */
export function optInt(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw bad(field);
  return v;
}

/** An optional plain object (not an array): absent or `null` is `null`. */
export function optObject(v: unknown, field: string): Record<string, unknown> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad(field);
  return v as Record<string, unknown>;
}

/** Every named field must be a string (path params, required ids); throws on the first that is not. */
export function reqStrings(req: Record<string, unknown>, ...fields: string[]): void {
  for (const f of fields) reqString(req[f], f);
}
