// Work stream (traces → AI reading), deliveries, and the "AI asks" panel.
function Stream() {
  const { L, t, fmt, work, setAsk } = useCtx();
  const rows = work.filter((w) => !w.ignored).slice().reverse();
  return (
    <div className="page">
      <h1>{t('st.title')}</h1>
      <p className="muted">{t('st.sub')}</p>
      <div className="stream-h"><span>{t('st.signal')}</span><span></span><span>{t('st.reading')}</span></div>
      {rows.map((w) => (
        <div key={w.id} className={'srow' + (w.ask && !w.answered ? ' asking' : '')} data-work={w.id}>
          <div className="sig">
            <span className={'wsrc w-' + w.src}>{SRC_GLYPH[w.src]}</span>
            <div>
              <div className="small faint">{t('src.' + w.src) + DOT + fmt(w.date)}</div>
              <div className={w.src === 'commit' ? 'mono' : ''}>{L(w.text)}</div>
            </div>
          </div>
          <div className="arrow">→</div>
          <div className="read">
            {w.need ? (
              <div className="row gap6 wrap">
                {w.ef && <Pill tone={EF_TONE[w.ef]}>{t('ef.' + w.ef)}</Pill>}
                <NeedChip id={w.need} />
                {w.extra && <span className="mono small faint">+ {w.extra}</span>}
                {w.also && <NeedChip id={w.also} />}
                {w.res && <Pill tone={w.res === 'keep' ? 'green' : 'muted'}>{t('res.' + w.res)}</Pill>}
              </div>
            ) : <div className="faint">?</div>}
            <div className="small muted">{L(w.why)}</div>
            <div className="row gap6">
              <AiMark conf={w.conf} confirmed={w.answered} />
              {w.ask && !w.answered && <button className="btn btn-sm btn-primary" onClick={() => setAsk(true)}>{t('ask.btn')}</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Deliveries() {
  const { P, L, t, fmt } = useCtx();
  return (
    <div className="page">
      <h1>{t('dl.title')}</h1>
      {P.rounds.slice().reverse().map((r) => (
        <section key={r.n} className={'dl dl-' + r.status}>
          <div className="dl-h">
            <span className={'tl-ms ms-' + r.kind + ' s-' + r.status + ' static'}></span>
            <strong>{t('round', { n: r.n }) + DOT + L(r.title)}</strong>
            <Pill tone={r.status === 'delivered' ? 'green' : r.status === 'current' ? 'blue' : 'gray'}>{t('round.' + r.status)}</Pill>
            <span className="faint small">{t('round.due', { d: fmt(r.due) }) + DOT + (r.kind === 'hard' ? t('tl.hard') : t('tl.cadence'))}</span>
          </div>
          {!r.delivery && <div className="faint small">{t('dl.none')}</div>}
          {r.delivery && (
            <div className="dl-b">
              {r.delivery.draft && <div className="note">{t('dl.draft')}</div>}
              <div className="dl-grid">
                <div>
                  <h3>{t('dl.items')}</h3>
                  <ul className="plain">{r.delivery.items.map((it, i) => <li key={i}>{L(it)}</li>)}</ul>
                </div>
                <div>
                  <h3>{t('dl.account')}</h3>
                  {r.delivery.account.map((a) => <div key={a.need} className="acc"><NeedChip id={a.need} /><Status s={a.v} /><span className="small muted">{L(a.note)}</span></div>)}
                </div>
              </div>
              {r.delivery.feedback && (
                <div>
                  <h3>{t('dl.feedback')}</h3>
                  {r.delivery.feedback.map((f, i) => (
                    <div key={i} className="fb"><span className="muted">“{L(f.text)}” — {L(P.people[f.who])}</span><span className="row gap6 wrap">→ {f.needs.map((id) => <NeedChip key={id} id={id} />)}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function AskPanel() {
  const { L, t, questions, answered, answer, setAsk } = useCtx();
  const open = questions.filter((q) => !answered[q.id]);
  const done = questions.filter((q) => answered[q.id]);
  return (
    <div className="scrim" onClick={() => setAsk(false)}>
      <div className="askp" onClick={(e) => e.stopPropagation()} data-ask="panel">
        <div className="row"><h2 className="grow">{t('ask.title')}</h2><button className="x" onClick={() => setAsk(false)} aria-label={t('close')}>×</button></div>
        <p className="muted small">{t('ask.sub')}</p>
        {open.length === 0 && <div className="empty-ask">{t('ask.empty')}</div>}
        {open.map((q) => (
          <div key={q.id} className="q" data-q={q.id}>
            <div className="q-t">{L(q.q)}</div>
            <div className="small muted">{L(q.why)}</div>
            <div className="q-opts">{q.options.map((o, i) => <button key={i} className="btn" onClick={() => answer(q, o)}>{L(o.label)}</button>)}</div>
          </div>
        ))}
        {done.map((q) => (
          <div key={q.id} className="q done"><div className="small">{L(q.q)}</div><div className="small ok">✓ {t('ask.answered') + DOT + L(answered[q.id].label)}</div></div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Stream, Deliveries, AskPanel });
