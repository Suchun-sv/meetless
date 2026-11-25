/**
 * Writes `s` to the system clipboard (collab.jsx `copyText`). Resolves `false`, never throws,
 * when `navigator` or `navigator.clipboard` is missing (no DOM clipboard API, e.g. in tests) or
 * the write itself rejects (permission denied, no secure context, ...).
 */
export async function copyText(s: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
}
