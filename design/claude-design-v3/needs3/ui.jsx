// v3 shared primitives, project-tree sidebar, timeline and document frame.
const Ctx = React.createContext(null);
const useCtx = () => React.useContext(Ctx);

const DAY = 86400000;
const ms = (d) => Date.parse(d.slice(0, 10) + 'T12:00:00Z');
// Separator between inline facts: whitespace only (no dot symbols in the UI).
const DOT = ' ';
const ST_TONE = { todo: 'gray', doing: 'blue', met: 'green', partial: 'amber', moved: 'gray', dropped: 'gray', untested: 'gray', testing: 'violet', held: 'green', refuted: 'muted', parked: 'gray' };
const EF_TONE = { done: 'green', advance: 'blue', revise: 'amber', spawn: 'violet', refute: 'muted', hold: 'green', extract: 'ink', move: 'amber' };
const SRC_GLYPH = { commit: '⎇', exp: '△', doc: '¶', meeting: '◎', chat: '…', mail: '@', file: '□', agent: '✦' };
const KIND_LABEL = { pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', txt: 'TXT', md: 'MD', code: 'GIT', notion: 'NOTION' };
const HUES = { me: 45, prof: 255, mia: 330, lin: 150, ruo: 190, ben: 280, zhou: 95, client: 0 };

function Pill({ tone, children, title }) {
  return <span className={'pill p-' + (tone || 'gray')} title={title}>{children}</span>;
}
function Status({ s }) {
  const { t } = useCtx();
  return <span className={'st t-' + (ST_TONE[s] || 'gray')}>{t('st.' + s)}</span>;
}
function KindMark({ kind }) {
  return <span className={'km km-' + kind} aria-hidden="true"></span>;
}
function FileKind({ kind }) {
  return <span className={'fk fk-' + kind}>{KIND_LABEL[kind] || kind}</span>;
}
function Avatar({ who, P, size }) {
  const { L } = useCtx();
  const name = P && P.people[who] ? L(P.people[who]) : who;
  const h = HUES[who] != null ? HUES[who] : 0;
  return <span className={'av' + (size === 'sm' ? ' av-sm' : '')} style={{ background: who === 'client' ? '#9a9a9a' : 'oklch(0.62 0.11 ' + h + ')' }} title={name}>{name.slice(0, 1).toUpperCase()}</span>;
}
function NeedChip({ id }) {
  const { needById, L, openNeed } = useCtx();
  const n = needById(id);
  if (!n) return <span className="mono faint">{id}</span>;
  return (
    <button className={'needchip nc-' + n.kind + (n.status === 'refuted' ? ' nc-ref' : '')} onClick={(e) => { e.stopPropagation(); openNeed(id); }}>
      <KindMark kind={n.kind} /><span className="mono faint">{n.id}</span><span className="nc-t">{L(n.title)}</span>
    </button>
  );
}
function AiMark({ conf, confirmed, onFix }) {
  const { t } = useCtx();
  if (confirmed) return <span className="ai ai-ok">{t('ai.confirmed')}</span>;
  const unsure = conf === 'l';
  return (
    <span className={'ai' + (unsure ? ' ai-l' : '')}>
      {unsure ? t('ai.unsure') : t('ai.inferred')}
      {onFix && <button className="ai-fix" onClick={onFix}>{t('ai.fix')}</button>}
    </span>
  );
}

const SECTIONS = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries'];
// Projects are the top level; the current project expands to show its sections. "Home" is cross-project.
function Sidebar({ projects, pid, view, go, lang, setLang, badge, homeCount, onNew, members }) {
  const { t, L } = useCtx();
  const P0 = projects.find((p) => p.id === pid);
  return (
    <aside className="side">
      <div className="side-top"><div className="brand"><span className="brand-mark"></span>Meetless</div></div>
      <button className="side-new" onClick={onNew} data-side="new"><span className="plus">+</span>{t('cm.new')}</button>
      <button className={'nav' + (view === 'home' ? ' on' : '')} data-nav="home" onClick={() => go(pid, 'home')}>
        <span>{t('nav.home')}</span>{homeCount > 0 && <span className="nav-n">{homeCount}</span>}
      </button>
      <div className="side-label">{t('nav.projects')}</div>
      {projects.map((p) => {
        const open = p.id === pid && view !== 'home' && view !== 'agents';
        const b = badge(p.id);
        return (
          <div key={p.id} className={'ptree' + (open ? ' open' : '')}>
            <button className={'nav prow' + (open ? ' cur' : '')} data-project={p.id} onClick={() => go(p.id, 'dash')}>
              <span className="caret">{open ? '▾' : '▸'}</span>
              <span className="proj-n grow">{p.name[lang]}</span>
              {!open && b.total > 0 && <span className="nav-n soft">{b.total}</span>}
            </button>
            {open && (
              <div className="psub">
                <div className="pmembers">{members(p.id).map((m) => <Avatar key={m} who={m} P={p} size="sm" />)}</div>
                {SECTIONS.map((s) => (
                  <button key={s} className={'nav sub' + (view === s ? ' on' : '')} data-nav={s} onClick={() => go(p.id, s)}>
                    <span>{t('nav.' + s)}</span>{b[s] > 0 && <span className="nav-n soft">{b[s]}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="grow"></div>
      <button className={'nav' + (view === 'agents' ? ' on' : '')} data-nav="agents" onClick={() => go(pid, 'agents')}><span>{t('nav.agents')}</span></button>
      <div className="side-user">
        <span className="av" style={{ background: 'oklch(0.62 0.11 45)' }}>{L(P0.people.me).slice(0, 1).toUpperCase()}</span>
        <div className="grow"><div className="side-user-n">{L(P0.people.me)}</div><div className="side-user-s" title={t('app.sampleTip')}>{t('app.sample')}</div></div>
        <div className="seg seg-xs">
          {window.NeedsI18n.supported.map((l) => (
            <button key={l} className={l === lang ? 'on' : ''} data-lang={l} onClick={() => setLang(l)}>{l === 'zh-CN' ? '中' : 'EN'}</button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Timeline() {
  const { P, L, t, fmt, roundFilter, setRoundFilter } = useCtx();
  const s = ms(P.start), e = ms(P.end) + DAY;
  const x = (d) => ((ms(d) - s) / (e - s)) * 100;
  const today = x(P.today);
  const weeks = [];
  for (let d = s; d <= e; d += 7 * DAY) weeks.push(new Date(d).toISOString().slice(0, 10));
  return (
    <div className="tl">
      <div className="tl-grid">
        <div className="tl-axis">
          {weeks.filter((w) => Math.abs(x(w) - today) > 5).map((w) => <span key={w} className="tl-wk" style={{ left: x(w) + '%' }}>{fmt(w)}</span>)}
          <span className="tl-wk tl-wk-today" style={{ left: today + '%' }}>{t('tl.today')}</span>
        </div>
        <div className="tl-rows">
          {P.rounds.map((r) => {
            const left = Math.max(0, Math.min(100, x(r.start))), right = x(r.due);
            const w = Math.max(2, right - left);
            const narrow = w < 10;
            const on = roundFilter === r.n;
            const label = t('round', { n: r.n }) + DOT + L(r.title);
            return (
              <div key={r.n} className="tl-row">
                <button className={'tl-bar b-' + r.status + (on ? ' on' : '')} style={{ left: left + '%', width: w + '%' }} onClick={() => setRoundFilter(on ? null : r.n)} title={label}>
                  {!narrow && <span className="tl-bar-t">{label}</span>}
                </button>
                {narrow && <span className="tl-bar-out" style={{ left: 'calc(' + right + '% + 12px)' }}>{label}</span>}
                <span className={'tl-ms ms-' + r.kind + ' s-' + r.status} style={{ left: right + '%' }} title={(r.kind === 'hard' ? t('tl.hard') : t('tl.cadence')) + DOT + fmt(r.due)}></span>
              </div>
            );
          })}
          <div className="tl-today" style={{ left: today + '%' }}></div>
        </div>
      </div>
    </div>
  );
}

function DocFrame({ name, kind, pages, active }) {
  const { t } = useCtx();
  const slide = kind === 'pptx';
  return (
    <div className="oo">
      <div className="oo-bar"><span className="oo-logo">ONLYOFFICE</span><span className="oo-name">{name}</span><span className="grow"></span><span className="faint small">{t('af.readonly') + DOT + t('af.mock')}</span></div>
      <div className="oo-canvas">
        {pages.map((pg, i) => (
          <div key={i} className={'oo-page' + (slide ? ' slide' : '')}>
            {pg.map((b, j) => {
              const hit = b.n || b.x;
              const cls = 'oo-b oo-' + b.t + (hit ? ' hit' : '') + (active && hit === active ? ' on' : '');
              const tag = b.n || b.label;
              if (b.t === 'fig' || b.t === 'tbl') return <div key={j} className={cls}><span>{b.s}</span>{tag && <span className="oo-tag">{tag}</span>}</div>;
              return <div key={j} className={cls}>{b.s}{tag && <span className="oo-tag">{tag}</span>}</div>;
            })}
            <div className="oo-pn">{t('af.page', { n: i + 1 })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Ctx, useCtx, ms, DAY, DOT, ST_TONE, EF_TONE, SRC_GLYPH, KIND_LABEL, Pill, Status, KindMark, FileKind, Avatar, NeedChip, AiMark, Sidebar, Timeline, DocFrame });
