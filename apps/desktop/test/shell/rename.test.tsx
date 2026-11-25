import { describe, expect, it } from 'vitest';
import { createTranslator, type Locale } from '@meetless/i18n';
import { Sidebar } from '../../src/renderer/shell/Sidebar';
import { Topbar } from '../../src/renderer/shell/Topbar';
import { RenameInput } from '../../src/renderer/shell/RenameInput';
import { PROJECT_NAME_MAX, renameCommand } from '../../src/renderer/shell/rename';
import { fakeApi, render } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { findAll, logSubmit, recorder, thrower, tree } from '../collab/harness';
import { alexApi, LOCALES, textOf } from './u1';

const ATLAS = 'sample-atlas';
const P = 'p1';

/** Alex and Mia in P1 ("Atlas export"); Eve is not a member. */
function baseLog(): Log {
  const log = new Log();
  for (const [id, name] of [['u-alex', 'Alex'], ['u-mia', 'Mia'], ['u-eve', 'Eve']] as const) {
    log.emit('user.registered', 'system', { userId: id, displayName: name, locale: 'en' });
  }
  log.emit('project.created', 'u-alex', { projectId: P, name: 'Atlas export' });
  log.emit('project.member_added', 'u-alex', { projectId: P, userId: 'u-mia' });
  return log;
}

/** A keydown event as the input's handler reads it: the key, the input's current text, and no IME composition. */
const key = (k: string, value: string, isComposing = false) => ({ key: k, currentTarget: { value }, nativeEvent: { isComposing }, preventDefault() {} });
const blurOf = (value: string) => ({ currentTarget: { value } });

function input(api: ReturnType<typeof fakeApi>, onDone: () => void, name = 'Atlas export') {
  const el = findAll(tree(api, () => RenameInput({ projectId: P, name, onDone })), 'rename-input')[0];
  if (!el) throw new Error('no rename-input');
  return el.props as {
    defaultValue: string;
    onKeyDown: (e: ReturnType<typeof key>) => Promise<void>;
    onBlur: (e: ReturnType<typeof blurOf>) => Promise<void>;
  };
}

describe('renameCommand', () => {
  it('trims, strips dot symbols and builds project.renamed', () => {
    expect(renameCommand(P, 'Atlas export', '  Atlas · v2  ')).toEqual({ kind: 'cmd', type: 'project.renamed', payload: { projectId: P, name: 'Atlas v2' } });
  });

  it('an unchanged name (after cleaning) sends nothing', () => {
    expect(renameCommand(P, 'Atlas export', 'Atlas export')).toEqual({ kind: 'none' });
    expect(renameCommand(P, 'Atlas export', '  Atlas export ')).toEqual({ kind: 'none' });
  });

  it('empty, whitespace and dots only are pj.nameEmpty; 81 characters is pj.nameTooLong; 80 is fine', () => {
    for (const d of ['', '   ', ' · ']) expect(renameCommand(P, 'A', d)).toEqual({ kind: 'error', key: 'pj.nameEmpty' });
    expect(renameCommand(P, 'A', 'x'.repeat(PROJECT_NAME_MAX + 1))).toEqual({ kind: 'error', key: 'pj.nameTooLong' });
    expect(renameCommand(P, 'A', '项'.repeat(81))).toEqual({ kind: 'error', key: 'pj.nameTooLong' });
    expect(renameCommand(P, 'A', '项'.repeat(80)).kind).toBe('cmd');
  });

  it('agrees with core: what it sends core accepts, what it refuses core refuses', () => {
    expect(PROJECT_NAME_MAX).toBe(80);
    for (const d of ['New name', ` ${'x'.repeat(80)} `, 'a•b', '', '  ', 'x'.repeat(81)]) {
      const log = baseLog();
      const r = renameCommand(P, 'Atlas export', d);
      let accepted = true;
      try {
        log.emit('project.renamed', 'u-mia', { projectId: P, name: d });
      } catch {
        accepted = false;
      }
      expect(r.kind === 'cmd', JSON.stringify(d)).toBe(accepted);
      if (r.kind === 'cmd') expect(log.state.projects[P]!.name).toBe(r.payload.name);
    }
  });
});

