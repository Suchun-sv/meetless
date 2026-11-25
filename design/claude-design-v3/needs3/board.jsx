// v3 needs board, lineage and drawer: owners, handoff state, private items, agent reports and captures.
function HandoffLine({ h, compact }) {
  const { P, L, t } = useCtx();
  const toMe = h.to === 'me';
  const who = L(P.people[toMe ? h.from : h.to]).split(/[（(]/)[0];
  return (
    <span className={'hoff' + (compact ? ' sm' : '') + (toMe && h.state === 'sent' ? ' hot' : '')}>
      {(toMe ? t('ho.from', { who }) : t('ho.to', { who })) + DOT + t('ho.st.' + h.state)}
    </span>
  );
}

function NeedCard({ n }) {
  const { L, t, P, openNeed, openId, workFor, pendingAsk, handoffFor } = useCtx();
  const ev = workFor(n.id).filter((w) => !w.capture && ['exp', 'commit', 'doc', 'file', 'agent'].indexOf(w.src) >= 0).length;
  const h = handoffFor(n.id);
  const asking = pendingAsk(n);
  const who = n.by && n.by !== 'me' ? L(P.people[n.by]) : t('card.self');
  return (
    <div className={'card c-' + n.kind + ' s-' + n.status + (openId === n.id ? ' on' : '') + (n.isNew ? ' fresh' : '') + (n.private ? ' priv' : '')} data-need={n.id} onClick={() => openNeed(n.id)}>
      <div className="card-h"><KindMark kind={n.kind} /><span className="mono faint">{n.id}</span>{n.private && <span className="lock">{t('pv.mine')}</span>}<span className="grow"></span><Status s={n.status} /></div>
      <div className="card-t">{L(n.title)}</div>
      <div className="card-m">{ev > 0 ? who + DOT + t('card.evidence', { n: ev }) : who}</div>
      {(h || n.owner || asking) && (
        <div className="card-f">
          {h ? <HandoffLine h={h} compact /> : asking ? <span className="card-ai ask">{t('ask.btn')}</span> : <span></span>}
          <span className="grow"></span>
          {n.owner && <Avatar who={n.owner} P={P} size="sm" />}
        </div>
      )}
    </div>
  );
}

function Board({ kindFilter }) {
  const { P, L, t, fmt, needs, roundFilter } = useCtx();
  const rounds = P.rounds.filter((r) => !roundFilter || r.n === roundFilter);
  return (
    <div className="cols" style={{ gridTemplateColumns: 'repeat(' + rounds.length + ', minmax(230px, 1fr))' }}>
      {rounds.map((r) => {
        const all = needs.filter((n) => n.round === r.n && (!kindFilter || n.kind === kindFilter));
        const live = all.filter((n) => n.status !== 'refuted').sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ext' ? -1 : 1));
        const dead = all.filter((n) => n.status === 'refuted');
        const left = Math.round((ms(r.due) - ms(P.today)) / DAY);
        return (
          <section key={r.n} className={'col col-' + r.status} data-round={r.n}>
            <div className="col-h">
              <div className="row gap6"><span className={'tl-ms ms-' + r.kind + ' s-' + r.status + ' static'}></span><strong>{t('round', { n: r.n }) + DOT + L(r.title)}</strong></div>
              <div className="col-sub"><span>{t('round.' + r.status) + DOT + t('round.due', { d: fmt(r.due) })}</span>{r.status === 'current' && <span className="left">{DOT + t('round.left', { n: left })}</span>}</div>
            </div>
            {live.length === 0 && dead.length === 0 && <div className="faint small pad">{t('col.empty')}</div>}
            {live.map((n) => <NeedCard key={n.id} n={n} />)}
            {dead.length > 0 && <details className="refuted"><summary>{t('col.refuted', { n: dead.length })}</summary>{dead.map((n) => <NeedCard key={n.id} n={n} />)}</details>}
          </section>
        );
      })}
    </div>
  );
}

function Lineage() {
  const { P, L, t, needs } = useCtx();
  const kids = (id) => needs.filter((n) => n.parent === id);
  const Node = ({ n }) => (
    <li><NeedChip id={n.id} /> <Status s={n.status} />{kids(n.id).length > 0 && <ul>{kids(n.id).map((k) => <Node key={k.id} n={k} />)}</ul>}</li>
  );
  const roots = needs.filter((n) => !n.parent && !n.private);
  const groups = [{ key: 'direct', items: roots.filter((n) => !n.fromRound) }];
  P.rounds.forEach((r) => { const items = roots.filter((n) => n.fromRound === r.n); if (items.length) groups.push({ key: 'r' + r.n, round: r, items }); });
  return (
    <div className="lineage">
      <h2>{t('lin.title')}</h2>
      {groups.map((g) => (
        <div key={g.key} className="lin-g">
          <div className="lin-src">{g.round ? <span><span className="pill p-ink">{t('round', { n: g.round.n }) + DOT + L(g.round.title)}</span> <span className="faint">{t('round.delivered')} → {t('lin.feedback')}</span></span> : <span className="faint">{t('lin.direct')}</span>}</div>
          {g.round && g.round.delivery && g.round.delivery.feedback.map((f, i) => <div key={i} className="lin-quote">“{L(f.text)}” <span className="faint">— {L(P.people[f.who])}</span></div>)}
          <ul className="tree">{g.items.map((n) => <Node key={n.id} n={n} />)}</ul>
        </div>
      ))}
    </div>
  );
}

function HandoffBlock({ n, h }) {
  const { P, L, t, fmt, ctxVer, setHandoff, setLink } = useCtx();
  const toMe = h.to === 'me';
  const v = ctxVer(n);
  const stale = !toMe && h.fetched && h.fetched.v < v && !h.reminded;
  return (
    <div className={'hob' + (toMe && h.state === 'sent' ? ' hot' : '')} data-handoff={h.id}>
      <div className="row gap6"><Avatar who={toMe ? h.from : h.to} P={P} size="sm" /><HandoffLine h={h} /><span className="grow"></span><span className="small faint">{t('ho.dueOn', { d: fmt(h.due) })}</span></div>
      <div className="hob-ask">{L(h.ask)}</div>
      {!toMe && h.fetched && <div className="small faint">{t('ho.fetched', { v: h.fetched.v, at: fmt(h.fetched.at) })}</div>}
      {stale && <div className="hob-warn"><span>{t('ho.stale', { v })}</span><button className="btn btn-sm" onClick={() => setHandoff(h.id, { reminded: true })}>{t('ho.remind')}</button></div>}
      {!toMe && h.reminded && <div className="small ok">✓ {t('ho.reminded')}</div>}
      {toMe && h.state === 'sent' && (
        <div className="row gap6 wrap">
          <button className="btn btn-sm btn-primary" onClick={() => setHandoff(h.id, { state: 'accepted' })}>{t('ho.accept')}</button>
          <button className="btn btn-sm" onClick={() => setHandoff(h.id, { state: 'asked' })}>{t('ho.question')}</button>
          <button className="btn btn-sm" onClick={() => setHandoff(h.id, { state: 'declined' })}>{t('ho.decline')}</button>
        </div>
      )}
      {toMe && (h.state === 'accepted' || h.state === 'doing') && (
        <div className="row gap6 wrap">
          <button className="btn btn-sm btn-primary" onClick={() => setLink({ need: n.id })}>{t('lk.btn')}</button>
          <button className="btn btn-sm" onClick={() => setHandoff(h.id, { state: 'returned' })}>{t('ho.return')}</button>
        </div>
      )}
      {!toMe && h.state === 'returned' && <button className="btn btn-sm btn-primary" onClick={() => setHandoff(h.id, { state: 'done' })}>{t('ho.confirm')}</button>}
    </div>
  );
}

function Drawer() {
  const { P, L, t, fmt, openId, openNeed, needById, needs, workFor, setNeed, roundOf, artifacts, openArtifact, setLink, setHandoffFor, handoffFor, capture, publish } = useCtx();
  const [fixing, setFixing] = React.useState(false);
  React.useEffect(() => setFixing(false), [openId]);
  const n = needById(openId);
  if (!n) return null;
  const work = workFor(n.id);
  const kids = needs.filter((k) => k.parent === n.id);
  const arts = artifacts.filter((a) => a.needs.indexOf(n.id) >= 0);
  const h = handoffFor(n.id);
  const conf = n.conf || {};
  return (
    <aside className="drawer" data-drawer={n.id}>
      <div className="dr-h">
        <div className="row gap6"><KindMark kind={n.kind} /><span className="mono faint">{n.id}</span><span className="faint small">{t('kind.' + n.kind)}</span><span className="grow"></span>
          <button className="x" onClick={() => openNeed(null)} aria-label={t('close')}>×</button></div>
        <h2>{L(n.title)}</h2>
        <div className="row gap6 wrap"><Status s={n.status} />{n.private && <span className="lock">{t('pv.mine')}</span>}{n.verdict && <span className="small muted">{L(n.verdict)}</span>}</div>
        <div className="row gap6 wrap">
          {!n.private && <button className="btn btn-sm btn-primary" onClick={() => setHandoffFor(n.id)} data-ho="open">{t('ho.btn')}</button>}
          {!n.private && <button className="btn btn-sm" onClick={() => setLink({ need: n.id })} data-link="open">{t('lk.btn')}</button>}
          {n.private && <button className="btn btn-sm btn-primary" onClick={() => publish(n.id)} data-pv="publish">{t('pv.publish')}</button>}
        </div>
      </div>

      {h && <HandoffBlock n={n} h={h} />}

      <section className="dr-s">
        <h3>{t('dr.source')}</h3>
        <blockquote>{L(n.source.quote)}</blockquote>
        <div className="row gap6 small faint wrap"><span className="src">{SRC_GLYPH[n.source.src]} {t('src.' + n.source.src)}</span><span>{L(n.source.ref) + DOT + fmt(n.source.date)}</span><button className="link">{t('dr.open')} ↗</button></div>
      </section>

      <section className="dr-s">
        <h3>{t('dr.meta')}</h3>
        <div className="kv"><span>{t('own.owner')}</span><span className="row gap6">{n.owner ? <React.Fragment><Avatar who={n.owner} P={P} size="sm" />{L(P.people[n.owner])}</React.Fragment> : <span className="faint">{t('own.none')}</span>}</span></div>
        <div className="kv"><span>{t('dr.requester')}</span><span>{n.by && n.by !== 'me' ? L(P.people[n.by]) : t('card.self')}</span></div>
        <div className="kv"><span>{t('dr.round')}</span>
          <span className="row gap6 wrap">{t('round', { n: n.round }) + DOT + L(roundOf(n.round).title)}<AiMark conf={conf.round || 'h'} confirmed={n.confirmed} onFix={() => setFixing(!fixing)} /></span></div>
        {fixing && <div className="fix">{P.rounds.map((r) => <button key={r.n} className={'chip' + (r.n === n.round ? ' on' : '')} onClick={() => { setNeed(n.id, { round: r.n, confirmed: true }); setFixing(false); }}>{t('round', { n: r.n }) + DOT + L(r.title)}</button>)}</div>}
        {n.parent && <div className="kv"><span>{t('dr.parent')}</span><span><NeedChip id={n.parent} /></span></div>}
        {n.kind === 'ext' ? <div className="kv"><span>{t('dr.accept')}</span><span>{L(n.accept)}</span></div> : (
          <React.Fragment>
            <div className="kv"><span>{t('dr.expect')}</span><span>{L(n.expect)}</span></div>
            <div className="kv"><span>{t('dr.verify')}</span><span>{L(n.verify)}</span></div>
          </React.Fragment>
        )}
      </section>

      {n.revisions && n.revisions.length > 0 && (
        <section className="dr-s"><h3>{t('dr.rev')}</h3>
          {n.revisions.map((r, i) => <div key={i} className="rev"><div><span className="faint small">{fmt(r.date)}</span> {L(r.text)}</div><div className="small muted">{L(r.why)}</div></div>)}
        </section>
      )}

      <section className="dr-s">
        <div className="row"><h3 className="grow">{t('dr.work')}</h3>{!n.private && <button className="link" onClick={() => capture(n.id)} data-cap="go">{t('cap.btn')}</button>}</div>
        {work.length === 0 && <div className="faint small">{t('dr.none')}</div>}
        <ol className="wlist">
          {work.slice().reverse().map((w) => (
            <li key={w.id} className={w.capture ? 'cap' : ''}>
              <span className={'wsrc w-' + w.src}>{w.by ? <Avatar who={w.by} P={P} size="sm" /> : SRC_GLYPH[w.src]}</span>
              <div className="grow">
                <div className="row gap6 wrap"><span className="faint small">{fmt(w.date)}</span><span className="wt">{L(w.text)}</span></div>
                <div className="row gap6 wrap small">{w.capture ? <span className="capl">{t('cap.label')}</span> : w.ef && <Pill tone={EF_TONE[w.ef]}>{t('ef.' + w.ef)}</Pill>}{w.res && <Pill tone={w.res === 'keep' ? 'green' : 'muted'}>{t('res.' + w.res)}</Pill>}{!w.capture && <span className="muted">{L(w.why)}</span>}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {arts.length > 0 && (
        <section className="dr-s"><h3>{t('dr.artifacts')}</h3>
          {arts.map((a) => <button key={a.id} className="li li-btn" onClick={() => openArtifact(a.id)}><div className="row gap6"><FileKind kind={a.kind} /><span className="li-t">{L(a.title)}</span><span className="grow"></span><span className="small faint">{a.where}</span></div></button>)}
        </section>
      )}
      {kids.length > 0 && <section className="dr-s"><h3>{t('dr.children')}</h3><div className="stack">{kids.map((k) => <div key={k.id} className="row gap6"><NeedChip id={k.id} /><Status s={k.status} /></div>)}</div></section>}
    </aside>
  );
}

Object.assign(window, { NeedCard, Board, Lineage, Drawer, HandoffLine });
