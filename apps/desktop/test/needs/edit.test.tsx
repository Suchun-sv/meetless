import { describe, expect, it } from 'vitest';
import {
  currentRound,
  EXT_STATUSES,
  HYP_STATUSES,
  needByCode,
  needVersion,
  projectRounds,
  viewFor,
  type Id,
  type Need,
  type State,
} from '@meetless/core';
import { createTranslator, type Locale, type MessageKey } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { BoardPage } from '../../src/renderer/needs/BoardPage';
import { DrawerEdit, ReviseForm } from '../../src/renderer/needs/DrawerEdit';
import {
  newNeedCommand,
  ownerCommand,
  reviseCommand,
  roundCommand,
  statusChanged,
  statusCommand,
  type NewNeedForm,
} from '../../src/renderer/needs/edit';
import { NeedDrawer } from '../../src/renderer/needs/NeedDrawer';
import { NewNeedModal } from '../../src/renderer/needs/NewNeedModal';
import { fakeApi, render, sample } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { blur, change, click, recorder } from '../collab/harness';

const ATLAS = 'sample-atlas';
const PAPER = 'sample-paper';
const TODAY = '2026-11-24';
const SRC = { src: 'chat' as const, date: TODAY, quote: 'q', ref: 'r' };
const LOCALES: Locale[] = ['zh-CN', 'en'];
const count = (html: string, needle: string) => html.split(needle).length - 1;

function form(over: Partial<NewNeedForm> = {}): NewNeedForm {
  return { kind: 'ext', title: 'Faster export', accept: '', expect: '', verify: '', roundId: null, private: false, ...over };
}

/** Alex alone, one project, one round, no needs yet: the fixture the brief's new-need tests build on. */
function baseLog(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-mia', displayName: 'Mia', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: 'p1', userId: 'u-mia' });
  log.emit('round.created', 'u-alex', { roundId: 'r1', projectId: 'p1', title: 'Round 1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
  return log;
}

describe('newNeedCommand', () => {
  it('builds an external need command whose accept falls back to the title', () => {
    const cmd = newNeedCommand(form(), 'p1', 'n1', TODAY, 'Added by hand');
    expect(cmd).toEqual({
      type: 'need.created',
      payload: {
        needId: 'n1',
        projectId: 'p1',
        kind: 'ext',
        title: 'Faster export',
        roundId: null,
        source: { src: 'doc', date: TODAY, quote: 'Faster export', ref: 'Added by hand' },
        private: false,
        accept: 'Faster export',
      },
    });
  });

  it('builds a hypothesis command carrying expect and verify, not accept', () => {
    const cmd = newNeedCommand(form({ kind: 'hyp', expect: 'Conversion rises', verify: 'A/B test' }), 'p1', 'h1', TODAY, 'Added by hand');
    expect(cmd).toEqual({
      type: 'need.created',
      payload: {
        needId: 'h1',
        projectId: 'p1',
        kind: 'hyp',
        title: 'Faster export',
        roundId: null,
        source: { src: 'doc', date: TODAY, quote: 'Faster export', ref: 'Added by hand' },
        private: false,
        expect: 'Conversion rises',
        verify: 'A/B test',
      },
    });
  });

  it('a hypothesis left without expect or verify sends null for them, never an empty string', () => {
    const cmd = newNeedCommand(form({ kind: 'hyp', expect: '  ', verify: '' }), 'p1', 'h1', TODAY, 'Added by hand')!;
    expect(cmd.payload).toMatchObject({ expect: null, verify: null });
    const log = baseLog();
    log.emit(cmd.type, 'u-alex', cmd.payload);
    expect(log.state.needs['h1']).toMatchObject({ expect: null, verify: null });
    // The drawer shows dr.none for them rather than an empty row.
    const html = drawerHtml(log.state, 'u-alex', 'en', 'p1', 'h1');
    const tr = createTranslator('en');
    const meta = html.slice(html.indexOf(`>${tr.t('dr.meta')}<`), html.indexOf(`>${tr.t('dr.work')}<`));
    expect(count(meta, `>${tr.t('dr.none')}<`)).toBe(2);
  });

  it('refuses a blank (or whitespace-only) title', () => {
    expect(newNeedCommand(form({ title: '  ' }), 'p1', 'n1', TODAY, 'Added by hand')).toBeNull();
    expect(newNeedCommand(form({ title: '' }), 'p1', 'n1', TODAY, 'Added by hand')).toBeNull();
  });

  it('applied through core: a shared external need gets N<next>; a private one gets Np1 and only its owner holds it', () => {
    const log = baseLog();
    const extCmd = newNeedCommand(form({ roundId: 'r1' }), 'p1', 'n1', TODAY, 'Added by hand')!;
    log.emit(extCmd.type, 'u-alex', extCmd.payload);
    expect(log.state.needs['n1']!.code).toBe('N1');
    expect(log.state.needs['n1']!.privateTo).toBeNull();

    const privCmd = newNeedCommand(form({ title: 'Only mine', private: true }), 'p1', 'n2', TODAY, 'Added by hand')!;
    log.emit(privCmd.type, 'u-alex', privCmd.payload);
    expect(log.state.needs['n2']!.code).toBe('Np1');
    expect(log.state.needs['n2']!.privateTo).toBe('u-alex');

    expect(clientState(log, 'u-alex').needs['n2']).toBeDefined();
    expect(clientState(log, 'u-mia').needs['n2']).toBeUndefined();
  });
});

describe('reviseCommand', () => {
  it('needs both text and why, and (applied) bumps the need version', () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC });
    const need = log.state.needs['n1']!;
    expect(needVersion(need)).toBe(1);

    expect(reviseCommand(need, '', 'reason', 'rev1', TODAY)).toBeNull();
    expect(reviseCommand(need, 'text', '   ', 'rev1', TODAY)).toBeNull();

    const cmd = reviseCommand(need, 'New wording', 'Client asked', 'rev1', TODAY)!;
    expect(cmd).toEqual({ type: 'need.revised', payload: { needId: 'n1', revisionId: 'rev1', text: 'New wording', why: 'Client asked', date: TODAY } });
    log.emit(cmd.type, 'u-alex', cmd.payload);
    expect(needVersion(log.state.needs['n1']!)).toBe(2);
  });
});

