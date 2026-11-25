/** A new client-side id: `<prefix>-<uuid>`. Ids never change meaning, so they are random, not counted. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
