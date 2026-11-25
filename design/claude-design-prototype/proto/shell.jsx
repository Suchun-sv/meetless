// Sidebar (ChatGPT-desktop-like) and the draggable project timeline.
const PROJECT_VIEWS = ['overview', 'requirements', 'changes', 'meetings', 'deliveries'];

function Sidebar({ view, setView, user, setLang, onDual, dual }) {
  const { t, lang } = useClient();
  const M = window.MeetlessMock;
  const [menu, setMenu] = React.useState(false);
  const inboxCount = (window.INBOX || []).filter((i) => i.who === user).length;
  const item = (id, key, extra) => (
    <div className={'nav-item' + (view === id ? ' on' : '')} data-nav={id} onClick={() => setView(id)}>
      <span className="nav-txt">{t(key)}</span>{extra}
    </div>
  );
  return (
    <aside className="side">
      <div className="side-top">
        <div className="brand"><span className="brand-mark"></span>Meetless</div>
        <span className="sample" title={t('app.sampleTip')}>{t('app.sample')}</span>
      </div>
      <button className="new-btn" title={t('app.sampleTip')}>+ {t('nav.newChange')}</button>
      {item('inbox', 'nav.inbox', inboxCount > 0 && <span className="count">{inboxCount}</span>)}
      <div className="side-label">{t('nav.projects')}</div>
      <div className="proj on">{txs(M.project.name, lang)}</div>
      <div className="proj-sub">
        {PROJECT_VIEWS.map((v) => <div key={v} className={'nav-item sub' + (view === v ? ' on' : '')} data-nav={v} onClick={() => setView(v)}><span className="nav-txt">{t('nav.' + v)}</span></div>)}
      </div>
      {M.otherProjects.map((p, i) => <div key={i} className="proj">{txs(p, lang)}</div>)}
      <div className="side-label"> </div>
      {item('roles', 'nav.roles')}
      {item('skills', 'nav.skills')}
      <div className="grow"></div>
      {!dual && <div className="nav-item demo" data-nav="dual" onClick={onDual}><span className="nav-txt">{t('nav.dual')}</span></div>}
      <div className="sync"><span className="dot-ok"></span>{t('sync.ok')} · {t('sync.last', { t: '10:42' })}</div>
      <div className="user" onClick={() => setMenu(!menu)}>
        <Avatar id={user} size={28} />
        <div className="user-txt"><div className="user-n">{M.people[user].name}</div><div className="user-r">{M.people[user].roles.map((r) => txs(M.roles[r], lang)).join(' · ')}</div></div>
      </div>
      {menu && (
        <div className="menu" onMouseLeave={() => setMenu(false)}>
          <div className="menu-l">{t('user.lang')}</div>
          {window.MeetlessI18n.supported.map((l) => (
            <div key={l} className={'menu-i' + (l === lang ? ' on' : '')} data-lang={l} onClick={() => { setLang(l); setMenu(false); }}>
              {l === 'zh-CN' ? '简体中文' : 'English'}{l === lang ? '  ✓' : ''}
            </div>
          ))}
          <div className="menu-sep"></div>
          <div className="menu-l">{t('user.tz')}: Europe/London</div>
          <div className="menu-i" title={t('app.sampleTip')}>{t('user.signout')}</div>
        </div>
      )}
    </aside>
  );
}

const TL_START = Date.parse('2026-11-02T00:00:00Z');
const TL_END = Date.parse('2026-11-24T12:00:00Z');
const MAJOR = { project: 1, requirement: 1, publish: 1, review: 1, decision: 1, baseline: 1, delivery: 1, meeting: 1 };
const FILTERS = { all: null, versions: ['publish', 'agent', 'stale', 'skill'], reviews: ['review', 'approve', 'baseline'], meetings: ['meeting', 'decision', 'import'], delivery: ['delivery', 'accept'] };
const FILTER_KEYS = { all: 'tl.all', versions: 'ev.publish', reviews: 'ev.review', meetings: 'ev.meeting', delivery: 'ev.delivery' };

