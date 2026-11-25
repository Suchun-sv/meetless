import type { ReactElement, ReactNode } from 'react';
import type { SubmitResult } from '@meetless/client/bridge';
import { DomainError, type Id, type State } from '@meetless/core';
import type { AppApi } from '../../src/renderer/app/AppContext';
import { fakeApi, fakeBridge, render } from '../support/app';
import type { Log } from '../support/log';

/*
 * The U2 click harness (there is no jsdom here): `Comp()` is called as a plain function from inside
 * a rendered `Probe`, so its hooks run for real; the returned element tree is then searched by test
 * id and its event prop invoked directly. Nested components stay unexpanded.
 */

const TODAY = '2026-11-24';

export type El = ReactElement<Record<string, unknown>>;

export interface Call {
  type: string;
  payload: Record<string, unknown>;
}

/** A bridge whose submit records each command and answers from `results` (then `accepted`). */
export function recorder(results: SubmitResult[] = []): { calls: Call[]; api: (live: State, me: Id) => AppApi } {
  const calls: Call[] = [];
  const bridge = fakeBridge({
    submit: async (cmd) => {
      calls.push({ type: cmd.type, payload: cmd.payload as unknown as Record<string, unknown> });
      return results.shift() ?? { kind: 'accepted', seq: 1 };
    },
  });
  return { calls, api: (live, me) => fakeApi({ live, me, today: TODAY, bridge }) };
}

/** A bridge whose submit records each command and then throws (an IPC or network failure, not a rejection). */
export function thrower(): { calls: Call[]; api: (live: State, me: Id) => AppApi } {
  const calls: Call[] = [];
  const bridge = fakeBridge({
    submit: async (cmd) => {
      calls.push({ type: cmd.type, payload: cmd.payload as unknown as Record<string, unknown> });
      throw new Error('bridge down');
    },
  });
  return { calls, api: (live, me) => fakeApi({ live, me, today: TODAY, bridge }) };
}

/**
 * A core-backed `submit` for `me` over `log`: each command is applied through core (`Log.emit`), so
 * a refusal is core's own (`rejected` with its code and details), never a stub's guess.
 */
export function logSubmit(log: Log, me: Id): { calls: Call[]; submit: AppApi['submit'] } {
  const calls: Call[] = [];
  const submit = (async (type: string, payload: unknown): Promise<SubmitResult> => {
    calls.push({ type, payload: payload as Record<string, unknown> });
    try {
      const e = log.emit(type as never, me, payload as never);
      return { kind: 'accepted', seq: e.seq };
    } catch (err) {
      if (err instanceof DomainError) return { kind: 'rejected', code: err.code, details: err.details };
      throw err;
    }
  }) as AppApi['submit'];
  return { calls, submit };
}

/** What `Comp` returns when rendered inside the provider (hooks work); nested components stay unexpanded. */
export function tree(api: AppApi, Comp: () => ReactNode): unknown {
  let out: ReactNode = null;
  const Probe = () => {
    out = Comp();
    return null;
  };
  render(api, <Probe />);
  return out;
}

/** Every element in `node` whose `data-testid` (or `Btn`'s `testId`) is `testid`. */
export function findAll(node: unknown, testid: string): El[] {
  const found: El[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object' && 'props' in n) {
      const e = n as El;
      if (e.props['data-testid'] === testid || e.props.testId === testid) found.push(e);
      walk(e.props.children);
    }
  };
  walk(node);
  return found;
}

function nth(api: AppApi, Comp: () => ReactNode, testid: string, n = 0): El {
  const el = findAll(tree(api, Comp), testid)[n];
  if (!el) throw new Error(`no ${testid} #${n}`);
  return el;
}

export async function click(api: AppApi, Comp: () => ReactNode, testid: string, n = 0): Promise<void> {
  await (nth(api, Comp, testid, n).props.onClick as () => unknown)();
}

export async function change(api: AppApi, Comp: () => ReactNode, testid: string, value: string): Promise<void> {
  await (nth(api, Comp, testid).props.onChange as (e: { target: { value: string } }) => unknown)({ target: { value } });
}

export async function blur(api: AppApi, Comp: () => ReactNode, testid: string): Promise<void> {
  await (nth(api, Comp, testid).props.onBlur as () => unknown)();
}
