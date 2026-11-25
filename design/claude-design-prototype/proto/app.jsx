// One Meetless client instance (own user, language, cut-off, view) + the two-client demo wrapper.
function cutFor(T) {
  const evs = window.MeetlessMock.events.filter((e) => Date.parse(e.at) <= T);
  return evs.length ? evs[evs.length - 1].seq : 0;
}
function initialLang(user) {
  const saved = localStorage.getItem('meetless.proto.lang.' + user);
  if (saved && window.MeetlessI18n.supported.indexOf(saved) >= 0) return saved;
  const pref = window.MeetlessMock.people[user].lang;
  return pref || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
}

function Client({ user, dual, onDual }) {
  const M = window.MeetlessMock;
  const [lang, setLangRaw] = React.useState(() => initialLang(user));
  const setLang = (l) => { localStorage.setItem('meetless.proto.lang.' + user, l); setLangRaw(l); };
  const [T, setT] = React.useState(TL_END);
  const [view, setView] = React.useState('overview');
  const [panel, setPanel] = React.useState(!dual);
  const cut = cutFor(T);
  const S = React.useMemo(() => M.stateAt(cut), [cut]);
  const lastSeq = M.events[M.events.length - 1].seq;
  const isHistory = cut < lastSeq || T < TL_END - 3600000;
  const api = React.useMemo(() => makeClientApi(lang, M.project.tz), [lang]);
  const ctx = Object.assign({}, api, { S, cut, isHistory, user, compact: !!dual });
  const projectView = PROJECT_VIEWS.indexOf(view) >= 0;
  React.useEffect(() => { if (!dual) document.documentElement.lang = lang; }, [lang, dual]);

  let page = null;
  if (view === 'overview') page = <Overview />;
  else if (view === 'changes') page = <ChangeView />;
  else if (view === 'requirements') page = <RequirementsView />;
  else if (view === 'meetings') page = <MeetingsView />;
  else if (view === 'deliveries') page = <DeliveriesView />;
  else if (view === 'inbox') page = <InboxView user={user} />;
  else if (view === 'skills') page = <SkillsView />;
  else if (view === 'roles') page = <RolesView />;

  return (
    <ClientCtx.Provider value={ctx}>
      <div className={'client' + (dual ? ' compact' : '')} lang={lang} data-user={user}>
        <Sidebar view={view} setView={setView} user={user} setLang={setLang} onDual={onDual} dual={dual} />
        <main className="main">
          <div className="topbar">
            <div className="crumb">
              {projectView ? <span>{txs(M.project.name, lang)}</span> : <span>{api.t('nav.' + view)}</span>}
              {projectView && view !== 'overview' && <span className="muted"> / {api.t('nav.' + view)}</span>}
              {projectView && S.status && <Badge tone={STATUS_TONE[S.status]}>C-24 · {api.t('cs.' + S.status)}</Badge>}
            </div>
            <div className="row gap8">
              {projectView && <button className={'chip' + (panel ? ' on' : '')} onClick={() => setPanel(!panel)}>{api.t('ctx.tab')} / {api.t('rev.tab')}</button>}
            </div>
          </div>
          {projectView && <Timeline T={T} setT={setT} />}
          <div className={'body' + (projectView && panel ? ' with-panel' : '')}>
            <div className="content">{page}</div>
            {projectView && panel && <RightPanel />}
          </div>
        </main>
      </div>
    </ClientCtx.Provider>
  );
}

function App() {
  const [dual, setDual] = React.useState(() => location.hash === '#dual');
  React.useEffect(() => { history.replaceState(null, '', dual ? '#dual' : '#'); }, [dual]);
  if (!dual) return <div className="app" data-screen-label="Client"><Client user="lin" onDual={() => setDual(true)} /></div>;
  const t = (k) => window.MeetlessI18n.translate(localStorage.getItem('meetless.proto.lang.lin') || 'zh-CN', k);
  return (
    <div className="app dual" data-screen-label="Two clients">
      <div className="dual-bar">
        <strong>{t('dual.title')}</strong><span className="muted">{t('dual.note')}</span>
        <button className="btn btn-ghost" onClick={() => setDual(false)}>{t('dual.exit')}</button>
      </div>
      <div className="dual-grid">
        <div className="dual-cell"><div className="dual-tag">Client A · Lin An</div><Client user="lin" dual /></div>
        <div className="dual-cell"><div className="dual-tag">Client B · Ben Carter</div><Client user="ben" dual /></div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