describe('statusCommand', () => {
  it('offers only the kind’s statuses, and sends a verdict only for a hypothesis', () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC });
    log.emit('need.created', 'u-alex', { needId: 'h1', projectId: 'p1', kind: 'hyp', title: 'H', roundId: null, source: SRC });
    const ext = log.state.needs['n1']!;
    const hyp = log.state.needs['h1']!;

    expect(EXT_STATUSES).toContain('doing');
    expect(HYP_STATUSES).toContain('testing');

    expect(statusCommand(ext, 'doing')).toEqual({ type: 'need.status_set', payload: { needId: 'n1', status: 'doing' } });
    // A verdict argument is dropped for an external need: core rejects a verdict on a non-hypothesis.
    expect(statusCommand(ext, 'met', 'ignored')).toEqual({ type: 'need.status_set', payload: { needId: 'n1', status: 'met' } });
    expect(statusCommand(hyp, 'testing', 'Looks promising')).toEqual({
      type: 'need.status_set',
      payload: { needId: 'h1', status: 'testing', verdict: 'Looks promising' },
    });
    expect(statusCommand(hyp, 'testing')).toEqual({ type: 'need.status_set', payload: { needId: 'h1', status: 'testing', verdict: null } });

    log.emit(statusCommand(ext, 'met').type, 'u-alex', statusCommand(ext, 'met').payload);
    expect(log.state.needs['n1']!.status).toBe('met');
    log.emit(statusCommand(hyp, 'held', 'Confirmed by the pilot').type, 'u-alex', statusCommand(hyp, 'held', 'Confirmed by the pilot').payload);
    expect(log.state.needs['h1']!.status).toBe('held');
    expect(log.state.needs['h1']!.verdict).toBe('Confirmed by the pilot');
  });
});

