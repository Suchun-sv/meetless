import { describe, expect, it } from 'vitest';
import { viewFor } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import { StreamPage } from '../../src/renderer/stream/StreamPage';
import { streamItems, streamSystemRows } from '../../src/renderer/stream/model';
import { fakeApi, render } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { textOf } from '../shell/u1';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const P = 'p1';
const TODAY = '2026-11-24';
const composer = () => null;

/** Alex and Zhou in P1. A work item, then Zhou renames P1 twice, then another work item. Eve is not a member. */
function buildLog(locale: Locale): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
  log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale });
  log.emit('user.registered', 'system', { userId: 'u-eve', displayName: 'Eve', locale });
  log.emit('project.created', 'u-alex', { projectId: P, name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: P, userId: 'u-zhou' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-old', projectId: P, needId: null, src: 'doc', text: 'Old note', date: TODAY });
  log.emit('project.renamed', 'u-zhou', { projectId: P, name: 'Atlas' });
  log.emit('project.renamed', 'u-zhou', { projectId: P, name: 'Atlas export' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-new', projectId: P, needId: null, src: 'doc', text: 'New note', date: TODAY });
  return log;
}

describe('Activity system lines for renames', () => {
  it('streamSystemRows lists each rename newest first', () => {
    const s = buildLog('en').state;
    expect(streamSystemRows(s, P).map((r) => [r.from, r.to, r.by])).toEqual([
      ['Atlas', 'Atlas export', 'u-zhou'],
      ['P1', 'Atlas', 'u-zhou'],
    ]);
  });

  it('streamItems interleaves them with work by date then seq, and only in the unfiltered view', () => {
    const s = buildLog('en').state;
    const order = (f: Parameters<typeof streamItems>[3]) => streamItems(s, 'u-alex', P, f).map((i) => (i.type === 'work' ? i.row.w.id : `sys:${i.rename.to}`));
    expect(order({ kind: 'all', needId: null })).toEqual(['w-new', 'sys:Atlas export', 'sys:Atlas', 'w-old']);
    expect(order({ kind: 'manual', needId: null })).toEqual(['w-new', 'w-old']);
  });

  it.each(LOCALES)('every member sees the rename as a system line in Activity (%s)', (l) => {
    const log = buildLog(l);
    const tr = createTranslator(l);
    for (const live of [clientState(log, 'u-alex'), viewFor(log.state, 'u-alex')]) {
      const html = render(fakeApi({ live, me: 'u-alex', locale: l, today: TODAY, route: { view: 'stream', projectId: P } }), <StreamPage composer={composer} />);
      expect(html.match(/data-testid="stream-sys"/g)).toHaveLength(2);
      const text = textOf(html);
      expect(text).toContain(tr.t('stream.renamed', { who: 'Zhou', from: 'Atlas', to: 'Atlas export' }));
      expect(text).toContain(tr.t('stream.renamed', { who: 'Zhou', from: 'P1', to: 'Atlas' }));
      expect(text.indexOf('New note')).toBeLessThan(text.indexOf(tr.t('stream.renamed', { who: 'Zhou', from: 'Atlas', to: 'Atlas export' })));
      expect(text.indexOf(tr.t('stream.renamed', { who: 'Zhou', from: 'P1', to: 'Atlas' }))).toBeLessThan(text.indexOf('Old note'));
      guards(`stream renamed ${l}`, html);
    }
  });

  it('a project with only a rename shows the line, not the empty text', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: P, name: 'P1' });
    log.emit('project.renamed', 'u-alex', { projectId: P, name: 'P2' });
    const api = fakeApi({ live: log.state, me: 'u-alex', locale: 'en', today: TODAY, route: { view: 'stream', projectId: P } });
    const html = render(api, <StreamPage composer={composer} />);
    expect(html).toContain('data-testid="stream-sys"');
    expect(textOf(html)).not.toContain(api.t('stream.empty'));
  });

  it('a non-member never receives the rename', () => {
    const log = buildLog('en');
    expect(clientState(log, 'u-eve').projects[P]).toBeUndefined();
  });
});
