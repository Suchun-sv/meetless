import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { Avatar } from '../ui/primitives';
import { topbarModel } from './model';
import { RenameInput } from './RenameInput';
import { toggleNav, useNavOpen } from './nav';

/** Three horizontal strokes, square ends (no round caps, no dot characters). */
function MenuIcon() {
  return (
    <svg className="nav-toggle-i" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The crumb (project and view, or only the view on a global view), the project's members
 * (`top-members`, which opens the members page) and 「待确认」with its count. The project name
 * has a 「重命名」 action (`top-rename`) that swaps it for the inline `RenameInput` (contract 12.23).
 * Under 760px the `nav-toggle` (hidden above it) opens the sidebar drawer (`shell/nav.ts`). */
export function Topbar() {
  const { live, me, today, route, t, go, openOverlay } = useApp();
  const model = topbarModel(live, me, route, today);
  const title = t(model.titleKey);
  const pid = model.projectId;
  const [renaming, setRenaming] = useState<string | null>(null);
  const navOpen = useNavOpen(route);
  return (
    <div className="top">
      <button type="button" className="nav-toggle" data-testid="nav-toggle" aria-label={t('web.menu')} title={t('web.menu')} aria-expanded={navOpen} onClick={() => toggleNav(route)}>
        <MenuIcon />
      </button>
      <div className="crumb3">
        {pid ? (
          <>
            {renaming === pid && model.projectName !== null ? (
              <RenameInput key={pid} projectId={pid} name={model.projectName} className="crumb-inp" onDone={() => setRenaming(null)} />
            ) : (
              <>
                <span className="crumb-p">{model.projectName}</span>
                {model.projectName !== null && (
                  <button type="button" className="link crumb-act" data-testid="top-rename" onClick={() => setRenaming(pid)}>
                    {t('pj.rename')}
                  </button>
                )}
              </>
            )}
            <span className="faint">/ {title}</span>
          </>
        ) : (
          <span className="crumb-p">{title}</span>
        )}
      </div>
      {pid && (
        <div className="row gap6">
          <button type="button" className="top-members" data-testid="top-members" title={t('top.members')} onClick={() => go({ view: 'members', projectId: pid })}>
            <span className="avs">
              {model.memberIds.map((m) => (
                <Avatar key={m} userId={m} size="sm" />
              ))}
            </span>
          </button>
          <button type="button" className={`ask-btn${model.confirmCount > 0 ? ' has' : ''}`} data-testid="topbar-confirm" onClick={() => openOverlay({ kind: 'confirm', projectId: pid })}>
            {t('ask.btn')}
            {model.confirmCount > 0 && <span className="count">{model.confirmCount}</span>}
          </button>
        </div>
      )}
    </div>
  );
}