describe('ownerCommand and roundCommand', () => {
  it('build need.updated payloads that core accepts', () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC });
    const need = log.state.needs['n1']!;

    expect(ownerCommand(need, 'u-mia')).toEqual({ type: 'need.updated', payload: { needId: 'n1', ownerId: 'u-mia' } });
    expect(ownerCommand(need, null)).toEqual({ type: 'need.updated', payload: { needId: 'n1', ownerId: null } });
    expect(roundCommand(need, 'r1')).toEqual({ type: 'need.updated', payload: { needId: 'n1', roundId: 'r1' } });

    const ownCmd = ownerCommand(need, 'u-mia');
    log.emit(ownCmd.type, 'u-alex', ownCmd.payload);
    expect(log.state.needs['n1']!.ownerId).toBe('u-mia');

    const roundCmd = roundCommand(log.state.needs['n1']!, 'r1');
    log.emit(roundCmd.type, 'u-alex', roundCmd.payload);
    expect(log.state.needs['n1']!.roundId).toBe('r1');
    expect(log.state.needs['n1']!.autoRound).toBe(false);
  });
});

function modalHtml(live: State, me: Id, locale: Locale, projectId: Id): string {
  return render(fakeApi({ live, me, locale, today: TODAY }), <NewNeedModal projectId={projectId} onClose={() => undefined} />);
}

describe('BoardPage + NewNeedModal', () => {
  it('the board renders board-new', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const html = render(fakeApi({ live, me: 'u-alex', locale: 'en', route: { view: 'board', projectId: ATLAS }, today: TODAY }), (
      <BoardPage composer={() => null} />
    ));
    expect(html).toContain('data-testid="board-new"');
  });

  it('the modal lists the kind switch, the fields for the selected kind, the rounds, and the privacy switch', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const tr = createTranslator('en');
    const html = modalHtml(live, 'u-alex', 'en', ATLAS);

    expect(html).toContain('data-testid="overlay-new-need"');
    expect(html).toContain('data-testid="nn-kind"');
    expect(html).toContain(tr.t('kind.ext'));
    expect(html).toContain(tr.t('kind.hyp'));
    expect(html).toContain('data-testid="nn-title"');
    expect(html).toContain(tr.t('nn.titlePh'));
    // The default kind is 'ext': the acceptance field shows, the hypothesis fields do not.
    expect(html).toContain('data-testid="nn-accept"');
    expect(html).not.toContain('data-testid="nn-expect"');
    expect(html).not.toContain('data-testid="nn-verify"');

    expect(html).toContain('data-testid="nn-round"');
    for (const r of projectRounds(live, ATLAS)) expect(html).toContain(`value="${r.id}"`);
    expect(html).toContain(tr.t('round.none'));
    const cur = currentRound(live, ATLAS);
    expect(cur, 'Atlas has a current round in the sample data').not.toBeNull();
    expect(html).toContain(`<option value="${cur!.id}" selected`);

    expect(html).toContain('data-testid="nn-private"');
    expect(html).toContain(tr.t('pv.project'));
    expect(html).toContain(tr.t('pv.only'));

    // Create is disabled while the title is blank (the modal opens with an empty title).
    expect(html).toMatch(/data-testid="nn-create"[^>]*disabled=""/);
  });

  it.each(LOCALES)('the new-need modal has no dot symbol and no mark before a need code (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    guards(`new-need modal ${locale}`, modalHtml(live, 'u-alex', locale, ATLAS));
  });
});

function drawerHtml(live: State, me: Id, locale: Locale, projectId: Id, needId: Id): string {
  const route: Route = { view: 'board', projectId, needId };
  return render(fakeApi({ live, me, locale, route, today: TODAY }), <NeedDrawer projectId={projectId} needId={needId} />);
}

function editHtml(need: Need, live: State, me: Id, locale: Locale): string {
  return render(fakeApi({ live, me, locale, today: TODAY }), <DrawerEdit need={need} />);
}

