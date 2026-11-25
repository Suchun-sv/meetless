// Change request, requirements, meetings, deliveries, inbox, skills, roles.
const STEPS = ['making', 'review', 'revise', 'final', 'confirmed', 'delivered'];

function ChangeView() {
  const { t, lang, S } = useClient();
  const M = window.MeetlessMock;
  if (!S.hasChange) return <div className="empty">{t('ws.notYet')}</div>;
  const cur = S.rounds[0];
  const allApproved = cur && !cur.basisChanged && cur.approvals.every((a) => a.state === 'approved');
  const noBlock = !S.open.some((o) => M.issues[o.id] && M.issues[o.id].sev === 'block');
  const gate = [
    { k: 'ch.gateReviews', ok: allApproved },
    { k: 'ch.gateEvidence', ok: S.cut >= 12 },
    { k: 'ch.gateBlockers', ok: S.cut >= 5 && noBlock },
    { k: 'ch.gateBase', ok: true }
  ];
  return (
    <div className="page">
      <div className="page-h">
        <div>
          <div className="muted small mono">C-24</div>
          <h1>{txs({ src: 'en', 'zh-CN': '客户数据导出', en: 'Customer data export' }, lang)}</h1>
        </div>
        <div className="row gap6 wrap">
          <ActBtn k="act.publish" /><ActBtn k="act.request" /><ActBtn k="act.decide" /><ActBtn k="act.split" /><ActBtn k="act.withdraw" kind="ghost" />
          {S.status === 'final' && <ActBtn k="act.confirm" kind="primary" />}
          {S.status === 'confirmed' && <ActBtn k="act.deliver" kind="primary" />}
        </div>
      </div>
      <div className="steps">
        {STEPS.map((s) => <div key={s} className={'step' + (s === S.status ? ' on' : '') + (STEPS.indexOf(s) < STEPS.indexOf(S.status) ? ' done' : '')}>{t('cs.' + s)}</div>)}
      </div>
      <div className="grid2">
        <div className="kvs">
          <div className="kv"><span>{t('ch.req')}</span><span><span className="mono">R-12</span> <Tx c={M.requirement.title} /></span></div>
          <div className="kv"><span>{t('ch.accept')}</span><Tx c={S.acc} /></div>
          <div className="kv"><span>{t('ch.driver')}</span><Person id="ben" /></div>
          <div className="kv"><span>{t('ch.approver')}</span><Person id="lin" /></div>
          <div className="kv"><span>{t('ch.reviewers')}</span><span className="row gap8 wrap"><Person id="zhou" /><span className="muted small">{txs(M.roles.tech, lang)}</span><Person id="lin" /><span className="muted small">{txs(M.roles.sales, lang)}</span></span></div>
          <div className="kv"><span>{t('ch.base')}</span><span className="mono">B-2</span></div>
        </div>
        <div className="gate">
          <div className="gate-h">{t('ch.gate')}</div>
          {gate.map((g) => <div key={g.k} className={'gate-i ' + (g.ok ? 'ok' : 'no')}><span className="gate-m"></span>{t(g.k)}</div>)}
        </div>
      </div>
      <h3 className="h3">{t('ch.rounds')}</h3>
      {S.rounds.length === 0 && <div className="faint">{t('ws.none')}</div>}
      {S.rounds.map((r) => (
        <div key={r.id} className={'round' + (r.basisChanged ? ' void' : '')}>
          <div className="round-h"><strong>{lang === 'zh-CN' ? '第 ' + r.id + ' 轮' : 'Round ' + r.id}</strong>{r.basisChanged && <Badge tone="amber">{t('ch.basisChanged')}</Badge>}</div>
          {r.basisChanged && <div className="note n-amber">{t('ch.basisChangedNote', { d: 'D-5' })}</div>}
          <div className="grid2">
            <div><div className="lbl">{t('ch.manifest')}</div><div className="stack4">{r.manifest.map((v) => <VerChip key={v} vid={v} />)}</div></div>
            <div><div className="lbl">{t('ch.basis')}</div><div className="stack4">{r.basis.map((b) => <span key={b} className="ver"><span className="ver-k">REF</span>{b}</span>)}</div></div>
          </div>
          <div className="approvals">
            {r.approvals.map((a) => (
              <div key={a.who} className={'appr a-' + a.state}>
                <Person id={a.who} />
                <Badge tone={a.state === 'approved' ? 'green' : a.state === 'void' ? 'gray' : 'outline'}>{t(a.state === 'approved' ? 'ch.approved' : a.state === 'void' ? 'ch.invalid' : 'ch.pending')}</Badge>
              </div>
            ))}
            {r.approvals.some((a) => a.state === 'pending') && <span className="muted small">{t('ch.pendingNote')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function RequirementsView() {
  const { t, S, fmt, lang } = useClient();
  const M = window.MeetlessMock;
  if (!S.hasReq) return <div className="empty">{t('ws.notYet')}</div>;
  return (
    <div className="page">
      <div className="page-h"><h1><span className="mono">R-12</span> <Tx c={M.requirement.title} /></h1><ActBtn k="nav.newChange" /></div>
      <div className="revs">
        <div className={'rev' + (S.decisions.length ? ' old' : '')}><div className="lbl">rev 1 · {fmt('2026-11-03T10:15:00Z')} · {M.people.lin.name}</div><Tx c={M.requirement.acc1} /></div>
        {S.decisions.length > 0 && <div className="rev"><div className="lbl">rev 2 · {fmt('2026-11-07T17:30:00Z')} · {t('ctx.source')} D-5 / M-1</div><Tx c={M.requirement.acc2} /></div>}
      </div>
      {S.decisions.length > 0 && <div className="muted small">R-15 · {txs({ src: 'zh-CN', 'zh-CN': '其余字段导出（下一期）', en: 'Export remaining fields (next phase)' }, lang)} · {t('ctx.source')} D-5</div>}
    </div>
  );
}

function MeetingsView() {
  const { t, S, fmt } = useClient();
  const M = window.MeetlessMock;
  if (!S.meetings.length) return <div className="empty">{t('ws.none')}</div>;
  const confirmed = S.cut >= 9;
  return (
    <div className="page">
      {S.meetings.slice().reverse().map((id) => {
        const m = M.meetings[id];
        const ev = M.events.find((e) => (id === 'M-1' && e.type === 'meeting') || (id === 'M-0' && e.type === 'import'));
        return (
          <div key={id} className="meeting">
            <div className="page-h"><div><div className="muted small mono">{id}</div><h2><Tx c={m.title} /></h2></div>
              <div className="muted small right">{m.late ? <span>{t('mt.held', { t: fmt(ev.occurredAt) })}<br />{t('mt.recorded', { t: fmt(ev.at) })}</span> : t('mt.held', { t: fmt(ev.at) })}</div></div>
            <div className="kv"><span>{t('mt.purpose')}</span><Tx c={m.purpose} /></div>
            <div className="kv"><span>{t('mt.attendees')}</span><span className="row gap8 wrap">{m.attendees.map((p) => <Person key={p} id={p} />)}</span></div>
            {m.refs.length > 0 && <div className="kv"><span>{t('mt.refs')}</span><span className="stack4">{m.refs.map((v) => <VerChip key={v} vid={v} />)}</span></div>}
            <div className="lbl">{t('mt.notes')}</div>
            {m.notes.map((n, i) => <div key={i} className="mnote"><Person id={n.who} /><div><Tx c={n.text} block /></div></div>)}
            <div className="lbl">{t('mt.outcomes')}</div>
            {id === 'M-1' && !confirmed && <div className="note n-blue">{t('mt.aiDraft')}</div>}
            {m.outcomes.map((o, i) => {
              const ok = o.k === 'lean' ? false : (id === 'M-0' || confirmed);
              return (
                <div key={i} className="outcome">
                  <Badge tone={o.k === 'decision' ? 'green' : o.k === 'lean' ? 'gray' : 'blue'}>{t('mt.k.' + o.k)}</Badge>
                  <div className="grow"><Tx c={o.text} /></div>
                  <span className="muted small">{o.k === 'lean' ? '' : ok ? t('mt.confirmedBy', { who: M.people.lin.name }) : t('mt.awaiting', { who: M.people[o.who].name })}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DeliveriesView() {
  const { t, S, fmt, lang } = useClient();
  if (!S.delivery) return <div className="empty">{t('ws.none')}</div>;
  return (
    <div className="page">
      <div className="page-h"><div><div className="muted small mono">P-1 · {t('ctx.baseline')} B-3</div><h1>{lang === 'zh-CN' ? '客户 A 首版交付包' : 'Client A v1 delivery package'}</h1></div></div>
      <div className="stack4">{S.baseline.items.map((v) => <VerChip key={v} vid={v} />)}</div>
      <div className="timeline-list">
        <div><Badge tone="green">{t('ev.delivery')}</Badge> {fmt('2026-11-14T11:00:00Z')} · Ben Carter</div>
        <div>{S.delivery.state === 'accepted' ? <span><Badge tone="green">{t('ev.accept')}</Badge> {fmt('2026-11-17T10:00:00Z')} · Lin An</span> : <span><Badge tone="outline">{t('inbox.g.accept')}</Badge></span>}</div>
      </div>
    </div>
  );
}

const INBOX = [
  { g: 'supply', who: 'lin', title: { src: 'zh-CN', 'zh-CN': 'R-15 补充验收条件', en: 'Add acceptance criteria to R-15' }, why: { src: 'zh-CN', 'zh-CN': '你是 R-15 的负责人；来自 D-5', en: 'You own R-15; raised by D-5' }, ref: 'R-15', due: '2026-11-26T17:00:00Z' },
  { g: 'decide', who: 'lin', title: { src: 'zh-CN', 'zh-CN': '是否用 sales-claims v1.4 重跑已交付提案', en: 'Rerun delivered proposal with sales-claims v1.4?' }, why: { src: 'zh-CN', 'zh-CN': '你维护该 skill；新规则 SC-06 不会自动改写旧报告', en: 'You maintain this skill; new rule SC-06 never rewrites old reports' }, ref: 'PPTX v4', due: '2026-11-28T17:00:00Z' },
  { g: 'review', who: 'ben', title: { src: 'en', 'zh-CN': '评估 R-15 对 crm-web 的影响', en: 'Assess R-15 impact on crm-web' }, why: { src: 'en', 'zh-CN': 'Lin An 发起了「评估影响」交接', en: 'Lin An sent you an "assess impact" handoff' }, ref: 'crm-web@3f9a21c', due: '2026-11-27T12:00:00Z' },
  { g: 'fix', who: 'zhou', title: { src: 'zh-CN', 'zh-CN': '备注字段导出权限设计', en: 'Permission design for notes export' }, why: { src: 'zh-CN', 'zh-CN': '技术岗位待办', en: 'Engineering role backlog' }, ref: 'R-15', due: '2026-12-03T17:00:00Z' }
];
function InboxView({ user }) {
  const { t, fmt } = useClient();
  const mine = INBOX.filter((i) => i.who === user);
  const groups = ['supply', 'review', 'decide', 'fix', 'accept'];
  return (
    <div className="page narrow">
      <h1>{t('inbox.title')}</h1>
      {mine.length === 0 && <div className="faint">{t('inbox.empty')}</div>}
      {groups.filter((g) => mine.some((i) => i.g === g)).map((g) => (
        <div key={g} className="igroup">
          <div className="lbl">{t('inbox.g.' + g)}</div>
          {mine.filter((i) => i.g === g).map((i, k) => (
            <div key={k} className="iitem">
              <div className="grow"><div className="iitem-t"><Tx c={i.title} /></div><div className="muted small">{t('inbox.why')}: <Tx c={i.why} /> · <span className="mono">{i.ref}</span></div></div>
              <div className="right small"><div className="muted">{t('inbox.due')}</div><div>{fmt(i.due)}</div></div>
              <Btn kind="sm" title={t('app.sampleTip')}>{t('inbox.snooze')}</Btn>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SkillsView() {
  const { t, lang } = useClient();
  const M = window.MeetlessMock;
  const [sid, setSid] = React.useState('sales-claims');
  const sk = M.skills.find((s) => s.id === sid);
  const usedBy = { '1.3': ['AR-31', 'AR-40'], '1.4': [], '2.0': ['AR-32', 'AR-35', 'AR-41'] };
  return (
    <div className="page">
      <h1>{t('sk.title')}</h1>
      <div className="row gap8 wrap">{M.skills.map((s) => <button key={s.id} className={'chip' + (s.id === sid ? ' on' : '')} onClick={() => setSid(s.id)}>{s.id}</button>)}</div>
      <div className="kvs">
        <div className="kv"><span>{t('sk.agent')}</span><span>{txs(M.roles[sk.role], lang)}</span></div>
        <div className="kv"><span>{t('sk.scope')}</span><Tx c={sk.scope} /></div>
        <div className="kv"><span>{t('sk.maintainer')}</span><Person id={sk.maintainer} /></div>
      </div>
      <div className="note n-gray">{t('sk.note')}</div>
      <div className="skv-row">
        {sk.versions.slice().reverse().map((v) => (
          <div key={v.v} className="skv">
            <div className="row gap8"><strong className="mono">{sk.id} v{v.v}</strong><Badge tone={v.status === 'active' ? 'green' : 'gray'}>{t('sk.' + v.status)}</Badge></div>
            {v.rules.map((r) => <div key={r.id} className={'rule' + (r.added ? ' added' : '')}><Badge tone={SEV_TONE[r.sev]}>{t('sev.' + r.sev)}</Badge><span className="mono small">{r.id}</span><span className="grow"><Tx c={r.text} /></span></div>)}
            <div className="lbl">{t('sk.usedBy')}</div>
            <div className="muted small mono">{(usedBy[v.v] || []).join(' · ') || '—'}</div>
            {v.status === 'active' && sk.id === 'sales-claims' && <ActBtn k="sk.rerun" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function RolesView() {
  const { t, lang } = useClient();
  const M = window.MeetlessMock;
  return (
    <div className="page narrow">
      <h1>{t('nav.roles')}</h1>
      {Object.keys(M.roles).map((r) => (
        <div key={r} className="igroup">
          <div className="lbl">{txs(M.roles[r], lang)}</div>
          {Object.keys(M.people).filter((p) => M.people[p].roles.indexOf(r) >= 0).map((p) => (
            <div key={p} className="iitem"><Person id={p} /><span className="grow"></span><span className="muted small">{t('user.lang')}: {M.people[p].lang === 'zh-CN' ? '简体中文' : 'English'}</span></div>
          ))}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { ChangeView, RequirementsView, MeetingsView, DeliveriesView, InboxView, SkillsView, RolesView, INBOX });
