// Copy-context for your own agent, and the agent (MCP) settings page.
function buildContext(ctx, target, full) {
  const { P, L, t, fmt, needs, work, artifacts, roundOf, lang } = ctx;
  const out = [];
  const line = (s) => out.push(s);
  if (target.artifact) {
    const a = artifacts.find((x) => x.id === target.artifact);
    const v = a.versions[0];
    line('# ' + L(a.title) + ' (' + a.where + ')');
    line('> ' + (typeof v.v === 'string' ? v.v : L(v.v)) + DOT + fmt(v.date) + DOT + L(v.note));
    line('');
    line('## ' + t('af.needs'));
    a.needs.forEach((id) => { const n = needs.find((x) => x.id === id); if (n) line('- ' + n.id + ' ' + L(n.title) + ' — ' + t('st.' + n.status)); });
  } else {
    const n = needs.find((x) => x.id === target.need);
    const r = roundOf(n.round);
    line('# ' + n.id + ' ' + L(n.title));
    line('> ' + t('kind.' + n.kind) + DOT + t('round', { n: r.n }) + ' ' + L(r.title) + DOT + t('round.due', { d: fmt(r.due) }) + DOT + t('st.' + n.status));
    line('');
    if (n.kind === 'ext') { line('## ' + t('dr.accept')); line(L(n.accept)); }
    else { line('## ' + t('dr.expect')); line(L(n.expect)); line('## ' + t('dr.verify')); line(L(n.verify)); if (n.verdict) { line('## ' + t('dr.verdict')); line(L(n.verdict)); } }
    line('');
    line('## ' + t('dr.source'));
    line(L(n.source.quote) + ' — ' + L(n.source.ref) + DOT + fmt(n.source.date));
    if (n.revisions && n.revisions.length) { line(''); line('## ' + t('dr.rev')); n.revisions.forEach((x) => line('- ' + fmt(x.date) + ' ' + L(x.text) + '（' + L(x.why) + '）')); }
    const ws = work.filter((w) => !w.ignored && (w.need === n.id || w.also === n.id));
    if (ws.length) { line(''); line('## ' + t('dr.work')); (full ? ws : ws.slice(-3)).forEach((w) => line('- ' + fmt(w.date) + ' ' + L(w.text) + (w.ef ? ' — ' + t('ef.' + w.ef) : ''))); }
    if (full) {
      const kids = needs.filter((k) => k.parent === n.id);
      if (kids.length) { line(''); line('## ' + t('dr.children')); kids.forEach((k) => line('- ' + k.id + ' ' + L(k.title) + ' — ' + t('st.' + k.status))); }
      const arts = artifacts.filter((a) => a.needs.indexOf(n.id) >= 0);
      if (arts.length) { line(''); line('## ' + t('dr.artifacts')); arts.forEach((a) => line('- ' + L(a.title) + ' ' + (typeof a.versions[0].v === 'string' ? a.versions[0].v : L(a.versions[0].v)) + ' (' + a.where + ')')); }
      const dead = needs.filter((k) => k.status === 'refuted');
      if (dead.length) { line(''); line('## ' + t('cp.refuted')); dead.forEach((k) => line('- ' + k.id + ' ' + L(k.title) + (k.verdict ? ' — ' + L(k.verdict) : ''))); }
    }
  }
  line('');
  line('---');
  if (target.need) line(t('cp.mcp', { id: target.need }));
  line(t('cp.report'));
  return out.join('\n');
}

