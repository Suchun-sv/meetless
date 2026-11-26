import type { ReactNode } from 'react';
import { chatMessages, clip, handoffStaleness, SEP, type AgentReply, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { materialRoute } from '../app/routes';
import { displayName } from '../model/state';
import { NeedChip, Status } from '../ui/primitives';
import { routeErrorText } from '../setup/model';
import { runCmds } from '../collab/answer';
import { acceptCommands } from '../collab/confirm';
import { newId } from '../model/ids';
import { importCommand, importPriv, importResult, onDashboardFor } from './model';

interface ReplyProps {
  reply: AgentReply;
  scope: 'home' | Id;
  messageId: Id;
}

/** A clickable one-line row (contract §8: "today" items, handoff and stale actions, open-dashboard, import). */
function Row({ onClick, children, testId }: { onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" className="link" data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The project agent's reply, by `reply.answer.intent` (contract §8). Everything shown here comes
 * from `live` (never from the frozen reply alone) so a cite that is no longer visible — a need
 * deleted or gone private to someone else — is skipped rather than shown broken.
 */
export function Reply({ reply, scope, messageId }: ReplyProps) {
  const { t, live, me, today, route, fmtDay, submit, api, go, openNeed, openOverlay, notify, errorText } = useApp();
  const a = reply.answer;
  const code = (id: Id | null) => (id ? live.needs[id]?.code ?? '' : '');

  switch (a.intent) {
    case 'retrieval': {
      const groups = a.needs.filter((g) => live.needs[g.needId]);
      // Skipped the same way need cites not in `live.needs` are: a material whose input or artifact
      // has gone private to someone else, or been deleted, is never shown (contract §12.21).
      const materials = a.materials.filter((m) => (m.kind === 'input' ? live.inputs[m.id] : live.artifacts[m.id]));
      const gen = a.text !== undefined;
      return (
        <>
          {gen ? <div className="rp-gen">{a.text}</div> : <div>{t('ans.found')}</div>}
          {gen && groups.length > 0 && (
            <div className="row gap6 wrap">
              {groups.map((g) => (
                <NeedChip key={g.needId} projectId={live.needs[g.needId]!.projectId} needId={g.needId} />
              ))}
            </div>
          )}
          {!gen && groups.map((g) => {
            const n = live.needs[g.needId]!;
            return (
              <div key={g.needId} className="rp-group">
                <NeedChip projectId={n.projectId} needId={g.needId} />
                {g.hits.slice(0, 2).map((h, i) => (
                  <div key={i} className="small faint">
                    {t(`ans.f.${h.field}`)}
                    {SEP}
                    {clip(h.text, 140)}
                  </div>
                ))}
              </div>
            );
          })}
          {materials.length > 0 && (
            <div className="rp-group">
              <div className="small faint">{t('ans.materials')}</div>
              {materials.map((m, i) => {
                const kindLabel = t(m.kind === 'input' ? 'nav.inputs' : 'nav.artifacts');
                return (
                  <div key={i} className="rp-mat">
                    <button type="button" className="chip" data-testid="material-chip" data-kind={m.kind} data-material={m.id} onClick={() => go(materialRoute(m))}>
                      {kindLabel}
                      {SEP}
                      {clip(m.title, 60)}
                      {m.kind === 'artifact' && m.page != null && (
                        <>
                          {SEP}
                          {t('ans.f.page')}
                          {SEP}
                          {m.page + 1}
                        </>
                      )}
                    </button>
                    <div className="small faint">{m.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      );
    }

    case 'summary': {
      if (a.projectId === null) return <div>{t('ans.summaryHome', { p: a.projects })}</div>;
      if (a.round) {
        const round = t('round', { n: live.rounds[a.round.roundId]?.n ?? 0 });
        return <div>{t('ans.summary', { round, d: a.round.daysLeft, doing: a.counts.doing, todo: a.counts.todo, met: a.counts.met })}</div>;
      }
      return <div>{t('ans.summaryNoRound', { doing: a.counts.doing, todo: a.counts.todo, met: a.counts.met })}</div>;
    }

    case 'today': {
      const items = a.items.filter((it) => it.needId === null || live.needs[it.needId]);
      if (items.length === 0) return <div>{t('ans.today.none')}</div>;
      return (
        <>
          <div>{t('ans.today')}</div>
          {items.map((it, i) => {
            let label: string;
            let onClick: () => void;
            switch (it.kind) {
              case 'conflict':
                label = t('ans.today.conflict', { need: code(it.needId) });
                onClick = () => openOverlay({ kind: 'confirm', projectId: it.projectId });
                break;
              case 'proposal':
                label = t('ans.today.proposal');
                onClick = () => openOverlay({ kind: 'confirm', projectId: it.projectId });
                break;
              case 'confirm':
                label = t('ans.today.confirm');
                onClick = () => openOverlay({ kind: 'confirm', projectId: it.projectId });
                break;
              case 'toMe': {
                const h = live.handoffs[it.id];
                label = t('ans.today.toMe', { need: code(it.needId), who: h ? displayName(live, h.fromId) : '' });
                onClick = () => openNeed(it.projectId, it.needId!);
                break;
              }
              case 'stale': {
                const h = live.handoffs[it.id];
                label = t('ans.today.stale', { need: code(it.needId), who: h ? displayName(live, h.toId) : '' });
                onClick = () => openNeed(it.projectId, it.needId!);
                break;
              }
              case 'mine':
                label = t('ans.today.mine', { need: code(it.needId) });
                onClick = () => openNeed(it.projectId, it.needId!);
                break;
            }
            return (
              <Row key={i} onClick={onClick}>
                {label}
              </Row>
            );
          })}
        </>
      );
    }

    case 'deadlines': {
      if (a.items.length === 0) return <div>{t('common.none')}</div>;
      return (
        <>
          <div>{t('ans.deadlines')}</div>
          {a.items.map((it, i) => {
            const round = live.rounds[it.roundId];
            const p = live.projects[it.projectId]?.name ?? '';
            const left = it.daysLeft >= 0 ? t('round.left', { n: it.daysLeft }) : t('round.over', { n: -it.daysLeft });
            return (
              <div key={i} className="small">
                {t('ans.deadline', { p, round: t('round', { n: round?.n ?? 0 }), d: round ? fmtDay(round.due) : '', left })}
              </div>
            );
          })}
        </>
      );
    }

    case 'weekly': {
      if (a.people.length === 0) return <div>{t('ans.weeklyNone')}</div>;
      return (
        <>
          <div>{t('ans.weekly')}</div>
          {a.people.map((p, i) => (
            <div key={i} className="small">
              {t('ans.weeklyRow', { who: displayName(live, p.userId), n: p.count, text: clip(p.text, 80) })}
            </div>
          ))}
        </>
      );
    }

    case 'delivery': {
      const lines = a.lines.filter((l) => live.needs[l.needId]);
      if (lines.length === 0) return <div>{t('ans.deliveryNone')}</div>;
      const round = t('round', { n: live.rounds[a.roundId ?? '']?.n ?? 0 });
      return (
        <>
          <div>{t('ans.delivery', { round })}</div>
          {lines.map((l) => (
            <div key={l.needId} className="row gap6 wrap">
              <NeedChip projectId={live.needs[l.needId]!.projectId} needId={l.needId} />
              <Status s={l.status} />
            </div>
          ))}
        </>
      );
    }

    case 'addCard': {
      const name = t(`w.${a.card}`);
      const onThisDash = onDashboardFor(scope, route.view);
      return (
        <>
          <div>{t('ch.cardOn', { name })}</div>
          {!onThisDash && <Row onClick={() => go(scope === 'home' ? { view: 'home' } : { view: 'dash', projectId: scope })}>{t('ch.openDash')}</Row>}
        </>
      );
    }

    case 'added': {
      // What is still pending is read from `live`: accepted or ignored since, it is no longer offered.
      const input = live.inputs[a.inputId];
      const pending = input ? input.extracts.filter((x) => x.state === null) : [];
      // A conflicting revision of a shared need is decided in To confirm, never accepted in bulk.
      const bulk = input ? pending.filter((x) => !(x.conflict && input.privateTo === null)) : [];
      const allNew = a.items.length > 0 && a.items.every((x) => x.type === 'new');
      const head = a.items.length === 0 ? t('ans.added.none') : allNew ? t('ans.added.new', { n: a.items.length }) : t('ans.added', { n: a.items.length });
      const acceptAll = () => {
        if (!input) return Promise.resolve(false);
        const made = new Map<string, string>();
        // Parents first, so a hypothesis accepted in the same batch hangs under its need.
        const ordered = [...bulk].sort((a, b) => Number(!!a.parent && bulk.some((y) => y.id === a.parent)) - Number(!!b.parent && bulk.some((y) => y.id === b.parent)));
        return runCmds(ordered.flatMap((x) => acceptCommands(live, input, x, newId('n'), today, x.due ?? null, made)), submit);
      };
      return (
        <>
          <div>{head}</div>
          {a.items.map((it) => (
            <div key={it.extractId} className="small" data-testid="added-item" data-type={it.type}>
              {t(`in.x.${it.type}`)}
              {it.type === 'rev' && it.needId ? `${SEP}${code(it.needId)}` : ''}
              {SEP}
              {it.text}
            </div>
          ))}
          {pending.length > 0 ? (
            <div className="row gap6 wrap">
              {bulk.length > 0 && (
                <Row testId="added-accept-all" onClick={() => void acceptAll()}>
                  {t('ans.added.acceptAll')}
                </Row>
              )}
              <Row testId="added-review" onClick={() => openOverlay({ kind: 'confirm', projectId: a.projectId })}>
                {t('ans.added.review')}
              </Row>
            </div>
          ) : (
            a.items.length > 0 && input && <div className="small faint">{t('ans.added.done')}</div>
          )}
        </>
      );
    }

    case 'asInput': {
      // The visibility the text was sent under, never the switch now (ruling R21); private with no record.
      const priv = importPriv(messageId);
      const onImport = async () => {
        if (scope === 'home') return;
        const projectId = scope;
        const text = chatMessages(live, me, scope).find((m) => m.id === messageId)?.text ?? '';
        const req = importCommand({ projectId, messageId, text, priv, today });
        const out = importResult(await api('inputs.import', req), projectId, req.inputId);
        if ('route' in out) go(out.route);
        else notify('error', routeErrorText(t, errorText, out.code));
      };
      return (
        <>
          <div>{t('ch.asInput')}</div>
          <Row testId="chat-import" onClick={() => void onImport()}>
            {t('ch.importTo', { v: t(priv ? 'pv.only' : 'pv.project') })}
          </Row>
        </>
      );
    }

    case 'handoff': {
      const need = a.needId ? live.needs[a.needId] : null;
      const who = a.toId ? live.users[a.toId] : null;
      if (!need || !who) return <div>{t('ans.handoffNone')}</div>;
      return (
        <>
          <div>{t('ans.handoff', { need: need.code, who: who.displayName })}</div>
          <Row onClick={() => openOverlay({ kind: 'handoff', projectId: a.projectId, needId: need.id, toId: a.toId! })}>{t('ho.btn')}</Row>
        </>
      );
    }

    case 'stale': {
      const items = a.items.filter((it) => live.needs[it.needId]);
      if (items.length === 0) return <div>{t('ans.staleNone')}</div>;
      return (
        <>
          <div>{t('ans.stale', { n: items.length })}</div>
          {items.map((it) => {
            const h = live.handoffs[it.handoffId];
            const stale = h ? handoffStaleness(live, h) : null;
            const reminded = !stale || stale.reminded;
            return (
              <div key={it.handoffId} className="row gap6 wrap">
                <span className="small">{t('ch.staleRow', { need: code(it.needId), who: h ? displayName(live, h.toId) : '', v: it.fetched, current: it.current })}</span>
                {reminded ? <span className="faint small">{t('ho.reminded')}</span> : <Row onClick={() => void submit('handoff.refresh_requested', { handoffId: it.handoffId })}>{t('ho.remind')}</Row>}
              </div>
            );
          })}
        </>
      );
    }
  }
}
