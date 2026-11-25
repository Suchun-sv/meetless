// v3 app shell: cross-project home dashboard, project tree with per-project dashboard, project-agent composer,
// handoffs, privacy.
const clone = (x) => JSON.parse(JSON.stringify(x || []));
const T2 = (key, vars) => ({ 'zh-CN': window.NeedsI18n.t('zh-CN', key, vars), en: window.NeedsI18n.t('en', key, vars) });
const T2w = (key, w) => ({ 'zh-CN': window.NeedsI18n.t('zh-CN', key, { name: window.NeedsI18n.t('zh-CN', 'w.' + w) }), en: window.NeedsI18n.t('en', key, { name: window.NeedsI18n.t('en', 'w.' + w) }) });
const ctxVer = (n) => 1 + ((n && n.revisions) || []).length;

function initState(P) {
  const X = (window.NeedsExtra || {})[P.id] || {};
  const C = (window.NeedsCollab || {})[P.id] || {};
  const needs = clone(P.needs).concat(clone(C.needs));
  needs.forEach((n) => { if (C.owners && C.owners[n.id]) n.owner = C.owners[n.id]; });
  return { needs, work: clone(P.work).concat(clone(X.work), clone(C.work)), inputs: clone(X.inputs), handoffs: clone(C.handoffs), answered: {} };
}
const nextId = (needs, prefix) => prefix + (Math.max(0, ...needs.filter((n) => n.id[0] === prefix).map((n) => parseInt(n.id.slice(1), 10) || 0)) + 1);
const curRound = (P) => (P.rounds.find((r) => r.status === 'current') || P.rounds[0]);

function applyOp(st, op, label, P) {
  let needs = st.needs.map((n) => Object.assign({}, n));
  const work = st.work.map((w) => Object.assign({}, w));
  let handoffs = st.handoffs.slice();
  const N = (id) => needs.find((n) => n.id === id);
  const W = (id) => work.find((w) => w.id === id);
  if (op.work && W(op.work)) { const w = W(op.work); w.answered = true; w.why = T2('ask.yourAnswer', { a: label[window.__lang] || label.en }); }
  if (op.type === 'confirm') { const n = N(op.need); if (n) n.confirmed = true; }
  if (op.type === 'move') { const n = N(op.need); if (n) { n.round = op.round; n.confirmed = true; if (n.status === 'parked') n.status = 'untested'; } }
  if (op.type === 'drop') { const n = N(op.need); if (n) { n.status = 'dropped'; n.confirmed = true; } }
  if (op.type === 'link') Object.assign(W(op.work), { need: op.need, ef: op.ef, also: op.also || null, conf: 'h' });
  if (op.type === 'ignore') W(op.work).ignored = true;
  if (op.type === 'newHyp') {
    const w = W(op.work);
    needs.push({ id: op.id, kind: 'hyp', round: op.round, status: 'testing', title: op.title, expect: op.expect, verify: op.verify, confirmed: true, isNew: true, by: 'me', owner: 'me',
      source: { src: w.src, date: w.date, quote: w.text, ref: { 'zh-CN': '代码库', en: 'Code repo' } }, conf: { source: 'h', round: 'h', status: 'h' } });
    Object.assign(w, { need: op.id, ef: 'spawn', conf: 'h' });
  }
  if (op.type === 'revise') { const n = N(op.need); n.revisions = (n.revisions || []).concat([{ date: P.today, text: op.text, why: op.why, conf: 'h' }]); n.accept = op.text; }
  if (op.type === 'newNeed') needs.push({ id: nextId(needs, 'N'), kind: 'ext', round: op.round, status: 'todo', by: op.by, title: op.title, accept: op.title, isNew: true, confirmed: true,
    source: { src: 'file', date: P.today, quote: op.title, ref: op.title }, conf: { source: 'h', round: 'h', status: 'h' } });
  if (op.type === 'handoff') { handoffs = handoffs.concat([{ id: 'HO' + (handoffs.length + 1), need: op.need, from: 'me', to: op.to, state: 'sent', date: P.today, due: curRound(P).due, ask: op.ask }]); N(op.need).owner = op.to; }
  return Object.assign({}, st, { needs, work, handoffs });
}

