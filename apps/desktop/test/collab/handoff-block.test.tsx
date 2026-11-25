import { describe, expect, it } from 'vitest';
import { handoffForNeed, needByCode, userName, type Handoff, type Need, type State } from '@meetless/core';
import { createTranslator, formatDateTime, formatDay, type Locale } from '@meetless/i18n';
import { NeedDrawer } from '../../src/renderer/needs/NeedDrawer';
import { HandoffBlock } from '../../src/renderer/collab/HandoffBlock';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];

function blockHtml(live: State, me: string, locale: Locale, need: Need, h: Handoff): string {
  return render(fakeApi({ live, me, locale, today: TODAY }), <HandoffBlock need={need} h={h} />);
}

function drawerHtml(live: State, me: string, locale: Locale, projectId: string, needId: string): string {
  return render(fakeApi({ live, me, locale, route: { view: 'board', projectId, needId }, today: TODAY }), <NeedDrawer projectId={projectId} needId={needId} />);
}

/**
 * A fresh three-member handoff fixture: `u-send` created `n1` and handed it to `u-recv`,
 * with `u-third` also a project member (and never a party to the handoff). Each scenario
 * below advances the handoff's state from this common starting point.
 */
function freshHandoff(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-send', displayName: 'Sender', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-recv', displayName: 'Recipient', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-third', displayName: 'Third', locale: 'en' });
  log.emit('project.created', 'u-send', { projectId: 'p', name: 'P' });
  log.emit('project.member_added', 'u-send', { projectId: 'p', userId: 'u-recv' });
  log.emit('project.member_added', 'u-send', { projectId: 'p', userId: 'u-third' });
  log.emit('need.created', 'u-send', {
    needId: 'n1',
    projectId: 'p',
    kind: 'ext',
    title: 'Build it',
    roundId: null,
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  log.emit('handoff.created', 'u-send', { handoffId: 'h1', projectId: 'p', needId: 'n1', toId: 'u-recv', ask: 'Finish the export', due: '2026-11-28' });
  return log;
}

describe('HandoffBlock', () => {
  it('Alex on Atlas N3 (sent to him) gets Accept, Ask and Decline', () => {
    const live = sample('en').state;
    const n3 = needByCode(live, ATLAS, 'N3')!;
    const h = handoffForNeed(live, n3.id)!;
    expect(h.state).toBe('sent');
    const html = blockHtml(live, 'u-alex', 'en', n3, h);

    expect(html).toMatch(/data-testid="hob"[^>]*data-state="sent"/);
    for (const id of ['ho-accept', 'ho-ask', 'ho-decline']) expect(html).toContain(`data-testid="${id}"`);

    const tr = createTranslator('en');
    expect(html).toContain(tr.t('ho.accept'));
    expect(html).toContain(tr.t('ho.question'));
    expect(html).toContain(tr.t('ho.decline'));
    expect(html).toContain(h.ask);
    expect(html).toContain(tr.t('ho.dueOn', { d: formatDay(h.due!, 'en') }));
    // Sent to Alex: the block is "hot" (strong, info tone -- never violet).
    expect(html).toMatch(/class="hob hot"/);
  });

  it('Alex on Atlas N2 sees the fetched version, the stale warning and Ask to refresh; Zhou sees neither button', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const h = handoffForNeed(live, n2.id)!;
    expect(h.fromId).toBe('u-alex');
    expect(h.toId).toBe('u-zhou');
    const fetchedAt = h.fetches[h.fetches.length - 1]!.at;

    const tr = createTranslator('en');
    const alex = blockHtml(live, 'u-alex', 'en', n2, h);
    expect(alex).toContain(tr.t('ho.stale', { v: 2 }));
    expect(alex).toContain('data-testid="ho-remind"');
    expect(alex).toContain(tr.t('ho.remind'));
    expect(alex).toContain(tr.t('ho.fetched', { v: 1, at: formatDateTime(fetchedAt, 'en', 'UTC') }));

    const zhou = blockHtml(live, 'u-zhou', 'en', n2, h);
    expect(zhou).not.toContain('data-testid="ho-remind"');
    expect(zhou).not.toContain(tr.t('ho.stale', { v: 2 }));
    // Zhou, the recipient on `doing`, still gets Copy for agent and Return.
    expect(zhou).toContain('data-testid="ho-copy"');
    expect(zhou).toContain('data-testid="ho-return"');
    expect(zhou).toContain(tr.t('ho.myFetched', { v: 1, at: formatDateTime(fetchedAt, 'en', 'UTC') }));
  });

  it('after a refresh request Zhou sees ho.refreshAsked with the version and Copy for agent', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const hId = handoffForNeed(live, n2.id)!.id;
    const log = new Log({ initial: live });
    log.emit('handoff.refresh_requested', 'u-alex', { handoffId: hId });
    const h = log.state.handoffs[hId]!;
    expect(h.state).toBe('doing');

    const tr = createTranslator('en');
    const zhou = blockHtml(log.state, 'u-zhou', 'en', n2, h);
    expect(zhou).toContain(tr.t('ho.refreshAsked', { who: userName(log.state, 'u-alex'), v: 2 }));
    expect(zhou).toContain('data-testid="ho-copy"');
    expect(zhou).toContain(tr.t('lk.btn'));

    // The sender, meanwhile, is now "reminded": the warning gives way to the success tick.
    const alex = blockHtml(log.state, 'u-alex', 'en', n2, h);
    expect(alex).toContain('✓ ' + tr.t('ho.reminded'));
    expect(alex).not.toContain('data-testid="ho-remind"');
  });

  it('a returned handoff: the sender sees Confirm done and Not done yet; the recipient sees ho.onlySender', () => {
    const log = freshHandoff();
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    log.emit('handoff.started', 'u-recv', { handoffId: 'h1' });
    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1', note: 'done, please check' });
    const h = log.state.handoffs.h1!;
    const need = log.state.needs.n1!;
    expect(h.state).toBe('returned');

    const tr = createTranslator('en');
    const sender = blockHtml(log.state, 'u-send', 'en', need, h);
    expect(sender).toContain('data-testid="ho-confirm"');
    expect(sender).toContain(tr.t('ho.confirm'));
    expect(sender).toContain('data-testid="ho-reopen"');
    expect(sender).toContain(tr.t('ho.reopen'));

    const recipient = blockHtml(log.state, 'u-recv', 'en', need, h);
    expect(recipient).toContain(tr.t('ho.onlySender'));
    expect(recipient).not.toContain('data-testid="ho-confirm"');
    expect(recipient).not.toContain('data-testid="ho-reopen"');
  });

  it('a returned handoff whose context went stale still warns, but offers no remind (the view has no remind action)', () => {
    const log = freshHandoff();
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    log.emit('handoff.context_fetched', 'u-recv', { handoffId: 'h1', version: 1, client: null });
    log.emit('need.revised', 'u-send', { needId: 'n1', revisionId: 'r1', text: 'Build it, faster', why: 'client call', date: '2026-11-20' });
    const tr = createTranslator('en');
    const need = log.state.needs.n1!;

    // Accepted and stale: the sender may remind.
    const accepted = blockHtml(log.state, 'u-send', 'en', need, log.state.handoffs.h1!);
    expect(accepted).toContain(tr.t('ho.stale', { v: 2 }));
    expect(accepted).toContain('data-testid="ho-remind"');

    // Returned and still stale: confirm or reopen only.
    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1' });
    const returned = blockHtml(log.state, 'u-send', 'en', need, log.state.handoffs.h1!);
    expect(returned).toContain(tr.t('ho.stale', { v: 2 }));
    expect(returned).not.toContain('data-testid="ho-remind"');
    expect(returned).toContain('data-testid="ho-confirm"');
    expect(returned).toContain('data-testid="ho-reopen"');
  });

  it('the latest note (a question or a reopen reason) is shown', () => {
    const log = freshHandoff();
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'asked', note: 'Which fields exactly?' });
    const h = log.state.handoffs.h1!;
    const need = log.state.needs.n1!;
    const tr = createTranslator('en');
    const note = tr.t('ho.note', { note: 'Which fields exactly?' });

    const sender = blockHtml(log.state, 'u-send', 'en', need, h);
    expect(sender).toContain(note);
    const recipient = blockHtml(log.state, 'u-recv', 'en', need, h);
    expect(recipient).toContain(note);
  });

  it('a third member sees the line and the state, and no buttons', () => {
    const log = freshHandoff();
    const h = log.state.handoffs.h1!;
    const need = log.state.needs.n1!;
    const tr = createTranslator('en');
    const html = blockHtml(log.state, 'u-third', 'en', need, h);

    expect(html).toContain(tr.t('ho.fromTo', { from: userName(log.state, 'u-send'), to: userName(log.state, 'u-recv') }));
    expect(html).toContain(tr.t('ho.st.sent'));
    for (const id of ['ho-accept', 'ho-ask', 'ho-decline', 'ho-start', 'ho-copy', 'ho-return', 'ho-confirm', 'ho-reopen', 'ho-remind', 'ho-decide']) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
  });

  it('the drawer renders the block for the shown handoff only', () => {
    const live = sample('en').state;
    const n3 = needByCode(live, ATLAS, 'N3')!;
    const n1 = needByCode(live, ATLAS, 'N1')!;
    expect(handoffForNeed(live, n1.id)).toBeNull();

    const withHandoff = drawerHtml(live, 'u-alex', 'en', ATLAS, n3.id);
    expect(withHandoff).toContain('data-testid="hob"');

    const withoutHandoff = drawerHtml(live, 'u-alex', 'en', ATLAS, n1.id);
    expect(withoutHandoff).not.toContain('data-testid="hob"');
  });

  it('a re-handed need keeps every live handoff actionable: the drawer renders one block each, newest first', () => {
    const log = freshHandoff();
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    log.emit('handoff.started', 'u-recv', { handoffId: 'h1' });
    // The sender hands the same need to a third member while the first one is still doing it.
    log.emit('handoff.created', 'u-send', { handoffId: 'h2', projectId: 'p', needId: 'n1', toId: 'u-third', ask: 'Second pair of hands', due: null });

    const sender = drawerHtml(log.state, 'u-send', 'en', 'p', 'n1');
    const blocks = [...sender.matchAll(/data-testid="hob" data-handoff="([^"]+)"/g)].map((m) => m[1]);
    expect(blocks).toEqual(['h2', 'h1']);

    // The first recipient can still return their part.
    const recv = drawerHtml(log.state, 'u-recv', 'en', 'p', 'n1');
    expect(recv).toContain('data-handoff="h1"');
    expect(recv).toContain('data-testid="ho-return"');

    // Once both are closed, the drawer falls back to the latest terminal one.
    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1' });
    log.emit('handoff.confirmed', 'u-send', { handoffId: 'h1' });
    log.emit('handoff.responded', 'u-third', { handoffId: 'h2', response: 'declined' });
    const after = drawerHtml(log.state, 'u-send', 'en', 'p', 'n1');
    expect([...after.matchAll(/data-testid="hob" data-handoff="([^"]+)"/g)].map((m) => m[1])).toEqual(['h1']);
  });

  it.each(LOCALES)('no handoff block contains a dot symbol (%s)', (locale) => {
    const live = sample(locale).state;
    const n3 = needByCode(live, ATLAS, 'N3')!;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const h3 = handoffForNeed(live, n3.id)!;
    const h2 = handoffForNeed(live, n2.id)!;

    const htmls = [
      blockHtml(live, 'u-alex', locale, n3, h3),
      blockHtml(live, 'u-zhou', locale, n3, h3),
      blockHtml(live, 'u-alex', locale, n2, h2),
      blockHtml(live, 'u-zhou', locale, n2, h2),
    ];

    const log = freshHandoff();
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    log.emit('handoff.started', 'u-recv', { handoffId: 'h1' });
    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1', note: 'done, please check' });
    const returned = log.state.handoffs.h1!;
    const need = log.state.needs.n1!;
    htmls.push(blockHtml(log.state, 'u-send', locale, need, returned));
    htmls.push(blockHtml(log.state, 'u-recv', locale, need, returned));
    htmls.push(blockHtml(log.state, 'u-third', locale, need, returned));

    for (const html of htmls) guards(`hob ${locale}`, html);
  });
});