function CopyModal() {
  const ctx = useCtx();
  const { t, copy, setCopy } = ctx;
  const [full, setFull] = React.useState(true);
  const [done, setDone] = React.useState(false);
  const text = buildContext(ctx, copy, full);
  const ref = React.useRef(null);
  const doCopy = () => {
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => { ref.current.select(); document.execCommand('copy'); ok(); });
    else { ref.current.select(); document.execCommand('copy'); ok(); }
  };
  return (
    <div className="scrim" onClick={() => setCopy(null)}>
      <div className="askp wide" onClick={(e) => e.stopPropagation()} data-copy="modal">
        <div className="row gap6"><h2 className="grow">{t('cp.btn')}</h2>
          <div className="seg">{[[false, 'cp.brief'], [true, 'cp.full']].map(([f, k]) => <button key={k} className={full === f ? 'on' : ''} onClick={() => setFull(f)}>{t(k)}</button>)}</div>
          <button className="x" onClick={() => setCopy(null)} aria-label={t('close')}>×</button></div>
        <textarea ref={ref} className="inp ta mono-ta" readOnly value={text}></textarea>
        <div className="row gap6"><span className="faint small grow">{t('cp.warn')}</span>
          <button className="btn btn-primary" onClick={doCopy} data-copy="go">{done ? '✓ ' + t('cp.copied') : t('cp.copy')}</button></div>
      </div>
    </div>
  );
}

const AGENTS = [
  { id: 'cc', name: 'Claude Code', snippet: (p) => 'claude mcp add meetless -- npx -y @meetless/mcp --project ' + p },
  { id: 'codex', name: 'Codex', snippet: (p) => '# ~/.codex/config.toml\n[mcp_servers.meetless]\ncommand = "npx"\nargs = ["-y", "@meetless/mcp", "--project", "' + p + '"]\nenv = { MEETLESS_TOKEN = "ml_••••" }' }
];
const TOOLS = ['get_need_context', 'list_needs', 'search', 'read_artifact', 'record_work', 'propose_need', 'set_verdict'];
const WRITE_TOOLS = { record_work: 1, propose_need: 1, set_verdict: 1 };

function Agents() {
  const { P, t, agentLog, setAsk } = useCtx();
  const [copied, setCopied] = React.useState(null);
  const cp = (id, s) => { (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.resolve()).catch(() => {}); setCopied(id); setTimeout(() => setCopied(null), 1400); };
  return (
    <div className="page">
      <h1>{t('nav.agents')}</h1>
      <p className="muted">{t('ag.sub')}</p>
      <div className="ag-grid">
        {AGENTS.map((a) => (
          <div key={a.id} className="ag" data-agent={a.id}>
            <div className="row gap6"><span className={'ag-logo ag-' + a.id}>{a.id === 'cc' ? 'CC' : 'CX'}</span><strong className="grow">{a.name}</strong><Pill tone="green">{t('ag.on')}</Pill></div>
            <div className="row gap6"><span className="faint small">{t('ag.install')}</span><span className="grow"></span><Pill tone="amber">{t('af.mock')}</Pill>
              <button className="link" onClick={() => cp(a.id, a.snippet(P.id))}>{copied === a.id ? '✓ ' + t('cp.copied') : t('ag.copy')}</button></div>
            <pre className="snip">{a.snippet(P.id)}</pre>
            <div className="row gap6"><span className="faint small">{t('ag.perm')}</span><Pill tone="blue">✓ {t('ag.read')}</Pill><Pill tone="violet">✓ {t('ag.suggest')}</Pill></div>
          </div>
        ))}
      </div>
      <h3 className="h3">{t('ag.tools')}</h3>
      <div className="tools">{TOOLS.map((k) => <div key={k} className="tool"><span className="mono">{k}</span><span className="small muted">{t('t.' + k)}</span>{WRITE_TOOLS[k] && <Pill tone="violet">{t('ag.pending')}</Pill>}</div>)}</div>
      <h3 className="h3">{t('ag.log')}</h3>
      <div className="tools">
        {agentLog.map((l, i) => (
          <div key={i} className="tool">
            <span className={'ag-logo sm ag-' + l.agent}>{l.agent === 'cc' ? 'CC' : 'CX'}</span>
            <span className="mono">{l.tool}</span><span className="small muted grow">{l.arg}</span><span className="small faint">{l.date.slice(5)}</span>
            {l.pending && <button className="btn btn-sm btn-primary" onClick={() => setAsk(true)}>{t('ag.pending')}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { CopyModal, Agents, buildContext });
