import { useEffect, useRef } from 'react';
import { noDots, type ArtifactKind, type DerivedPreview } from '@meetless/core';
import { useApp } from '../app/AppContext';

/**
 * Scrolls `page`'s block into view inside `container`, when both are known (ruling R13a). Kept as
 * its own helper so the mount/update effect that calls it stays a one-liner.
 */
export function scrollToPage(container: HTMLElement | null, page: number | undefined): void {
  if (!container || page == null) return;
  const el = container.querySelector(`[data-page="${page}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

/**
 * The LibreOffice page-image fallback (task 6 brief; design §8.5). `derived` is `null` while the
 * conversion has not run yet, `'failed'` when it errored, else one image per page from `urls`
 * (`useBlobUrls(derived.pageHashes)`), with the extracted text through `noDots` and the converter
 * credit. `page` (`route.page`, ruling R13a) marks the matching page (`data-page`, `.on`,
 * `aria-current="page"`) and is scrolled into view on mount and on every change.
 */
export function PagesPreview({
  kind,
  derived,
  urls,
  page,
}: {
  kind: ArtifactKind;
  derived: DerivedPreview | null;
  urls: (string | null)[];
  page?: number;
}) {
  const { t } = useApp();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => scrollToPage(ref.current, page), [page]);

  if (!derived) return <div className="faint small pad">{t('af.previewPending')}</div>;
  if (derived.status === 'failed') return <div className="faint small pad">{t('af.previewFailed')}</div>;

  const slide = kind === 'pptx';
  return (
    <div ref={ref} data-testid="af-pages" className="oo-canvas">
      {derived.pageHashes.map((_hash, i) => {
        const on = page === i;
        return (
          <div key={i} className={`oo-page${slide ? ' slide' : ''}${on ? ' on' : ''}`} data-page={i} aria-current={on ? 'page' : undefined}>
            <img src={urls[i] ?? undefined} alt="" />
            {derived.texts[i] && <div className="small">{noDots(derived.texts[i]!)}</div>}
            <div className="oo-pn">{t('af.page', { n: i + 1 })}</div>
          </div>
        );
      })}
      <div className="faint small">{t('af.previewBy', { engine: derived.converter ?? 'LibreOffice' })}</div>
    </div>
  );
}