function Timeline({ T, setT }) {
  const { t, fmt, day, lang, tzName, cut, isHistory, compact } = useClient();
  const M = window.MeetlessMock;
  const ref = React.useRef(null);
  const [filter, setFilter] = React.useState('all');
  const [hover, setHover] = React.useState(null);
  const pos = (ms) => ((ms - TL_START) / (TL_END - TL_START)) * 100;
  const fromX = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return TL_START + f * (TL_END - TL_START);
  };
  const onDown = (e) => {
    setT(fromX(e.clientX));
    const move = (ev) => setT(fromX(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const shown = M.events.filter((e) => !FILTERS[filter] || FILTERS[filter].indexOf(e.type) >= 0);
  const days = [];
  for (let d = TL_START; d <= TL_END; d += (compact ? 4 : 2) * 86400000) days.push(d);
  const late = M.events.find((e) => e.occurredAt);
  const cur = M.events.filter((e) => e.seq === cut)[0];
  return (
    <div className={'tl' + (isHistory ? ' tl-hist' : '')}>
      <div className="tl-head">
        <div className="tl-view">
          <span className="muted">{t('tl.viewing')}</span>
          <strong>{isHistory ? fmt(new Date(T).toISOString()) : t('tl.now')}</strong>
          <span className="muted">{tzName}</span>
          {cur && <span className="muted small">· {t('tl.seq', { n: cut })}</span>}
        </div>
        <div className="tl-tools">
          {Object.keys(FILTERS).map((f) => <button key={f} className={'chip' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>{t(FILTER_KEYS[f])}</button>)}
          {isHistory && <Btn kind="primary" onClick={() => setT(TL_END)}>{t('tl.back')}</Btn>}
        </div>
      </div>
      <div className="tl-track-wrap" ref={ref} onPointerDown={onDown} title={t('tl.drag')}>
        <div className="tl-track"></div>
        <div className="tl-past" style={{ width: pos(T) + '%' }}></div>
        {days.map((d) => <div key={d} className="tl-day" style={{ left: pos(d) + '%' }}>{day(new Date(d).toISOString())}</div>)}
        {late && cut >= late.seq && <div className="tl-ghost" style={{ left: pos(Date.parse(late.occurredAt)) + '%' }} title={t('mt.held', { t: fmt(late.occurredAt) })}></div>}
        {shown.map((e) => {
          const x = pos(Date.parse(e.at));
          const future = e.seq > cut;
          return (
            <div key={e.seq} className={'tl-ev ev-' + e.type + (MAJOR[e.type] ? ' major' : '') + (future ? ' future' : '')} style={{ left: x + '%' }}
              onPointerDown={(ev) => { ev.stopPropagation(); setT(Date.parse(e.at) + 60000); }}
              onMouseEnter={() => setHover(e.seq)} onMouseLeave={() => setHover(null)}>
              {hover === e.seq && (
                <div className="tl-tip">
                  <div className="tl-tip-t">{t('ev.' + e.type)} · {fmt(e.at)}</div>
                  <div>{txs(e.label, lang)}</div>
                  {e.occurredAt && <div className="muted">{t('mt.held', { t: fmt(e.occurredAt) })} · {t('mt.recorded', { t: fmt(e.at) })}</div>}
                  <div className="muted">{t('tl.seq', { n: e.seq })}</div>
                </div>
              )}
            </div>
          );
        })}
        <div className="tl-handle" style={{ left: pos(T) + '%' }}><span></span></div>
      </div>
      <div className="tl-lanes">
        {['requirement', 'publish', 'meeting', 'baseline', 'delivery'].map((k) => {
          const e = M.events.filter((x) => x.type === k && x.seq <= cut).pop();
          return <div key={k} className="lane"><span className={'lane-dot ev-' + k}></span><span className="muted">{t('ev.' + k)}</span> {e ? <span className="lane-v">{txs(e.label, lang)}</span> : <span className="faint">{t('ws.none')}</span>}</div>;
        })}
      </div>
      {isHistory && <div className="hist-banner"><strong>{t('tl.history')}</strong><span>{t('tl.historyNote')}</span><Btn kind="ghost" title={t('app.sampleTip')}>{t('act.fromHistory')}</Btn></div>}
    </div>
  );
}

Object.assign(window, { Sidebar, Timeline, PROJECT_VIEWS, TL_START, TL_END });
