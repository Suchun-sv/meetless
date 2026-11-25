import { describe, expect, it } from 'vitest';
import type { UpdateState } from '@meetless/client/bridge';
import { Sidebar } from '../../src/renderer/shell/Sidebar';
import { UpdateView } from '../../src/renderer/shell/UpdateEntry';
import { render } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, textOf } from './u1';

/** The update entry in the sidebar user row: offer, progress line, failure and the confirm dialog. */

const OFFER: UpdateState = {
  current: '0.1.0',
  available: { version: '0.2.0', notes: ['Sidebar shows the new version', 'Faster sync'] },
  install: 'self',
  releasesUrl: 'https://github.com/Suchun-sv/meetless/releases',
  phase: 'idle',
  percent: null,
  error: null,
};
const noop = () => undefined;
const view = (state: UpdateState | null, confirming = false) => <UpdateView state={state} confirming={confirming} onAsk={noop} onCancel={noop} onInstall={noop} />;

describe.each(LOCALES)('update entry (%s)', (l) => {
  it('a failed check with nothing offered shows the retry line', () => {
    const api = alexApi(l);
    const failed: UpdateState = { ...OFFER, available: null, checkError: 'UPDATE_CHECK' };
    const html = render(api, <UpdateView state={failed} confirming={false} onAsk={noop} onCancel={noop} onInstall={noop} onRetry={noop} />);
    expect(html).toContain('data-testid="update-retry"');
    expect(textOf(html)).toContain(api.t('upd.checkFailed'));
    guards(`update retry ${l}`, html);
    expect(render(api, view({ ...OFFER, available: null }))).not.toContain('update-retry');
  });

  it('offers the new version with an update button', () => {
    const api = alexApi(l);
    const html = render(api, view(OFFER));
    expect(textOf(html)).toContain(api.t('upd.available', { v: '0.2.0' }));
    expect(html).toContain('data-testid="update-install"');
    expect(textOf(html)).toContain(api.t('upd.install'));
    expect(html).not.toContain('data-testid="update-download"');
    guards(`update ${l}`, html);
  });

  it('the confirm dialog lists the release notes, without bullets', () => {
    const api = alexApi(l);
    const html = render(api, view(OFFER, true));
    expect(html).toContain('data-testid="update-confirm"');
    expect(textOf(html)).toContain(api.t('upd.confirmTitle', { v: '0.2.0' }));
    for (const n of OFFER.available!.notes) expect(textOf(html)).toContain(n);
    expect(html).toContain('data-testid="update-confirm-go"');
    expect(html).not.toMatch(/<(ul|li)\b/);
    guards(`update confirm ${l}`, html);
  });

  it('shows a progress line instead of the button while it installs', () => {
    const api = alexApi(l);
    const down = render(api, view({ ...OFFER, phase: 'downloading', percent: 42 }));
    expect(textOf(down)).toContain(api.t('upd.downloading', { n: 42 }));
    expect(down).toContain('data-testid="update-progress"');
    expect(down).not.toContain('data-testid="update-install"');
    expect(textOf(render(api, view({ ...OFFER, phase: 'downloading', percent: null })))).toContain(api.t('upd.downloadingNoPct'));
    expect(textOf(render(api, view({ ...OFFER, phase: 'installing' })))).toContain(api.t('upd.installing'));
    expect(textOf(render(api, view({ ...OFFER, phase: 'restarting' })))).toContain(api.t('upd.restarting'));
    guards(`update progress ${l}`, down);
  });

  it('a failure says why and offers the button again', () => {
    const api = alexApi(l);
    const html = render(api, view({ ...OFFER, phase: 'failed', error: 'UPDATE_CHECKSUM' }));
    expect(textOf(html)).toContain(api.t('upd.failed', { reason: api.t('upd.err.UPDATE_CHECKSUM') }));
    expect(html).toContain('tone-danger');
    expect(html).toContain('data-testid="update-install"');
    const odd = render(api, view({ ...OFFER, phase: 'failed', error: 'SOMETHING_NEW' }));
    expect(textOf(odd)).toContain(api.t('upd.failed', { reason: api.t('upd.err.UPDATE_FAILED') }));
  });

  it('an install type that cannot replace itself links to the releases page', () => {
    const api = alexApi(l);
    const html = render(api, view({ ...OFFER, install: 'manual' }));
    expect(html).toContain('data-testid="update-download"');
    expect(html).toContain('href="https://github.com/Suchun-sv/meetless/releases"');
    expect(html).toContain('target="_blank"');
    expect(textOf(html)).toContain(api.t('upd.download'));
    expect(html).not.toContain('data-testid="update-install"');
    guards(`update manual ${l}`, html);
  });
});

it('nothing to offer, or no updater: nothing is shown', () => {
  const api = alexApi('en');
  expect(render(api, view(null))).toBe('');
  expect(render(api, view({ ...OFFER, available: null }))).toBe('');
});

it('the sidebar user row renders with the update entry and no updater behind it', () => {
  const html = render(alexApi('en'), <Sidebar />);
  expect(html).toContain('data-testid="sign-out"');
  expect(html).not.toContain('data-testid="update"');
});