describe('DrawerEdit', () => {
  it('a shared external need offers only the external statuses, no verdict field, and the owner/revise controls', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    expect(n2.kind).toBe('ext');
    const html = editHtml(n2, live, 'u-alex', 'en');
    const tr = createTranslator('en');

    expect(html).toContain('data-testid="dr-status"');
    for (const s of EXT_STATUSES) expect(html).toContain(`>${tr.t(`st.${s}` as MessageKey)}<`);
    for (const s of HYP_STATUSES) expect(html).not.toContain(`>${tr.t(`st.${s}` as MessageKey)}<`);
    expect(html).not.toContain('data-testid="dr-verdict"');

    expect(html).toContain('data-testid="dr-owner"');
    expect(html).toContain(tr.t('own.none'));

    // Only the dr-revise button shows; the revise form opens from it.
    expect(html).toContain('data-testid="dr-revise"');
    expect(html).not.toMatch(/data-testid="dr-revise"[^>]*disabled=""/);
    expect(html).not.toContain('data-testid="nn-revise-text"');
    expect(html).not.toContain('data-testid="nn-revise-why"');
    expect(html).not.toContain('data-testid="dr-revise-send"');
  });

  it('the revise form asks for the new wording and the reason, and its submit stays disabled until both are filled', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const tr = createTranslator('en');
    const html = render(fakeApi({ live, me: 'u-alex', today: TODAY }), <ReviseForm need={n2} busy={false} setBusy={() => undefined} onDone={() => undefined} />);
    expect(html).toContain('data-testid="nn-revise-text"');
    expect(html).toContain(tr.t('nn.reviseText'));
    expect(html).toContain('data-testid="nn-revise-why"');
    expect(html).toContain(tr.t('nn.reviseWhy'));
    expect(html).toMatch(/data-testid="dr-revise-send"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="nn-revise-text"[^>]*disabled=""/);

    // Under the drawer's shared lock the whole form is disabled.
    const locked = render(fakeApi({ live, me: 'u-alex', today: TODAY }), <ReviseForm need={n2} busy={true} setBusy={() => undefined} onDone={() => undefined} />);
    for (const id of ['nn-revise-text', 'nn-revise-why', 'dr-revise-send']) expect(locked, id).toMatch(new RegExp(`data-testid="${id}"[^>]*disabled=""`));
  });

  it('dr-revise only opens the form; it never submits anything itself', async () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const rec = recorder();
    await click(rec.api(live, 'u-alex'), () => DrawerEdit({ need: n2 }), 'dr-revise');
    expect(rec.calls).toEqual([]);
  });

  it('a hypothesis offers the hypothesis statuses and a verdict field', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    expect(hp1.kind).toBe('hyp');
    const html = editHtml(hp1, live, 'u-alex', 'en');
    const tr = createTranslator('en');

    for (const s of HYP_STATUSES) expect(html).toContain(`>${tr.t(`st.${s}` as MessageKey)}<`);
    expect(html).toContain('data-testid="dr-verdict"');
    expect(html).toContain(tr.t('nn.verdict'));
  });

  it('the drawer shows the status, revise and owner controls for a shared need and for a private one', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    const shared = drawerHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const priv = drawerHtml(live, 'u-alex', 'en', PAPER, hp1.id);

    for (const html of [shared, priv]) {
      expect(html).toContain('data-testid="dr-status"');
      expect(html).toContain('data-testid="dr-owner"');
      expect(html).toContain('data-testid="dr-revise"');
    }
  });

  it.each(LOCALES)('a representative drawer edit section has no dot symbol and no mark before a need code (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    guards(`drawer N2 ${locale}`, drawerHtml(live, 'u-alex', locale, ATLAS, n2.id));
    guards(`drawer Hp1 ${locale}`, drawerHtml(live, 'u-alex', locale, PAPER, hp1.id));
  });
});

describe('statusChanged', () => {
  it('is false only while both the status and the verdict already match the need', () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'h1', projectId: 'p1', kind: 'hyp', title: 'H', roundId: null, source: SRC, verdict: 'Initial read' });
    const hyp = log.state.needs['h1']!;
    expect(statusChanged(hyp, hyp.status, hyp.verdict ?? '')).toBe(false);
    expect(statusChanged(hyp, hyp.status, '  Initial read  ')).toBe(false); // trimmed before comparing
    expect(statusChanged(hyp, hyp.status, 'Different')).toBe(true);
    expect(statusChanged(hyp, 'held', hyp.verdict ?? '')).toBe(true);
  });
});

