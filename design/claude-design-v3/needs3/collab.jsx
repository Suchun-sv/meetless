// Link-for-agent modal, handoff modal, and the "to confirm" panel with conflicts.
function promptFor(ctx, target) {
  const { P, t } = ctx;
  const url = 'meetless://' + P.id + '/' + (target.need || target.artifact);
  return { url, text: t('lk.prompt1', { url }) + '\n' + t('lk.prompt2') };
}
function shareCtx(ctx) {
  // Private items never leave the owner: links and previews exclude them.
  return Object.assign({}, ctx, { needs: ctx.needs.filter((n) => !n.private) });
}
function copyText(s) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).catch(() => {});
  return Promise.resolve();
}

function PromptBox({ target }) {
  const ctx = useCtx();
  const { t } = ctx;
  const [open, setOpen] = React.useState(false);
  const [gen, setGen] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const p = promptFor(ctx, target);
  const stamp = gen ? new Date(gen).toTimeString().slice(0, 8) : t('lk.now');
  return (
    <div className="pbox">
      <div className="row gap6"><span className="small faint grow">{t('lk.prompt')}</span>
        <button className="btn btn-sm btn-primary" data-link="copy" onClick={() => { copyText(p.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? '✓ ' + t('cp.copied') : t('lk.copy')}</button></div>
      <pre className="pbox-p">{p.text}</pre>
      <div className="row gap6">
        <button className="link" onClick={() => setOpen(!open)} data-link="preview">{(open ? '▾ ' : '▸ ') + t('lk.preview')}</button>
        <span className="grow"></span>
        {open && <span className="small faint">{t('lk.gen', { t: stamp })}</span>}
        {open && <button className="link" onClick={() => setGen(Date.now())} data-link="refresh">{t('lk.refresh')}</button>}
      </div>
      {open && <textarea className="inp mono-ta" readOnly value={buildContext(shareCtx(ctx), target, true)} key={gen || 0}></textarea>}
      <div className="small faint">{t('lk.note')}</div>
    </div>
  );
}

function LinkModal() {
  const { t, link, setLink } = useCtx();
  return (
    <div className="scrim" onClick={() => setLink(null)}>
      <div className="askp wide" onClick={(e) => e.stopPropagation()} data-link="modal">
        <div className="row"><h2 className="grow">{t('lk.btn')}</h2><button className="x" onClick={() => setLink(null)} aria-label={t('close')}>×</button></div>
        <PromptBox target={link} />
      </div>
    </div>
  );
}

function HandoffModal() {
  const { P, L, t, fmt, handoffNeed, setHandoffFor, roles, addHandoff, needById } = useCtx();
  const n = needById(handoffNeed);
  const people = [];
  roles.forEach((r) => r.members.forEach((m) => { if (m !== 'me') people.push({ m, role: r }); }));
  const [to, setTo] = React.useState(people[0] && people[0].m);
  const [ask, setAsk] = React.useState('');
  const cur = P.rounds.find((r) => r.status === 'current') || P.rounds[0];
  const dues = [['week', '2026-11-27'], ['next', '2026-12-04'], ['round', cur.due]];
  const [due, setDue] = React.useState('week');
  return (
    <div className="scrim" onClick={() => setHandoffFor(null)}>
      <div className="askp wide" onClick={(e) => e.stopPropagation()} data-ho="modal">
        <div className="row"><h2 className="grow">{t('ho.title')}</h2><button className="x" onClick={() => setHandoffFor(null)} aria-label={t('close')}>×</button></div>
        <div className="row gap6 small faint"><KindMark kind={n.kind} /><span className="mono">{n.id}</span><span>{L(n.title)}</span></div>
        <div className="people">
          {people.map(({ m, role }) => (
            <button key={m} className={'person' + (to === m ? ' on' : '')} data-person={m} onClick={() => setTo(m)}>
              <Avatar who={m} P={P} /><span className="grow"><span className="person-n">{L(P.people[m]).split(/[（(]/)[0]}</span><span className="person-r">{L(role.name)}</span></span>{to === m && <span>✓</span>}
            </button>
          ))}
        </div>
        <textarea className="inp" rows={2} placeholder={t('ho.askPh')} value={ask} onChange={(e) => setAsk(e.target.value)} data-ho="ask"></textarea>
        <div className="row gap6 wrap"><span className="small faint">{t('ho.due')}</span>
          {dues.map(([k, d]) => <button key={k} className={'chip' + (due === k ? ' on' : '')} onClick={() => setDue(k)}>{t('ho.d.' + k) + ' ' + fmt(d)}</button>)}</div>
        <h3>{t('ho.preview')}</h3>
        <PromptBox target={{ need: n.id }} />
        <div className="row gap6" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setHandoffFor(null)}>{t('in.cancel')}</button>
          <button className="btn btn-primary" data-ho="send" onClick={() => { addHandoff({ need: n.id, to, ask: ask.trim() || L(n.title), due: dues.find((d) => d[0] === due)[1] }); setHandoffFor(null); }}>{t('ho.send')}</button>
        </div>
      </div>
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
        <p className="muted small" style={{ margin: 0 }}>{t('ask.sub')}</p>
        {open.length === 0 && <div className="empty-ask">{t('ask.empty')}</div>}
        {open.map((q) => (
          <div key={q.id} className={'q' + (q.conflict ? ' qc' : '')} data-q={q.id}>
            {q.conflict && <span className="pill p-amber">{t('cf.title')}</span>}
            <div className="q-t">{L(q.q)}</div>
            {q.conflict && (
              <div className="cf">
                <div className="cf-b"><div className="small faint">{t('cf.old') + ' ' + q.conflict.need}</div><div>{L(q.conflict.old)}</div></div>
                <div className="cf-b neu"><div className="small faint">{t('cf.new') + DOT + L(q.conflict.src)}</div><div>{L(q.conflict.neu)}</div></div>
              </div>
            )}
            <div className="small muted">{L(q.why)}</div>
            <div className="q-opts">{q.options.map((o, i) => <button key={i} className="btn" onClick={() => answer(q, o)}>{L(o.label)}</button>)}</div>
          </div>
        ))}
        {done.map((q) => <div key={q.id} className="q done"><div className="small">{L(q.q)}</div><div className="small ok">{'✓ ' + t('ask.answered') + DOT + L(answered[q.id].label)}</div></div>)}
      </div>
    </div>
  );
}

Object.assign(window, { LinkModal, HandoffModal, AskPanel, PromptBox, promptFor });
