// Agent-generated dashboards: one per project, one cross-project ("Home"). Cards are computed from the
// project record, so they stay current; the agent adds, refreshes or removes them on request.
const DONE = { met: 1, held: 1, refuted: 1, dropped: 1, moved: 1 };
const P_WIDGETS = { progress: 1, risks: 1, members: 2, delivery: 1, hyps: 1, activity: 2, sources: 1, weekly: 1 };
const H_WIDGETS = { projects: 2, toMe: 1, confirm: 1, byMe: 1, mine: 1, due: 1, allRisks: 1 };
const P_DEFAULT = ['progress', 'risks', 'members', 'delivery', 'hyps', 'activity'];
const H_DEFAULT = ['projects', 'toMe', 'confirm', 'byMe', 'mine', 'due'];
const W_KEYWORDS = [['sources', /来源|source/i], ['weekly', /本周|谁|week/i], ['members', /成员|岗位|member|role/i], ['risks', /风险|risk/i],
  ['hyps', /假设|hypo/i], ['delivery', /交付|deliver/i], ['progress', /进度|progress/i], ['activity', /动态|activity/i], ['allRisks', /风险|risk/i], ['mine', /我负责|mine|owned/i]];

const cur = (P) => P.rounds.find((r) => r.status === 'current') || P.rounds[0];
const nm = (L, P, k) => (P.people[k] ? L(P.people[k]).split(/[（(]/)[0].trim() : k);
// Who did a piece of work: explicit author, else a "Name:" prefix in the trace, else the current user.
function whoOf(P, L, w) {
  if (w.by) return w.by;
  const txt = L(w.text);
  const k = Object.keys(P.people).find((p) => p !== 'me' && (txt.indexOf(nm(L, P, p) + '：') === 0 || txt.indexOf(nm(L, P, p) + ':') === 0));
  return k || 'me';
}

function riskList(P, st, qs, t, L) {
  const out = [];
  const ver = (n) => 1 + ((n && n.revisions) || []).length;
  st.handoffs.forEach((h) => {
    const n = st.needs.find((x) => x.id === h.need);
    if (h.from === 'me' && h.fetched && h.fetched.v < ver(n) && !h.reminded) out.push({ tone: 'amber', text: t('rk.stale', { need: h.need, who: nm(L, P, h.to), v: h.fetched.v }), need: h.need });
    if (h.state === 'sent') out.push({ tone: h.to === 'me' ? 'violet' : 'gray', text: h.to === 'me' ? t('rk.waitMe', { need: h.need }) : t('rk.wait', { need: h.need, who: nm(L, P, h.to) }), need: h.need });
  });
  const cf = qs.filter((q) => q.conflict && !st.answered[q.id]).length;
  if (cf) out.push({ tone: 'amber', text: t('rk.conflict', { n: cf }), ask: true });
  const inp = st.inputs.filter((i) => i.status === 'pending').length;
  if (inp) out.push({ tone: 'gray', text: t('rk.inputs', { n: inp }), view: 'inputs' });
  const r = cur(P);
  const left = Math.round((ms(r.due) - ms(P.today)) / DAY);
  if (left <= 5) st.needs.filter((n) => n.round === r.n && n.kind === 'ext' && n.status === 'todo').forEach((n) => out.push({ tone: 'red', text: t('rk.todo', { need: n.id, d: left }), need: n.id }));
  return out;
}

function Widget({ id, span, home, stamp, onRefresh, onRemove, children }) {
  const { t } = useCtx();
  const ts = new Date(stamp).toTimeString().slice(0, 5);
  return (
    <section className={'wg' + (span === 2 ? ' wide' : '')} data-widget={id}>
      <div className="wg-h">
        <h3>{t('w.' + id)}</h3>
        <span className="grow"></span>
        <span className="wg-meta">{t(home ? 'db.byHome' : 'db.by') + DOT + t('db.updated', { t: ts })}</span>
        <button className="wg-act" onClick={onRefresh}>{t('db.refresh')}</button>
        <button className="wg-act" onClick={onRemove} aria-label={t('db.remove')}>×</button>
      </div>
      <div className="wg-b">{children}</div>
    </section>
  );
}

function NeedLink({ id }) {
  const { needById, L, goNeed } = useCtx();
  const n = needById(id);
  if (!n) return <span className="mono faint">{id}</span>;
  return <button className="nlink" onClick={(e) => { e.stopPropagation(); goNeed(id); }}><KindMark kind={n.kind} /><span className="mono faint">{n.id}</span><span className="nlink-t">{L(n.title)}</span></button>;
}

function Bar({ a, b }) {
  const pct = b ? Math.round((a / b) * 100) : 0;
  return <div className="bar2"><div className="bar2-f" style={{ width: pct + '%' }}></div></div>;
}

function ProjectWidget({ id, st }) {
  const { P, L, t, fmt, roles, questions, goView, setAsk } = useCtx();
  const r = cur(P);
  const left = Math.round((ms(r.due) - ms(P.today)) / DAY);
  const needs = st.needs.filter((n) => !n.private);
  const work = st.work.filter((w) => !w.ignored && !w.capture);
  if (id === 'progress') {
    const ext = needs.filter((n) => n.round === r.n && n.kind === 'ext');
    const done = ext.filter((n) => n.status === 'met').length;
    const doing = ext.filter((n) => n.status === 'doing' || n.status === 'partial').length;
    const hyp = needs.filter((n) => n.round === r.n && n.kind === 'hyp' && (n.status === 'testing' || n.status === 'untested')).length;
    return (
      <div className="pg">
        <div className="pg-top"><div><div className="pg-big">{t('round.left', { n: left })}</div><div className="muted">{t('round', { n: r.n }) + DOT + L(r.title) + DOT + t('round.due', { d: fmt(r.due) })}</div></div>
          <span className={'tl-ms ms-' + r.kind + ' s-current static big'}></span></div>
        <Bar a={done} b={ext.length} />
        <div className="pg-row"><span>{t('pg.done', { a: done, b: ext.length })}</span><span>{t('pg.doing', { n: doing })}</span><span>{t('pg.todo', { n: ext.length - done - doing })}</span><span>{t('pg.hyp', { n: hyp })}</span></div>
      </div>
    );
  }
  if (id === 'risks') {
    const list = riskList(P, st, questions, t, L);
    if (!list.length) return <div className="faint small">{t('rk.none')}</div>;
    return <div className="rk">{list.map((x, i) => (
      <div key={i} role="button" tabIndex={0} className={'rk-i r-' + x.tone} onClick={() => (x.ask ? setAsk(true) : x.view ? goView(x.view) : null)}>
        <span className="grow">{x.text}</span>{x.need && <NeedLink id={x.need} />}
      </div>))}</div>;
  }
  if (id === 'members') {
    return <div className="mb">{roles.map((ro) => ro.members.map((m) => {
      const owns = needs.filter((n) => n.owner === m && !DONE[n.status]).length;
      const last = work.filter((w) => whoOf(P, L, w) === m && w.src !== 'meeting').slice(-1)[0];
      const hs = st.handoffs.filter((h) => h.to === m || h.from === m);
      return (
        <div key={m} className="mb-i">
          <Avatar who={m} P={P} />
          <div className="grow">
            <div className="row gap6"><strong>{nm(L, P, m)}</strong><span className="faint small">{L(ro.name)}</span><span className="grow"></span><span className="small muted">{t('mb.owns', { n: owns })}</span></div>
            <div className="small muted mb-l">{last ? fmt(last.date) + DOT + L(last.text) : t('mb.none')}</div>
            {hs.map((h) => <div key={h.id} className="small faint">{h.need + DOT + (h.to === m ? t('ho.from', { who: nm(L, P, h.from) }) : t('ho.to', { who: nm(L, P, h.to) })) + DOT + t('ho.st.' + h.state)}</div>)}
          </div>
        </div>
      );
    }))}</div>;
  }
  if (id === 'delivery') {
    const acc = (r.delivery && r.delivery.account) || [];
    return <div className="stack">{acc.map((a) => <div key={a.need} className="dl-i"><NeedLink id={a.need} /><span className="grow"></span><Status s={a.v} /></div>)}
      {r.delivery && r.delivery.draft && <div className="faint small">{t('dl.draft')}</div>}</div>;
  }
  if (id === 'hyps') {
    const hs = needs.filter((n) => n.kind === 'hyp');
    const c = (s) => hs.filter((n) => n.status === s).length;
    return (
      <div className="stack">
        <div className="hy-row">{['held', 'refuted', 'testing', 'untested'].map((s) => <div key={s} className={'hy-c st t-' + ST_TONE[s]}><div className="hy-n">{c(s)}</div><div className="small">{t('st.' + s)}</div></div>)}</div>
        {hs.slice(-4).reverse().map((n) => <div key={n.id} className="dl-i"><NeedLink id={n.id} /><span className="grow"></span><Status s={n.status} /></div>)}
      </div>
    );
  }
  if (id === 'activity') {
    return <div className="act">{work.slice(-6).reverse().map((w) => (
      <div key={w.id} className="act-i"><span className="act-d faint small">{fmt(w.date)}</span>{w.by ? <Avatar who={w.by} P={P} size="sm" /> : <span className="wsrc sm">{SRC_GLYPH[w.src]}</span>}
        <span className="grow act-t">{L(w.text)}</span>{w.need && <NeedLink id={w.need} />}</div>))}</div>;
  }
  if (id === 'sources') {
    const by = {};
    needs.forEach((n) => { const k = n.by || 'me'; by[k] = (by[k] || 0) + 1; });
    const max = Math.max.apply(null, Object.values(by));
    return <div className="stack">{Object.keys(by).sort((a, b) => by[b] - by[a]).map((k) => (
      <div key={k} className="src-i"><span className="src-n">{P.people[k] ? L(P.people[k]) : k}</span><div className="bar2 grow"><div className="bar2-f" style={{ width: (by[k] / max) * 100 + '%' }}></div></div><span className="small faint">{t('sr.count', { n: by[k] })}</span></div>))}</div>;
  }
  if (id === 'weekly') {
    const since = ms(P.today) - 7 * DAY;
    const by = {};
    work.filter((w) => ms(w.date) >= since && w.src !== 'meeting').forEach((w) => { const k = whoOf(P, L, w); (by[k] = by[k] || []).push(w); });
    return <div className="stack">{Object.keys(by).map((k) => (
      <div key={k} className="mb-i"><Avatar who={k} P={P} size="sm" /><div className="grow"><div className="row gap6"><strong className="small">{nm(L, P, k)}</strong><span className="small faint">{t('wk.items', { n: by[k].length })}</span></div>
        <div className="small muted mb-l">{L(by[k][by[k].length - 1].text)}</div></div></div>))}</div>;
  }
  return null;
}

function Dashboard({ ids, stamps, onRefresh, onRemove, home, render, composer, hero }) {
  const spans = home ? H_WIDGETS : P_WIDGETS;
  return (
    <div className="dash">
      {hero}
      <div className="dash-grid">
        {ids.map((id) => <Widget key={id} id={id} span={spans[id]} home={home} stamp={stamps[id]} onRefresh={() => onRefresh(id)} onRemove={() => onRemove(id)}>{render(id)}</Widget>)}
      </div>
      {composer}
    </div>
  );
}

// Cross-project cards for Home.
function HomeWidget({ id, items, projects, states, go, openAsk, act, qsOf }) {
  const { L, t, fmt, lang } = useCtx();
  const Tag = ({ p }) => <span className="ptag">{p.name[lang].split(/[：:]/)[0].trim().split(' ')[0]}</span>;
  if (id === 'projects') {
    return <div className="pj">{projects.map((p) => {
      const st = states[p.id]; const r = cur(p);
      const ext = st.needs.filter((n) => n.round === r.n && n.kind === 'ext' && !n.private);
      const done = ext.filter((n) => n.status === 'met').length;
      const left = Math.round((ms(r.due) - ms(p.today)) / DAY);
      return (
        <button key={p.id} className="pj-i" onClick={() => go(p.id, 'dash')}>
          <div className="row gap6"><strong className="grow">{p.name[lang]}</strong><span className={'small' + (left <= 5 ? ' warn' : ' faint')}>{t('round.left', { n: left })}</span></div>
          <div className="small muted">{t('round', { n: r.n }) + DOT + L(r.title) + DOT + t('round.due', { d: fmt(r.due) })}</div>
          <Bar a={done} b={ext.length} />
          <div className="small faint">{t('pg.done', { a: done, b: ext.length })}</div>
        </button>
      );
    })}</div>;
  }
  if (id === 'confirm') {
    if (!items.confirm.length) return <div className="faint small">{t('home.empty')}</div>;
    return <div className="stack">{items.confirm.map(({ p, q }) => (
      <button key={p.id + q.id} className="hrow" onClick={() => openAsk(p.id)}><Tag p={p} />{q.conflict && <span className="pill p-amber">{t('cf.title')}</span>}<span className="grow hrow-t">{L(q.q)}</span><span className="small faint">{t('home.go')} ›</span></button>))}</div>;
  }
  if (id === 'toMe') {
    if (!items.toMe.length) return <div className="faint small">{t('home.empty')}</div>;
    return <div className="stack">{items.toMe.map(({ p, h, n }) => (
      <div key={p.id + h.id} className="hitem">
        <div className="row gap6"><Avatar who={h.from} P={p} size="sm" /><span className="small">{t('ho.from', { who: nm(L, p, h.from) })}</span><Tag p={p} /><span className="grow"></span><span className="small faint">{t('ho.dueOn', { d: fmt(h.due) })}</span></div>
        <button className="hlink" onClick={() => go(p.id, 'board', n.id)}><span className="mono faint">{n.id}</span> {L(n.title)}</button>
        <div className="small muted">{L(h.ask)}</div>
        {h.state === 'sent' ? (
          <div className="row gap6">
            <button className="btn btn-sm btn-primary" onClick={() => act(p.id, h.id, { state: 'accepted' })} data-home-accept={h.id}>{t('ho.accept')}</button>
            <button className="btn btn-sm" onClick={() => act(p.id, h.id, { state: 'asked' })}>{t('ho.question')}</button>
            <button className="btn btn-sm" onClick={() => act(p.id, h.id, { state: 'declined' })}>{t('ho.decline')}</button>
          </div>
        ) : <div className="row gap6"><span className="st t-blue">{t('ho.st.' + h.state)}</span><span className="grow"></span>{(h.state === 'accepted' || h.state === 'doing') && <button className="btn btn-sm" onClick={() => act(p.id, h.id, null, n.id)}>{t('lk.btn')}</button>}</div>}
      </div>))}</div>;
  }
  if (id === 'byMe') {
    return <div className="stack">{items.byMe.map(({ p, h, n, stale, last }) => (
      <button key={p.id + h.id} className="hitem hbtn" onClick={() => go(p.id, 'board', n.id)}>
        <div className="row gap6"><Avatar who={h.to} P={p} size="sm" /><span className="small">{t('ho.to', { who: nm(L, p, h.to) }) + DOT + t('ho.st.' + h.state)}</span><Tag p={p} /></div>
        <div><span className="mono faint">{n.id}</span> {L(n.title)}</div>
        {last && <div className="small muted">{L(last.text)}</div>}
        {stale && <div className="small warn">{t('ho.stale', { v: stale })}</div>}
      </button>))}</div>;
  }
  if (id === 'mine') {
    const list = [];
    projects.forEach((p) => states[p.id].needs.filter((n) => n.owner === 'me' && !DONE[n.status]).forEach((n) => list.push({ p, n })));
    if (!list.length) return <div className="faint small">{t('mine.none')}</div>;
    return <div className="stack">{list.map(({ p, n }) => (
      <button key={p.id + n.id} className="hrow" onClick={() => go(p.id, 'board', n.id)}><Tag p={p} /><span className="mono faint small">{n.id}</span><span className="grow hrow-t">{L(n.title)}</span><Status s={n.status} /></button>))}</div>;
  }
  if (id === 'due') {
    return <div className="stack">{items.due.map(({ p, r, left }) => (
      <button key={p.id} className="hrow" onClick={() => go(p.id, 'dash')}><span className={'tl-ms ms-' + r.kind + ' s-current static'}></span><span className="grow hrow-t">{p.name[lang]}<span className="faint">{DOT + t('round', { n: r.n }) + ' ' + L(r.title)}</span></span>
        <span className={'small' + (left <= 5 ? ' warn' : ' faint')}>{fmt(r.due) + DOT + t('round.left', { n: left })}</span></button>))}</div>;
  }
  if (id === 'allRisks') {
    const list = [];
    projects.forEach((p) => riskList(p, states[p.id], qsOf(p), t, L).forEach((x) => list.push({ p, x })));
    if (!list.length) return <div className="faint small">{t('rk.none')}</div>;
    return <div className="rk">{list.map(({ p, x }, i) => <div key={i} role="button" tabIndex={0} className={'rk-i r-' + x.tone} onClick={() => go(p.id, 'dash')}><Tag p={p} /><span className="grow">{x.text}</span></div>)}</div>;
  }
  return null;
}

Object.assign(window, { Dashboard, ProjectWidget, HomeWidget, P_WIDGETS, H_WIDGETS, P_DEFAULT, H_DEFAULT, W_KEYWORDS });
