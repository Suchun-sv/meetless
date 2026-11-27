import { useState } from 'react';
import type { Id } from '@meetless/core';
import { SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { SIDEBAR_SECTIONS, VIEW_TITLE_KEY } from '../app/routes';
import { focusComposer } from '../chat/focus';
import { displayName } from '../model/state';
import { Avatar } from '../ui/primitives';
import { newInputTarget, sidebarModel } from './model';
import { RenameInput } from './RenameInput';
import { UpdateCallout, UpdateEntry } from './UpdateEntry';
import { isWeb } from '../ui/DesktopOnly';

/** Language names are shown in their own language, not translated. */
export const LANG_LABEL: Record<Locale, string> = { 'zh-CN': '中', en: 'EN' };

/**
 * The grey sidebar: brand, new input, Home, the project tree (the current project expanded to its
 * six sections, members and rounds), Agents, and the user row with the sample label, language and
 * sign out. Each project row has a 「重命名」 action (`nav-project-rename`) that swaps the row for
 * the inline `RenameInput` (contract 12.23). `lastProjectId` (held by `Shell`, which outlives any one route) is where "+ New" falls
 * back to from a global view; this component has no memory of its own across renders, which the
 * component tests rely on.
 */
export function Sidebar({ lastProjectId = null }: { lastProjectId?: Id | null } = {}) {
  const app = useApp();
  const { live, me, today, route, go, t, locale, setLocale, bridge, submit } = app;
  const model = sidebarModel(live, me, route, today);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const onNew = () => {
    go(newInputTarget(route, lastProjectId, model.projects.map((p) => p.id)));
    focusComposer();
  };
  return (
    <aside className="side">
      <div className="side-top">
        <div className="brand">
          <span className="brand-mark" />
          {t('app.name')}
        </div>
      </div>
      <button type="button" className="side-new" data-testid="side-new" onClick={onNew}>
        <span className="plus">+</span>
        {t('cm.new')}
      </button>
      <button type="button" className={`nav${route.view === 'home' ? ' on' : ''}`} data-testid="nav-home" onClick={() => go({ view: 'home' })}>
        <span>{t('nav.home')}</span>
        {model.homeCount > 0 && <span className="nav-n">{model.homeCount}</span>}
      </button>
      <div className="side-label">{t('nav.projects')}</div>
      <button type="button" className={`nav side-add${route.view === 'newProject' ? ' on' : ''}`} data-testid="nav-new-project" onClick={() => go({ view: 'newProject' })}>
        <span className="muted">{t('nav.newProject')}</span>
      </button>
      {model.projects.length === 0 && <div className="side-empty muted small">{t('nav.noProjects')}</div>}
      {model.projects.map((p) => (
        <div key={p.id} className={`ptree${p.open ? ' open' : ''}`}>
          <div className="prow-wrap">
            {renaming === p.id ? (
              <RenameInput projectId={p.id} name={p.name} className="prow-inp" onDone={() => setRenaming(null)} />
            ) : (
              <>
                <button type="button" className={`nav prow${p.open ? ' cur' : ''}`} data-testid="nav-project" data-project={p.id} onClick={() => go({ view: 'dash', projectId: p.id })}>
                  <span className="caret">{p.open ? '▾' : '▸'}</span>
                  <span className="proj-n grow">{p.name}</span>
                  {!p.open && p.total > 0 && <span className="nav-n soft">{p.total}</span>}
                </button>
                <button type="button" className="link prow-act" data-testid="nav-project-rename" data-project={p.id} onClick={() => setRenaming(p.id)}>
                  {t('pj.rename')}
                </button>
              </>
            )}
          </div>
          {p.open && (
            <div className="psub">
              <div className="pmembers">
                {p.memberIds.map((m) => (
                  <Avatar key={m} userId={m} size="sm" />
                ))}
              </div>
              {SIDEBAR_SECTIONS.map((s) => {
                const n = p.badges[s] ?? 0;
                return (
                  <button type="button" key={s} className={`nav sub${route.view === s ? ' on' : ''}`} data-testid={`nav-${s}`} onClick={() => go({ view: s, projectId: p.id })}>
                    <span>{t(VIEW_TITLE_KEY[s])}</span>
                    {n > 0 && <span className="nav-n soft">{n}</span>}
                  </button>
                );
              })}
              <div className="psub-links">
                <button type="button" className="link" data-testid="nav-members" onClick={() => go({ view: 'members', projectId: p.id })}>
                  {t('nav.members')}
                </button>
                <button type="button" className="link" data-testid="nav-rounds" onClick={() => go({ view: 'rounds', projectId: p.id })}>
                  {t('nav.rounds')}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      {model.archived.length > 0 && (
        <details className="side-arch" data-testid="side-archived">
          <summary className="side-label">{t('pj.archivedGroup', { n: model.archived.length })}</summary>
          {model.archived.map((p) => (
            <div key={p.id} className="side-arch-row">
              <button type="button" className="nav sub" data-testid="nav-archived-project" onClick={() => go({ view: 'dash', projectId: p.id })}>
                <span className="proj-n">{p.name}</span>
              </button>
              <button type="button" className="link small" data-testid="project-restore" onClick={() => void submit('project.unarchived', { projectId: p.id })}>
                {t('pj.restore')}
              </button>
            </div>
          ))}
        </details>
      )}
      <div className="grow" />
      <button type="button" className={`nav${route.view === 'agents' ? ' on' : ''}`} data-testid="nav-agents" onClick={() => go({ view: 'agents' })}>
        <span>{t('nav.agents')}</span>
      </button>
      {!isWeb(app) && <UpdateCallout />}
      <div className="side-user">
        <Avatar userId={me} />
        <div className="grow">
          <div className="side-user-n">{displayName(live, me)}</div>
          {model.anySample && (
            <div className="side-user-s" title={t('app.sampleTip')}>
              {t('app.sample')}
            </div>
          )}
          <button type="button" className="link" data-testid="sign-out" title={isWeb(app) ? t('web.signOut') : t('user.signOut')} onClick={() => void bridge.signOut()}>
            {isWeb(app) ? t('web.signOut') : t('user.signOut')}
          </button>
          {!isWeb(app) && <UpdateEntry />}
        </div>
        <div className="seg seg-xs" role="group" aria-label={t('user.language')}>
          {SUPPORTED_LOCALES.map((l) => (
            <button type="button" key={l} data-testid={`lang-${l}`} className={l === locale ? 'on' : undefined} onClick={() => setLocale(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