describe('RenameInput', () => {
  it('starts with the current name', () => {
    const rec = recorder();
    expect(input(rec.api(baseLog().state, 'u-mia'), () => {}).defaultValue).toBe('Atlas export');
  });

  it('Enter saves: one project.renamed with the cleaned name, then closes', async () => {
    const rec = recorder();
    let done = 0;
    await input(rec.api(baseLog().state, 'u-mia'), () => done++).onKeyDown(key('Enter', ' Atlas · two '));
    expect(rec.calls).toEqual([{ type: 'project.renamed', payload: { projectId: P, name: 'Atlas two' } }]);
    expect(done).toBe(1);
  });

  it('Enter while an IME is composing does nothing', async () => {
    const rec = recorder();
    let done = 0;
    await input(rec.api(baseLog().state, 'u-mia'), () => done++).onKeyDown(key('Enter', '新名字', true));
    expect(rec.calls).toEqual([]);
    expect(done).toBe(0);
  });

  it('Esc cancels: nothing is sent, and the blur that follows sends nothing either', async () => {
    const rec = recorder();
    let done = 0;
    const el = input(rec.api(baseLog().state, 'u-mia'), () => done++);
    await el.onKeyDown(key('Escape', 'Changed'));
    await el.onBlur(blurOf('Changed'));
    expect(rec.calls).toEqual([]);
    expect(done).toBe(1);
  });

  it('blur saves a changed name, like the verdict field; an unchanged one just closes', async () => {
    const rec = recorder();
    let done = 0;
    await input(rec.api(baseLog().state, 'u-mia'), () => done++).onBlur(blurOf('Atlas three'));
    expect(rec.calls).toEqual([{ type: 'project.renamed', payload: { projectId: P, name: 'Atlas three' } }]);
    await input(rec.api(baseLog().state, 'u-mia'), () => done++).onBlur(blurOf('Atlas export'));
    expect(rec.calls).toHaveLength(1);
    expect(done).toBe(2);
  });

  it('Enter then blur sends once', async () => {
    const rec = recorder();
    const el = input(rec.api(baseLog().state, 'u-mia'), () => {});
    await el.onKeyDown(key('Enter', 'Once'));
    await el.onBlur(blurOf('Once'));
    expect(rec.calls).toHaveLength(1);
  });

  it.each(LOCALES)('an empty or too long name shows the error notice and sends nothing; Enter keeps the edit open, blur closes it (%s)', async (l: Locale) => {
    const tr = createTranslator(l);
    const rec = recorder();
    const api = fakeApi({ live: baseLog().state, me: 'u-mia', locale: l, bridge: rec.api(baseLog().state, 'u-mia').bridge });
    let done = 0;
    await input(api, () => done++).onKeyDown(key('Enter', '   '));
    await input(api, () => done++).onKeyDown(key('Enter', 'x'.repeat(81)));
    expect(done).toBe(0);
    await input(api, () => done++).onBlur(blurOf(''));
    expect(done).toBe(1);
    expect(rec.calls).toEqual([]);
    expect(api.notices.map((n) => [n.tone, n.text])).toEqual([
      ['error', tr.t('pj.nameEmpty')],
      ['error', tr.t('pj.nameTooLong')],
      ['error', tr.t('pj.nameEmpty')],
    ]);
  });

  it('a refusal from the service (core: NOT_A_MEMBER) shows through the shared submit notice, and nothing else', async () => {
    const log = baseLog();
    const { calls, submit } = logSubmit(log, 'u-eve');
    const api = fakeApi({ live: log.state, me: 'u-eve' });
    // As AppContext.submit does: a rejected result raises errorText(code).
    api.submit = (async (type, payload) => {
      const r = await submit(type, payload);
      if (r.kind === 'rejected') api.notify('error', api.errorText(r.code));
      return r;
    }) as typeof api.submit;
    let done = 0;
    await input(api, () => done++).onKeyDown(key('Enter', 'Mine now'));
    expect(calls).toHaveLength(1);
    expect(api.notices.map((n) => n.text)).toEqual([api.errorText('NOT_A_MEMBER')]);
    expect(log.state.projects[P]!.name).toBe('Atlas export');
    expect(done).toBe(1);
  });

  it('a submit that throws shows the network notice', async () => {
    const th = thrower();
    const api = th.api(baseLog().state, 'u-mia');
    let done = 0;
    await input(api, () => done++).onKeyDown(key('Enter', 'Offline name'));
    expect(th.calls).toHaveLength(1);
    expect(api.notices.map((n) => n.text)).toEqual([api.errorText('NETWORK')]);
    expect(done).toBe(1);
  });
});

describe.each(LOCALES)('rename actions (%s)', (l) => {
  it('the top-bar project name has a Rename action', () => {
    const api = alexApi(l, { route: { view: 'stream', projectId: ATLAS } });
    const html = render(api, <Topbar />);
    expect(html).toContain('data-testid="top-rename"');
    expect(textOf(html)).toContain(api.t('pj.rename'));
    expect(textOf(html)).toContain(api.live.projects[ATLAS]!.name);
    guards(`topbar rename ${l}`, html);
  });

  it('every sidebar project row has a Rename action', () => {
    const api = alexApi(l, { route: { view: 'board', projectId: ATLAS } });
    const html = render(api, <Sidebar />);
    for (const id of ['sample-paper', 'sample-atlas']) expect(html).toContain(`data-testid="nav-project-rename" data-project="${id}"`);
    guards(`sidebar rename ${l}`, html);
  });

  it('the top bar on Home has no Rename action', () => {
    expect(render(alexApi(l, { route: { view: 'home' } }), <Topbar />)).not.toContain('data-testid="top-rename"');
  });
});