// --- Task 11 fix round 1: the rejected path, the shared busy lock, and the verdict-blur skip,
// through the shared click harness (test/collab/harness.tsx).

describe('DrawerEdit — the rejected path and the shared busy lock', () => {
  it('a rejected status change submits exactly once and always releases busy, never leaving it stuck', async () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC });
    const need = log.state.needs['n1']!;
    const busyCalls: boolean[] = [];
    const rec = recorder([{ kind: 'rejected', code: 'NOT_AUTHORISED' }]);
    const api = rec.api(log.state, 'u-alex');
    await change(api, () => DrawerEdit({ need, busy: false, setBusy: (b) => busyCalls.push(b) }), 'dr-status', 'doing');
    expect(rec.calls).toEqual([{ type: 'need.status_set', payload: { needId: 'n1', status: 'doing' } }]);
    expect(busyCalls).toEqual([true, false]);
  });

  it('a rejected owner change submits exactly once and always releases busy', async () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC });
    const need = log.state.needs['n1']!;
    const busyCalls: boolean[] = [];
    const rec = recorder([{ kind: 'rejected', code: 'NOT_AUTHORISED' }]);
    const api = rec.api(log.state, 'u-alex');
    await change(api, () => DrawerEdit({ need, busy: false, setBusy: (b) => busyCalls.push(b) }), 'dr-owner', 'u-mia');
    expect(rec.calls).toEqual([{ type: 'need.updated', payload: { needId: 'n1', ownerId: 'u-mia' } }]);
    expect(busyCalls).toEqual([true, false]);
  });

  it('an accepted status change carries the need’s current verdict for a hypothesis', async () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'h1', projectId: 'p1', kind: 'hyp', title: 'H', roundId: null, source: SRC, verdict: 'Early signal' });
    const need = log.state.needs['h1']!;
    const rec = recorder();
    await change(rec.api(log.state, 'u-alex'), () => DrawerEdit({ need }), 'dr-status', 'held');
    expect(rec.calls).toEqual([{ type: 'need.status_set', payload: { needId: 'h1', status: 'held', verdict: 'Early signal' } }]);
  });

  it('an accepted owner change to no owner submits ownerId: null exactly once', async () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: 'p1', kind: 'ext', title: 'T', roundId: null, source: SRC, ownerId: 'u-mia' });
    const need = log.state.needs['n1']!;
    const rec = recorder();
    await change(rec.api(log.state, 'u-alex'), () => DrawerEdit({ need }), 'dr-owner', '');
    expect(rec.calls).toEqual([{ type: 'need.updated', payload: { needId: 'n1', ownerId: null } }]);
  });

  it('blurring the verdict field with nothing changed (the common case, on a fresh mount) never submits', async () => {
    const log = baseLog();
    log.emit('need.created', 'u-alex', { needId: 'h1', projectId: 'p1', kind: 'hyp', title: 'H', roundId: null, source: SRC });
    const need = log.state.needs['h1']!;
    const rec = recorder();
    await blur(rec.api(log.state, 'u-alex'), () => DrawerEdit({ need }), 'dr-verdict');
    expect(rec.calls).toEqual([]);
  });

  it('an externally-supplied busy=true (the drawer’s shared lock) disables every control, so a sibling action blocks these too', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    const html = render(fakeApi({ live, me: 'u-alex', today: TODAY }), <DrawerEdit need={hp1} busy={true} setBusy={() => undefined} />);
    for (const id of ['dr-status', 'dr-verdict', 'dr-owner', 'dr-revise']) {
      expect(html, id).toMatch(new RegExp(`data-testid="${id}"[^>]*disabled=""`));
    }
  });

  it('with no busy prop at all, DrawerEdit falls back to its own local flag and starts enabled', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = render(fakeApi({ live, me: 'u-alex', today: TODAY }), <DrawerEdit need={n2} />);
    expect(html).not.toMatch(/data-testid="dr-status"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="dr-owner"[^>]*disabled=""/);
  });
});
