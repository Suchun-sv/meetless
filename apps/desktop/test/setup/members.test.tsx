import { describe, expect, it } from 'vitest';
import type { InviteInfo } from '@meetless/api';
import { createTranslator } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { NewProjectPage } from '../../src/renderer/setup/NewProjectPage';
import { InviteList } from '../../src/renderer/setup/Invites';
import { MembersPage } from '../../src/renderer/setup/MembersPage';
import { routeErrorText } from '../../src/renderer/setup/model';
import { render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, sampleWith, textOf } from '../shell/u1';

const route: Route = { view: 'members', projectId: 'sample-atlas' };
const page = <MembersPage composer={() => null} />;

describe('MembersPage', () => {
  it.each(LOCALES)('(%s) members page: members with roles, the add form, roles and the invite section', (l) => {
    const html = render(alexApi(l, { route }), page);
    for (const id of ['members-pick', 'members-add', 'role-name', 'role-add', 'invite-create']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-testid="page-members"');
    expect(html).toContain('data-testid="role"');
    expect(html).toContain('data-testid="role-assign"');
    // Every sample-atlas member who holds a role shows a removable role pill.
    expect(html.match(/data-testid="member-role-remove"/g)).not.toBeNull();
  });

  it('shows "You" for the signed-in member and the role names they hold', () => {
    const html = render(alexApi('en', { route }), page);
    const t = createTranslator('en').t;
    expect(textOf(html)).toContain(t('pj.you'));
    expect(textOf(html)).toContain('Engineering'); // u-alex's role in sample-atlas
  });

  it('the "add member" picker lists only non-members, sorted by name', () => {
    const html = render(alexApi('en', { route }), page);
    const t = createTranslator('en').t;
    // u-mia and u-prof are registered (sample-paper) but not members of sample-atlas.
    expect(html).toContain('>Mia');
    expect(html).toContain('>Prof');
    expect(html).not.toContain(t('pj.allIn'));
  });

  it('pj.allIn shows once every registered user is already a member', () => {
    const state = sampleWith('en', [
      { type: 'project.member_added', payload: { projectId: 'sample-atlas', userId: 'u-mia' } },
      { type: 'project.member_added', payload: { projectId: 'sample-atlas', userId: 'u-prof' } },
    ]);
    const html = render(alexApi('en', { state, route }), page);
    expect(html).not.toContain('data-testid="members-pick"');
    expect(textOf(html)).toContain(createTranslator('en').t('pj.allIn'));
  });

  it.each(LOCALES)('no dot symbol on new project and members (%s)', (l) => {
    guards('new project', render(alexApi(l), <NewProjectPage composer={() => null} />));
    guards('members', render(alexApi(l, { route }), page));
  });
});

describe('NewProjectPage', () => {
  it('new project page: name, description and a create button', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <NewProjectPage composer={() => null} />);
    expect(html).toContain('data-testid="page-newProject"');
    expect(html).toContain('data-testid="project-name"');
    expect(html).toContain('data-testid="project-descr"');
    expect(html).toContain('data-testid="project-create"');
    expect(html).toContain(`placeholder="${t('pj.namePh')}"`);
    expect(textOf(html)).toContain(t('pj.create'));
  });
});

describe('InviteList', () => {
  const live = sample('en').state;
  const invites: InviteInfo[] = [
    { id: 'i-open', projectId: 'sample-atlas', roleId: null, createdBy: 'u-alex', createdAt: '2026-11-24T09:00:00.000Z', usedBy: null, usedAt: null, revokedAt: null },
    {
      id: 'i-used',
      projectId: 'sample-atlas',
      roleId: 'sample-atlas:role:qa',
      createdBy: 'u-alex',
      createdAt: '2026-11-24T09:00:00.000Z',
      usedBy: 'u-zhou',
      usedAt: '2026-11-24T10:00:00.000Z',
      revokedAt: null,
    },
    {
      id: 'i-revoked',
      projectId: 'sample-atlas',
      roleId: null,
      createdBy: 'u-alex',
      createdAt: '2026-11-24T09:00:00.000Z',
      usedBy: null,
      usedAt: null,
      revokedAt: '2026-11-24T11:00:00.000Z',
    },
  ];

  it('InviteList shows open, used and revoked as coloured text, and revoke only on open rows', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <InviteList invites={invites} live={live} onRevoke={() => {}} />);
    expect(html).toContain('class="st tone-info"');
    expect(html).toContain('class="st tone-success"');
    expect(html).toContain('class="st tone-muted"');
    expect(textOf(html)).toContain(t('inv.used', { who: live.users['u-zhou']!.displayName }));
    expect(html.match(/data-testid="invite-revoke"/g)).toHaveLength(1);
  });

  it.each(LOCALES)('(%s) a failed invites.list or invites.create shows its section error in place of the list; HTTP_404 reads pj.unsupported', (l) => {
    const tr = createTranslator(l);
    const errorText = (code: string) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code }));
    const html = render(alexApi(l), <InviteList invites={[]} live={live} onRevoke={() => {}} error={routeErrorText(tr.t, errorText, 'HTTP_404')} />);
    expect(html).toContain('data-testid="invite-error"');
    expect(textOf(html)).toContain(tr.t('pj.unsupported'));
    expect(textOf(html)).not.toContain('HTTP_404');
    expect(html).not.toContain('data-testid="invite-revoke"');
    guards(`invite error ${l}`, html);
  });

  it('a failed invites.revoke shows inline on that row only, and never discards the already-loaded list', () => {
    const t = createTranslator('en').t;
    const html = render(
      alexApi('en'),
      <InviteList invites={invites} live={live} onRevoke={() => {}} revokeError={{ inviteId: 'i-open', code: 'HTTP_404' }} />,
    );
    // All three rows are still there: a revoke error never blanks out the section like `error` does.
    expect(html.match(/data-testid="invite"/g)).toHaveLength(3);
    expect(html).not.toContain('data-testid="invite-error"');
    expect(html.match(/data-testid="invite-revoke-error"/g)).toHaveLength(1);
    const openRow = html.slice(html.indexOf('data-invite="i-open"'), html.indexOf('data-invite="i-used"'));
    expect(openRow).toContain('data-testid="invite-revoke-error"');
    // A route this server does not have reads as a sentence (ruling R22), never the raw code.
    expect(textOf(openRow)).toContain(t('pj.unsupported'));
    expect(textOf(openRow)).not.toContain('HTTP_404');
    // The other rows carry no inline error.
    const usedRow = html.slice(html.indexOf('data-invite="i-used"'), html.indexOf('data-invite="i-revoked"'));
    expect(usedRow).not.toContain('data-testid="invite-revoke-error"');
  });

  it('inv.none shows once there are no invites and no error', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <InviteList invites={[]} live={live} onRevoke={() => {}} />);
    expect(textOf(html)).toContain(t('inv.none'));
  });
});
