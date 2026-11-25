import { SEP, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { NeedChip, Pill, Status } from '../ui/primitives';
import { childrenOf, lineageGroups, quoted } from './model';

/** One lineage node and its children, nested by `childrenOf` (a private child never appears under a shared parent). */
function Node({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live } = useApp();
  const need = live.needs[needId];
  const kids = childrenOf(live, needId);
  if (!need) return null;
  return (
    <li>
      <NeedChip projectId={projectId} needId={needId} /> <Status s={need.status} />
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Node key={k.id} projectId={projectId} needId={k.id} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The project's need lineage (needs3/board.jsx `Lineage`): direct roots first, then one
 * group per delivered round that produced roots, each with that round's feedback quotes.
 */
export function Lineage({ projectId }: { projectId: Id }) {
  const { live, t } = useApp();
  const groups = lineageGroups(live, projectId);
  return (
    <div className="lineage" data-testid="lineage">
      <h2>{t('lin.title')}</h2>
      {groups.map((g) => (
        <div key={g.round?.id ?? 'direct'} className="lin-g">
          <div className="lin-src">
            {g.round ? (
              <span>
                <Pill tone="strong">{t('round', { n: g.round.n }) + SEP + g.round.title}</Pill>
                <span className="faint">{SEP}{t('round.delivered')} → {t('lin.feedback')}</span>
              </span>
            ) : (
              <span className="faint">{t('lin.direct')}</span>
            )}
          </div>
          {g.quotes.map((q, i) => (
            <div key={i} className="lin-quote">
              {quoted(q.text)}
              {q.who && <span className="faint">{` — ${q.who}`}</span>}
            </div>
          ))}
          <ul className="tree">
            {g.roots.map((n) => (
              <Node key={n.id} projectId={projectId} needId={n.id} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