function applyExtract(st, P, inputId, xid, act) {
  const inputs = st.inputs.map((i) => (i.id === inputId ? Object.assign({}, i, { extracts: i.extracts.map((x) => Object.assign({}, x)) }) : i));
  const inp = inputs.find((i) => i.id === inputId);
  const x = inp.extracts.find((e) => e.id === xid);
  let needs = st.needs, work = st.work;
  x.state = act === 'accept' ? 'accepted' : 'ignored';
  if (act === 'accept') {
    const para = inp.body.find((b) => b.x === xid);
    const src = inp.kind === 'md' ? 'meeting' : 'file';
    const source = { src, date: inp.date, quote: para ? para.p : x.text, ref: inp.title };
    needs = needs.map((n) => Object.assign({}, n));
    if (x.type === 'new' || x.type === 'hyp') {
      const id = nextId(needs, x.type === 'hyp' ? 'H' : 'N');
      const n = { id, kind: x.type === 'hyp' ? 'hyp' : 'ext', round: curRound(P).n, status: x.type === 'hyp' ? 'untested' : 'todo', title: x.text, source, confirmed: true, isNew: true, private: !!inp.private,
        conf: { source: 'h', round: 'h', status: 'h' } };
      if (x.type === 'hyp') Object.assign(n, { expect: x.expect || x.text, verify: x.verify || x.text, by: 'me' });
      else Object.assign(n, { by: P.people[inp.from] ? inp.from : null, accept: x.accept || x.text });
      needs.push(n);
      x.need = id;
    }
    if (x.type === 'rev' && x.need) needs = needs.map((n) => (n.id === x.need ? Object.assign({}, n, { revisions: (n.revisions || []).concat([{ date: inp.date, text: x.text, why: inp.title, conf: 'h' }]) }) : n));
    if (x.need) work = work.concat([{ id: 'w-' + inputId + xid, src, date: inp.date, text: inp.title, need: x.need, ef: x.type === 'rev' ? 'revise' : x.type === 'hyp' ? 'spawn' : 'extract', why: x.text, conf: 'h', answered: true }]);
  }
  if (!inp.extracts.some((e) => !e.state)) inp.status = 'done';
  return Object.assign({}, st, { inputs, needs, work });
}

