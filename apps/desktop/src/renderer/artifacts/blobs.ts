import { useEffect, useState } from 'react';
import type { MeetlessBridge } from '@meetless/client/bridge';
import { useApp } from '../app/AppContext';

/**
 * Object URLs for a set of page-image blob hashes (`version.derived.pageHashes`), read through
 * `bridge.readBlob` as PNGs. Revoked on unmount and whenever `hashes` changes, so it never leaks:
 * creation checks the cancelled flag before every `createObjectURL`, and cleanup revokes only what
 * was actually created so far (no url is ever created after cleanup has run).
 */
export function useBlobUrls(hashes: string[]): (string | null)[] {
  const { bridge } = useApp();
  const key = hashes.join(',');
  const [urls, setUrls] = useState<(string | null)[]>(() => hashes.map(() => null));

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setUrls(hashes.map(() => null));
    void (async () => {
      for (let i = 0; i < hashes.length; i++) {
        if (cancelled) return;
        const r = await bridge.readBlob(hashes[i]!);
        if (cancelled) return;
        if (r.ok) {
          const url = URL.createObjectURL(new Blob([new Uint8Array(r.bytes)], { type: 'image/png' }));
          created.push(url);
          setUrls((prev) => {
            const next = [...prev];
            next[i] = url;
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // `key` stands in for `hashes` (a fresh array every render would otherwise re-run this every time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bridge]);

  return urls;
}

/**
 * Downloads a blob through the bridge as `filename` (the fallback's "original file" link, task 8).
 * Resolves the bridge's refusal when the blob cannot be read (M7), so the caller can show
 * `errorText(code)` instead of failing silently.
 */
export async function downloadBlob(bridge: MeetlessBridge, hash: string, filename: string, mediaType: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const r = await bridge.readBlob(hash);
  if (!r.ok) return { ok: false, code: r.code };
  const url = URL.createObjectURL(new Blob([new Uint8Array(r.bytes)], { type: mediaType }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true };
}
