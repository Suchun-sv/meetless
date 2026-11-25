import { useState } from 'react';
import type { Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import type { PageProps } from '../app/pages';
import { useApp } from '../app/AppContext';
import { CaptureButton } from '../artifacts/capture-ui';
import { streamItems, streamNeedOptions, type StreamFilter, type StreamKind } from './model';
import { StreamRow, StreamSysRow } from './StreamRow';
import './stream.css';

const KINDS: readonly (StreamKind | 'all')[] = ['all', 'agent', 'manual', 'capture'];

/**
 * Activity stream: agent reports, work logged by people, and captures, filtered by kind and by
 * need (task 9 brief; contract §8, design §6 动态). Rows come from `streamRows`; the need filter's
 * options come from `streamNeedOptions`, so it only ever lists needs visible in this view. Project
 * renames show as system lines among the rows (`streamItems`, contract 12.23).
 */
export function StreamPage({ composer }: PageProps) {
  const { live, me, route, t } = useApp();
  const [kind, setKind] = useState<StreamKind | 'all'>('all');
  const [needId, setNeedId] = useState<Id | null>(null);
  if (route.view !== 'stream') return null;
  const { projectId } = route;

  const filter: StreamFilter = { kind, needId };
  const rows = streamItems(live, me, projectId, filter);
  const allRows = streamItems(live, me, projectId, { kind: 'all', needId: null });
  const needOptions = streamNeedOptions(live, projectId);

  return (
    <div className="page" data-testid="page-stream">
      <h1>{t('stream.title')}</h1>
      <p className="muted">{t('stream.sub')}</p>
      <div className="row gap6 wrap">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip${kind === k ? ' on' : ''}`}
            data-testid="stream-k"
            data-k={k}
            onClick={() => setKind(k)}
          >
            {t(`stream.k.${k}` as MessageKey)}
          </button>
        ))}
        <select className="inp stream-need" data-testid="stream-need" value={needId ?? ''} onChange={(e) => setNeedId(e.target.value || null)}>
          <option value="">{t('stream.allNeeds')}</option>
          {needOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.code}
            </option>
          ))}
        </select>
        <CaptureButton projectId={projectId} testId="stream-capture" />
      </div>
      <div className="stream-h">
        <span>{t('stream.signal')}</span>
        <span>{t('stream.reading')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="faint pad">{t(allRows.length === 0 ? 'stream.empty' : 'stream.noMatch')}</div>
      ) : (
        rows.map((item) =>
          item.type === 'work' ? <StreamRow key={item.row.w.id} projectId={projectId} row={item.row} /> : <StreamSysRow key={`sys-${item.rename.seq}`} rename={item.rename} />,
        )
      )}
      {composer()}
    </div>
  );
}