function App() {
  const projects = window.NeedsProjects;
  const [lang, setLangRaw] = React.useState(() => localStorage.getItem('meetless.needs.lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'));
  window.__lang = lang;
  const setLang = (l) => { localStorage.setItem('meetless.needs.lang', l); setLangRaw(l); };
  const [pid, setPid] = React.useState(projects[0].id);
  const [states, setStates] = React.useState(() => Object.fromEntries(projects.map((p) => [p.id, initState(p)])));
  const [view, setViewRaw] = React.useState('home');
  const [mode, setMode] = React.useState('rounds');
  const [kindFilter, setKindFilter] = React.useState(null);
  const [roundFilter, setRoundFilter] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);
  const [ask, setAsk] = React.useState(false);
  const [link, setLink] = React.useState(null);
  const [handoffNeed, setHandoffFor] = React.useState(null);
  const [selInput, setSelInput] = React.useState(null);
  const [selArtifact, setSelArtifact] = React.useState(null);
  const [threads, setThreads] = React.useState({});
  const [priv, setPrivMap] = React.useState({});
  const [dash, setDash] = React.useState(() => Object.assign({ home: H_DEFAULT.slice() }, Object.fromEntries(projects.map((p) => [p.id, P_DEFAULT.slice()]))));
  const [stamps, setStamps] = React.useState({});
  const t0 = React.useRef(Date.now() - 4 * 60000);
  const composerRef = React.useRef(null);
  const P = projects.find((p) => p.id === pid);
  const X = (window.NeedsExtra || {})[pid] || {};
  const C = (window.NeedsCollab || {})[pid] || {};
  const S = states[pid];
  React.useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const t = (k, v) => window.NeedsI18n.t(lang, k, v);
  const L = (c) => (c ? (typeof c === 'string' ? c : c[lang] || c.en) : '');
  const dfmt = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmt = (d) => dfmt.format(new Date(ms(d)));
  const go = (p, v, need) => { setPid(p); setViewRaw(v); setOpenId(need || null); setRoundFilter(null); if (p !== pid) { setSelInput(null); setSelArtifact(null); } };
  const setView = (v) => go(pid, v);
  const putFor = (p, fn) => setStates((all) => Object.assign({}, all, { [p]: fn(all[p]) }));
  const put = (fn) => putFor(pid, fn);
  const qsOf = (p) => (p.questions || []).concat(((window.NeedsExtra || {})[p.id] || {}).questions || [], ((window.NeedsCollab || {})[p.id] || {}).questions || []);
  const questions = qsOf(P);
  const needById = (id) => S.needs.find((n) => n.id === id);
  const workFor = (id) => S.work.filter((w) => !w.ignored && (w.need === id || w.also === id));
  const pendingAsk = (n) => questions.some((q) => !S.answered[q.id] && q.options.some((o) => o.op.need === n.id && o.op.type !== 'link'));
  const handoffFor = (id) => S.handoffs.filter((h) => h.need === id && h.state !== 'declined').slice(-1)[0];
  const setHandoffIn = (p, id, patch) => putFor(p, (st) => {
    const hs = st.handoffs.map((h) => (h.id === id ? Object.assign({}, h, patch) : h));
    const h = hs.find((x) => x.id === id);
    const needs = patch.state === 'accepted' && h.to === 'me' ? st.needs.map((n) => (n.id === h.need ? Object.assign({}, n, { owner: 'me' }) : n)) : st.needs;
    return Object.assign({}, st, { handoffs: hs, needs });
  });
  const setHandoff = (id, patch) => setHandoffIn(pid, id, patch);
  const addHandoff = ({ need, to, ask: a, due }) => put((st) => Object.assign({}, st, {
    handoffs: st.handoffs.concat([{ id: 'HO' + (st.handoffs.length + 1), need, from: 'me', to, state: 'sent', date: P.today, due, ask: { 'zh-CN': a, en: a } }]),
    needs: st.needs.map((n) => (n.id === need ? Object.assign({}, n, { owner: to }) : n)) }));
  const answer = (q, o) => put((st) => { const n = applyOp(st, o.op, o.label, P); n.answered = Object.assign({}, st.answered, { [q.id]: o }); return n; });
  const setNeed = (id, patch) => put((st) => Object.assign({}, st, { needs: st.needs.map((n) => (n.id === id ? Object.assign({}, n, patch) : n)) }));
  const capture = (id) => put((st) => Object.assign({}, st, { work: st.work.concat([{ id: 'cap' + st.work.length, src: 'commit', capture: true, date: P.today, text: T2('cap.text'), need: id }]) }));
  const publish = (id) => setNeed(id, { private: false });
  const extractAct = (iid, xid, act) => put((st) => applyExtract(st, P, iid, xid, act));
  const addInput = (name, kind, text, isPriv) => {
    const id = 'IN' + (S.inputs.length + 1 + Math.floor(Math.random() * 90 + 10));
    put((st) => Object.assign({}, st, { inputs: [Object.assign(makeInput(id, kind, name, text, P.today), { private: !!isPriv })].concat(st.inputs) }));
    setSelInput(id);
    setTimeout(() => put((st) => Object.assign({}, st, { inputs: st.inputs.map((i) => (i.id === id ? Object.assign({}, i, { parsing: false }) : i)) })), 1100);
  };
  const roundOf = (n) => P.rounds.find((r) => r.n === n) || P.rounds[0];
  const openArtifact = (id) => { setSelArtifact(id); go(pid, 'artifacts'); };
  const artifacts = X.artifacts || [];
  const agentLog = X.agentLog || [];
  const membersOf = (p) => { const r = ((window.NeedsCollab || {})[p] || {}).roles || []; return r.reduce((a, x) => a.concat(x.members), []); };
  const nameOf = (p, k) => L(p.people[k]).split(/[（(]/)[0];

  // ---- cross-project aggregates
  const homeItems = { confirm: [], toMe: [], byMe: [], due: [] };
  projects.forEach((p) => {
    const st = states[p.id];
    qsOf(p).filter((q) => !st.answered[q.id]).forEach((q) => homeItems.confirm.push({ p, q }));
    st.handoffs.forEach((h) => {
      const n = st.needs.find((x) => x.id === h.need);
      if (h.to === 'me' && h.state !== 'declined') homeItems.toMe.push({ p, h, n });
      if (h.from === 'me') {
        const v = ctxVer(n);
        const last = st.work.filter((w) => w.need === n.id && w.by === h.to).slice(-1)[0];
        homeItems.byMe.push({ p, h, n, stale: h.fetched && h.fetched.v < v && !h.reminded ? v : null, last });
      }
    });
    const r = curRound(p);
    homeItems.due.push({ p, r, left: Math.round((ms(r.due) - ms(p.today)) / DAY) });
  });
  homeItems.due.sort((a, b) => a.left - b.left);
  const badge = (p) => {
    const st = states[p];
    const proj = projects.find((x) => x.id === p);
    const q = qsOf(proj).filter((x) => !st.answered[x.id]).length;
    const inp = st.inputs.filter((i) => i.status === 'pending').length;
    const toMe = st.handoffs.filter((h) => h.to === 'me' && h.state === 'sent').length;
    return { total: q + inp + toMe, inputs: inp, board: toMe + q };
  };
  const homeCount = homeItems.confirm.length + homeItems.toMe.filter((x) => x.h.state === 'sent').length;

  // ---- dashboards (agent-generated cards)
  const scope = view === 'home' ? 'home' : pid;
  const onDash = view === 'home' || view === 'dash';
  const pool = view === 'home' ? H_WIDGETS : P_WIDGETS;
  const stampOf = (sc, id) => stamps[sc + ':' + id] || t0.current;
  const touch = (sc, id) => setStamps((s) => Object.assign({}, s, { [sc + ':' + id]: Date.now() }));
  const addWidget = (sc, w) => {
    const has = (dash[sc] || []).indexOf(w) >= 0;
    if (!has) setDash((d) => Object.assign({}, d, { [sc]: (d[sc] || []).concat([w]) }));
    touch(sc, w);
    return { text: T2w(has ? 'db.exists' : 'db.added', w) };
  };
  const removeWidget = (sc, w) => setDash((d) => Object.assign({}, d, { [sc]: (d[sc] || []).filter((x) => x !== w) }));

  // ---- project agent: suggestions and replies (simulated)
  const say = (sc, user, reply) => setThreads((all) => Object.assign({}, all, { [sc]: (all[sc] || []).concat([{ role: 'user', text: user }, Object.assign({ role: 'agent' }, reply)]) }));
  const remind = (p, h) => { setHandoffIn(p.id, h.id, { reminded: true }); return { text: T2('ch.reminded', { who: nameOf(p, h.to), need: h.need }) }; };
  const projectSuggestions = (p) => {
    const st = states[p.id];
    const out = [];
    st.handoffs.forEach((h) => {
      const n = st.needs.find((x) => x.id === h.need);
      if (h.from === 'me' && h.fetched && h.fetched.v < ctxVer(n) && !h.reminded) out.push({ id: 'st-' + p.id + h.id, hot: true, text: T2('sg.stale', { need: h.need, who: nameOf(p, h.to) }), run: () => remind(p, h) });
      if (h.to === 'me' && h.state === 'sent') out.push({ id: 'tm-' + p.id + h.id, hot: true, text: T2('sg.toMe', { who: nameOf(p, h.from) }), run: () => { go(p.id, 'board', h.need); return null; } });
    });
    const cf = qsOf(p).filter((q) => q.conflict && !st.answered[q.id]).length;
    if (cf) out.push({ id: 'cf-' + p.id, hot: true, text: T2('sg.conflict', { n: cf }), run: () => { setPid(p.id); setAsk(true); return null; } });
    return out;
  };
  const addChips = onDash ? Object.keys(pool).filter((w) => (dash[scope] || []).indexOf(w) < 0).map((w) => ({ id: 'add-' + w, text: T2w('db.add', w), run: () => addWidget(scope, w) })) : [];
  const suggestions = view === 'home'
    ? projects.reduce((a, p) => a.concat(projectSuggestions(p)), []).slice(0, 2).concat(addChips, ((window.NeedsCollab || {}).home || {}).suggestions || [])
    : onDash ? projectSuggestions(P).slice(0, 2).concat(addChips) : projectSuggestions(P).concat(C.suggestions || []);
  const onChip = (s) => {
    const label = L(s.text);
    if (s.run) { const r = s.run(); if (r) say(scope, label, r); return; }
    const ans = (scope === 'home' ? ((window.NeedsCollab || {}).home || {}).answers : C.answers) || {};
    say(scope, label, ans[s.id] || { text: scope === 'home' ? window.NeedsCollab.home.summary : C.summary });
  };
  const sendFile = (f) => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const kind = ext === 'pdf' ? 'pdf' : ext === 'docx' || ext === 'doc' ? 'docx' : ext === 'md' ? 'md' : 'txt';
    if (kind === 'txt' || kind === 'md') { const r = new FileReader(); r.onload = () => addInput(f.name, kind, String(r.result), priv[pid]); r.readAsText(f); } else addInput(f.name, kind, '', priv[pid]);
    go(pid, 'inputs');
  };
  const onSend = (text) => {
    if (onDash) {
      const hit = W_KEYWORDS.find(([w, re]) => pool[w] && re.test(text));
      if (hit) { say(scope, text, addWidget(scope, hit[0])); return; }
    }
    const looksInput = /\n/.test(text.trim()) || text.trim().length > 80;
    if (view !== 'home' && looksInput) {
      const isPriv = priv[pid];
      say(scope, text, { text: T2('ch.asInput'), actions: [{ label: t('ch.import'), run: () => { addInput(text.trim().split('\n')[0].replace(/^[#>*\-\s]+/, '').slice(0, 24) + '.md', 'md', text, isPriv); go(pid, 'inputs'); } }] });
      return;
    }
    if (view === 'home') { const H = window.NeedsCollab.home; say('home', text, /先|first|今天|today|等我|waiting/i.test(text) ? H.answers.h1 : /截止|deadline|due/i.test(text) ? H.answers.h2 : { text: H.summary }); return; }
    const hit = (C.faq || []).find((f) => new RegExp(f.kw, 'i').test(text));
    say(scope, text, hit ? { text: hit.text, cites: hit.cites } : { text: C.summary });
  };
  const composer = (inline) => (
    <Composer scope={scope} suggestions={suggestions} msgs={threads[scope]} inline={inline} inputRef={composerRef}
      onSend={onSend} onChip={onChip} onFile={sendFile} onCloseThread={() => setThreads((all) => Object.assign({}, all, { [scope]: [] }))}
      priv={view !== 'home' && !!priv[pid]} setPriv={view !== 'home' ? (v) => setPrivMap((m) => Object.assign({}, m, { [pid]: v })) : null} />
  );

  const ctx = { P, L, t, lang, fmt, needs: S.needs, work: S.work, inputs: S.inputs, answered: S.answered, questions, needById, workFor, pendingAsk, answer, setNeed, roundOf,
    openId, openNeed: setOpenId, roundFilter, setRoundFilter, setAsk, link, setLink, setCopy: setLink, selInput, setSelInput, extractAct, addInput: (a, b, c) => addInput(a, b, c, false),
    artifacts, selArtifact, setSelArtifact, openArtifact, agentLog, handoffFor, setHandoff, addHandoff, handoffNeed, setHandoffFor, ctxVer, capture, publish,
    roles: C.roles || [], goNeed: (id) => go(pid, 'board', id), goView: (v) => go(pid, v) };
  const drawer = openId && (view === 'board' || view === 'stream' || view === 'deliveries');
  const onNew = () => { if (view === 'home' || view === 'agents') setViewRaw('dash'); setOpenId(null); setTimeout(() => composerRef.current && composerRef.current.focus(), 60); };
  const openCount = questions.filter((q) => !S.answered[q.id]).length;
  const project = view !== 'home' && view !== 'agents';
  const homeAct = (p, hid, patch, needLink) => { if (patch) setHandoffIn(p, hid, patch); if (needLink) { setPid(p); setLink({ need: needLink }); } };
  const total = homeItems.confirm.length + homeItems.toMe.filter((x) => x.h.state === 'sent').length;

  return (
    <Ctx.Provider value={ctx}>
      <div className={'app' + (drawer ? ' with-drawer' : '')} data-screen-label="Needs prototype v3">
        <Sidebar projects={projects} pid={pid} view={view} go={go} lang={lang} setLang={setLang} badge={badge} homeCount={homeCount} onNew={onNew} members={membersOf} />
        <main className="main">
          <div className="top">
            <div className="crumb3">
              {project ? <React.Fragment><span className="crumb-p">{P.name[lang]}</span><span className="faint">/ {t('nav.' + view)}</span>
                <span className="avs">{membersOf(pid).map((m) => <Avatar key={m} who={m} P={P} size="sm" />)}</span></React.Fragment>
                : <span className="crumb-p">{t('nav.' + view)}</span>}
            </div>
            {project && <button className={'ask-btn' + (openCount ? ' has' : '')} onClick={() => setAsk(true)} data-ask="open">{t('ask.btn')}{openCount > 0 && <span className="count">{openCount}</span>}</button>}
          </div>
          <div className={'scroll v-' + view}>
            {view === 'home' && (
              <Dashboard home ids={dash.home} stamps={Object.fromEntries(dash.home.map((id) => [id, stampOf('home', id)]))} onRefresh={(id) => touch('home', id)} onRemove={(id) => removeWidget('home', id)}
                hero={<div className="home-hero2"><h1>{t('home.hi', { n: total })}</h1><div className="muted">{t('home.sub', { p: projects.length })}</div>{composer(true)}</div>}
                render={(id) => <HomeWidget id={id} items={homeItems} projects={projects} states={states} go={go} openAsk={(p) => { setPid(p); setAsk(true); }} act={homeAct} qsOf={qsOf} />} />
            )}
            {view === 'dash' && (
              <Dashboard ids={dash[pid]} stamps={Object.fromEntries(dash[pid].map((id) => [id, stampOf(pid, id)]))} onRefresh={(id) => touch(pid, id)} onRemove={(id) => removeWidget(pid, id)}
                render={(id) => <ProjectWidget id={id} st={S} />} composer={composer(false)} />
            )}
            {view === 'board' && (
              <div className="board-v">
                <Timeline />
                <div className="bar">
                  <div className="seg">{['rounds', 'lineage'].map((m) => <button key={m} className={mode === m ? 'on' : ''} data-mode={m} onClick={() => setMode(m)}>{t('view.' + m)}</button>)}</div>
                  <div className="row gap6 wrap">
                    {[[null, 'filter.all'], ['ext', 'filter.ext'], ['hyp', 'filter.hyp']].map(([k, key]) => <button key={key} className={'chip' + (kindFilter === k ? ' on' : '')} onClick={() => setKindFilter(k)}>{k && <KindMark kind={k} />}{t(key)}</button>)}
                    {roundFilter && <button className="chip on" onClick={() => setRoundFilter(null)}>{t('round', { n: roundFilter })} ×</button>}
                  </div>
                </div>
                {mode === 'rounds' ? <Board kindFilter={kindFilter} /> : <Lineage />}
                {composer(false)}
              </div>
            )}
            {view === 'inputs' && <div className="withc"><div className="withc-b"><Inputs /></div>{composer(false)}</div>}
            {view === 'artifacts' && <div className="withc"><div className="withc-b"><Artifacts /></div>{composer(false)}</div>}
            {view === 'stream' && <div className="board-v"><Stream />{composer(false)}</div>}
            {view === 'deliveries' && <div className="board-v"><Deliveries />{composer(false)}</div>}
            {view === 'agents' && <Agents />}
          </div>
        </main>
        {drawer && <Drawer />}
        {ask && <AskPanel />}
        {link && <LinkModal />}
        {handoffNeed && <HandoffModal />}
      </div>
    </Ctx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
