import { describe, expect, it } from 'vitest';
import { handoffForNeed, needByCode } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import { ConflictItem } from '../../src/renderer/collab/ConfirmItems';
import { confirmItems } from '../../src/renderer/collab/confirm';
import { HandoffBlock } from '../../src/renderer/collab/HandoffBlock';
import { HandoffModal } from '../../src/renderer/collab/HandoffModal';
import { withBusy } from '../../src/renderer/needs/busy';
import { sample } from '../support/app';
import { click, findAll, thrower, tree } from './harness';

/*
 * I2: a `submit` that throws (bridge.submit rejects: an IPC or network failure, not a refusal)
 * must release the lock it took and raise a notice, never leave buttons disabled with no message.
 */

const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const tr = createTranslator('en');
const thrown = tr.t('error.NETWORK');

describe('a submit that throws', () => {
  it('withBusy releases the lock, raises onThrow and resolves undefined', async () => {
    const busy: boolean[] = [];
    let raised = 0;
    const r = await withBusy(
      (b) => busy.push(b),
      () => Promise.reject(new Error('bridge down')),
      () => void raised++,
    );
    expect(r).toBeUndefined();
    expect(busy).toEqual([true, false]);
    expect(raised).toBe(1);
  });

  it('a To confirm item raises the notice and is released: the same button submits again', async () => {
    const { state } = sample('en');
    const item = confirmItems(state, 'u-alex', ATLAS, TODAY).find((i) => i.kind === 'conflict')!;
    if (item.kind !== 'conflict') throw new Error('no conflict');
    const t = thrower();
    const api = t.api(state, 'u-alex');
    const done: string[] = [];
    const btn = findAll(
      tree(api, () => ConflictItem({ item, projectId: ATLAS, onDone: (l) => void done.push(l) })),
      'cf-revise',
    )[0]!;
    const onClick = btn.props.onClick as () => Promise<void>;

    // While one answer is in flight the item is locked (the guard is a ref, not render-time state).
    await Promise.all([onClick(), onClick()]);
    expect(t.calls).toHaveLength(1);
    expect(api.notices).toEqual([expect.objectContaining({ tone: 'error', text: thrown })]);
    expect(done).toEqual([]);

    // Released after the throw: a retry submits again.
    await onClick();
    expect(t.calls).toHaveLength(2);
  });

  it('the drawer handoff block raises the notice instead of an unhandled rejection', async () => {
    const { state } = sample('en');
    const n3 = needByCode(state, ATLAS, 'N3')!;
    const h = handoffForNeed(state, n3.id)!;
    const t = thrower();
    const api = t.api(state, 'u-alex');
    await click(api, () => HandoffBlock({ need: n3, h }), 'ho-accept');
    expect(t.calls.map((c) => c.type)).toEqual(['handoff.responded']);
    expect(api.notices).toEqual([expect.objectContaining({ tone: 'error', text: thrown })]);
  });

  it('the handoff modal raises the notice and stays open', async () => {
    const { state } = sample('en');
    const n2 = needByCode(state, ATLAS, 'N2')!;
    const overlay = { kind: 'handoff' as const, projectId: ATLAS, needId: n2.id };
    const t = thrower();
    const api = t.api(state, 'u-alex');
    api.overlay = overlay;
    await click(api, () => HandoffModal({ overlay }), 'ho-send');
    expect(t.calls.map((c) => c.type)).toEqual(['handoff.created']);
    expect(api.notices).toEqual([expect.objectContaining({ tone: 'error', text: thrown })]);
    expect(api.overlay).toEqual(overlay);
  });
});
