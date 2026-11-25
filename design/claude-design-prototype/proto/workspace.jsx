// Overview: artifact list + artifact preview at the selected cut-off, and the right context/review panel.
const GOALS = [
  { src: 'zh-CN', 'zh-CN': '11 月底向客户 A 交付客户管理系统首版', en: 'Deliver CRM v1 to Client A by end of November' },
  { src: 'zh-CN', 'zh-CN': '客户数据不出境；首版仅含 Web 端', en: 'Client data stays in-region; v1 is web only' }
];

function ArtifactList({ sel, setSel }) {
  const { t, S } = useClient();
  const M = window.MeetlessMock;
  return (
    <div className="alist">
      <div className="alist-h">{t('ws.requirements')}</div>
      {S.hasReq ? (
        <div className="acard req">
          <div className="acard-t"><span className="mono">R-12</span> <Tx c={M.requirement.title} /></div>
          <div className="acard-s">{S.decisions.length ? 'rev 2 · D-5' : 'rev 1'}</div>
        </div>
      ) : <div className="faint pad">{t('ws.notYet')}</div>}
      <div className="alist-h">{t('ws.artifacts')}</div>
      {Object.keys(M.artifacts).map((k) => {
        const a = M.artifacts[k];
        const w = S.working[k];
        const cf = S.confirmed[k];
        return (
          <div key={k} className={'acard' + (sel === k ? ' on' : '') + (!w ? ' dim' : '')} onClick={() => w && setSel(k)}>
            <div className="acard-t"><span className={'kind k-' + a.kind}>{a.kind.toUpperCase()}</span><Tx c={a.title} /></div>
            <div className="acard-s">
              {w ? <span>{t('ws.working')} {M.versions[w].art === 'code' ? M.versions[w].n : 'v' + M.versions[w].n}</span> : <span>{t('ws.notYet')}</span>}
              {cf && <span> · {t('ws.confirmed')} {M.versions[cf].art === 'code' ? M.versions[cf].n : 'v' + M.versions[cf].n}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssuePin({ id }) {
  const { t, S } = useClient();
  const open = S.open.some((o) => o.id === id);
  if (!open) return null;
  const i = window.MeetlessMock.issues[id];
  return <span className={'pin p-' + i.sev}>{id} · {t('sev.' + i.sev)}</span>;
}

function PptPreview({ v, prev }) {
  const { t } = useClient();
  const [n, setN] = React.useState(7);
  const slide = v.slides.find((s) => s.n === n) || v.slides[0];
  const old = prev && prev.slides.find((s) => s.n === slide.n);
  return (
    <div className="ppt">
      <div className="thumbs">
        {v.slides.map((s) => (
          <div key={s.n} className={'thumb' + (s.n === n ? ' on' : '')} onClick={() => setN(s.n)}>
            <div className="thumb-img"><span>{s.n}</span></div>
            {s.changed && <span className="dot-changed"></span>}
          </div>
        ))}
      </div>
      <div className="slide-wrap">
        <div className="slide">
          <div className="slide-n">{t('ws.slide', { n: slide.n })}</div>
          <div className="slide-title"><Tx c={slide.title} /></div>
          {slide.body ? <div className="slide-body"><Tx c={slide.body} block /></div> : <div className="placeholder">slide content · rendered page image</div>}
          {slide.issue && <IssuePin id={slide.issue} />}
        </div>
        {slide.unparsed && <div className="note n-amber"><strong>{t('ws.coverage')}</strong> {t('ws.unparsed')}</div>}
        {slide.changed && old && old.body && (
          <div className="diffbox">
            <div className="diff-h">{t('ws.diff')} · {t('ws.slide', { n: slide.n })}</div>
            <div className="del"><Tx c={old.body} /></div>
            <div className="add"><Tx c={slide.body} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

function DocPreview({ v, prev }) {
  const { t } = useClient();
  return (
    <div className="doc">
      {v.paras.map((p) => {
        const old = prev && prev.paras.find((x) => x.n === p.n);
        return (
          <div key={p.n} className={'para' + (p.changed ? ' changed' : '')}>
            <span className="para-n">{t('ws.para', { n: p.n })}</span>
            <div className="para-b">
              {p.changed && old && <div className="del"><Tx c={old.text} /></div>}
              <div className={p.changed ? 'add' : ''}><Tx c={p.text} block /></div>
              {p.issue && <IssuePin id={p.issue} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CodePreview({ v }) {
  const { t } = useClient();
  return (
    <div className="code">
      <div className="code-meta"><span className="mono">{v.branch}</span><span className="mono">PR {v.pr}</span><span className="mono">{v.path} L{v.lines}</span></div>
      <pre className="diff">{v.diff.map((l, i) => <div key={i} className={'dl ' + (l.k === '+' ? 'dl-add' : 'dl-del')}><span className="ln">{12 + i}</span><span className="dk">{l.k}</span>{l.t}</div>)}</pre>
      <div className="row gap8"><Btn title={t('app.sampleTip')}>{t('ws.openRepo')}</Btn></div>
    </div>
  );
}

function ArtifactPane({ sel }) {
  const { t, fmt, S } = useClient();
  const M = window.MeetlessMock;
  const vid = S.working[sel];
  if (!vid) return <div className="empty">{t('ws.notYet')}</div>;
  const v = M.versions[vid];
  const a = M.artifacts[sel];
  const prevId = S.prev[sel];
  const prev = prevId ? M.versions[prevId] : null;
  const pubEv = M.events.filter((e) => e.type === 'publish' && e.seq <= S.cut).pop();
  return (
    <div className="apane">
      <div className="apane-h">
        <div>
          <h2><Tx c={a.title} /> <span className="vtag">{a.kind === 'code' ? v.n : 'v' + v.n}</span></h2>
          <div className="muted small">{a.file} · {t('ws.published', { who: M.people[v.by].name, t: fmt(pubEv.at) })} · {t('ws.hash')} <span className="mono">{v.hash}</span></div>
        </div>
        {a.kind !== 'code' && <Btn title={t('app.sampleTip')}>{t('ws.openOriginal')}</Btn>}
      </div>
      <div className="vsum">
        <span className="muted">{prev ? t('ws.diff') : t('ws.noDiff')}</span>
        {prev && <span><Tx c={v.summary} /></span>}
      </div>
      {a.kind === 'pptx' && <PptPreview v={v} prev={prev} key={vid} />}
      {a.kind === 'docx' && <DocPreview v={v} prev={prev} />}
      {a.kind === 'code' && <CodePreview v={v} />}
    </div>
  );
}

function ContextPanel() {
  const { t, lang, fmt, S, isHistory } = useClient();
  const M = window.MeetlessMock;
  const later = isHistory ? M.events.filter((e) => e.seq > S.cut && ['decision', 'publish', 'baseline', 'agent', 'accept'].indexOf(e.type) >= 0).slice(0, 4) : [];
  const openLabel = (o) => {
    if (M.issues[o.id]) return <span><span className="mono">{o.id}</span> <Tx c={M.issues[o.id].title} /></span>;
    if (o.id === 'M-1-outcomes') return <span>{t('mt.outcomes')} · M-1 · {t('mt.awaiting', { who: M.people.lin.name })}</span>;
    if (o.id === 'A-1') return <span><span className="mono">A-1</span> <Tx c={M.meetings['M-1'].outcomes[1].text} /></span>;
    if (o.id === 'A-2') return <span><span className="mono">A-2</span> <Tx c={M.meetings['M-1'].outcomes[2].text} /></span>;
    if (o.id === 'ACC') return <span>P-1 · {t('inbox.g.accept')}</span>;
    return o.id;
  };
  return (
    <div className="ctx">
      <Section title={t('ctx.goals')}>
        <ul className="plain">
          {GOALS.map((g, i) => <li key={i}><Tx c={g} /></li>)}
          {S.acc && <li><span className="mono">R-12</span> {t('ch.accept')}: <Tx c={S.acc} />{S.decisions.length > 0 && <span className="muted small"> · rev 2 · {t('ctx.source')} D-5</span>}</li>}
        </ul>
      </Section>
      <Section title={t('ctx.baseline')}>
        {S.baseline ? <div className="stack4"><div><Badge tone="green">{S.baseline.id}</Badge></div>{S.baseline.items.map((v) => <VerChip key={v} vid={v} />)}</div> : <div className="faint">{t('ctx.noBaseline')}</div>}
      </Section>
      <Section title={t('ctx.decisions')}>
        {S.decisions.length ? (
          <div className="dec"><div><span className="mono">D-5</span> <Tx c={M.decision.text} /></div><div className="muted small">{M.people.lin.name} · {t('ctx.source')} M-1 · {fmt('2026-11-07T17:30:00Z')}</div></div>
        ) : <div className="faint">{t('ctx.noDecisions')}</div>}
      </Section>
      <Section title={t('ctx.why')}>
        {S.reasons.length ? S.reasons.map((r, i) => <div key={i} className="why"><Tx c={r.what} /><div className="muted small">{t('ctx.source')}: {r.src}</div></div>)
          : S.cut >= 4 ? <div className="why"><span>{lang === 'zh-CN' ? '首批候选版本' : 'First candidate versions'}</span><div className="muted small">{t('ctx.source')}: C-24 · R-12</div></div> : <div className="faint">{t('ctx.noReason')}</div>}
      </Section>
      <Section title={t('ctx.open')}>
        {S.open.length ? S.open.map((o) => <div key={o.id} className="open"><div>{openLabel(o)}</div><div className="muted small">{t('ctx.owner')} <Person id={o.owner} /></div></div>)
          : <div className="faint">{t('ctx.noOpen')}</div>}
      </Section>
      {isHistory && later.length > 0 && (
        <details className="later">
          <summary>{t('ctx.later')}</summary>
          <div className="muted small">{t('ctx.laterNote')}</div>
          {later.map((e) => <div key={e.seq} className="later-i"><span className="muted">{fmt(e.at)}</span> {txs(e.label, lang)}</div>)}
        </details>
      )}
    </div>
  );
}

function RunCard({ r }) {
  const { t, lang, S, isHistory } = useClient();
  const M = window.MeetlessMock;
  return (
    <div className={'run' + (r.status === 'stale' ? ' stale' : '')}>
      <div className="run-h">
        <strong>{txs(M.roles[r.agent], lang)} {t('sk.agent')}</strong>
        <Badge tone={RUN_TONE[r.status]}>{t('run.' + r.status)}</Badge>
        <span className="mono muted small">{r.id}</span>
      </div>
      <div className="run-meta">
        <span>{t('rev.skill')} <span className="mono">{r.skill}</span></span>
        <span>{t('rev.cut')} #{r.cut}</span>
        <span>{t('rev.model')} {r.model}</span>
        <span>{r.lang}</span>
      </div>
      <div className="stack4">{r.input.map((v) => <VerChip key={v} vid={v} />)}</div>
      {r.status === 'stale' && <div className="note n-gray">{t('run.staleNote', { v: 'v2' })}</div>}
      {r.uncovered && <div className="note n-amber"><strong>{t('rev.uncovered')}</strong> {t('ws.unparsed')}</div>}
      {r.issues.map((id) => {
        const i = M.issues[id];
        const stillOpen = S.open.some((o) => o.id === id);
        return (
          <div key={id} className={'issue s-' + i.sev}>
            <div className="issue-h"><Badge tone={SEV_TONE[i.sev]}>{t('sev.' + i.sev)}</Badge><span className="mono small">{id}</span><strong><Tx c={i.title} /></strong></div>
            <div className="kv"><span>{t('ws.version')}</span><Tx c={i.where} /></div>
            <div className="kv"><span>{t('rev.rule')}</span><span className="mono">{i.rule}</span></div>
            <div className="kv"><span>{t('rev.evidence')}</span><Tx c={i.evidence} /></div>
            {stillOpen ? (
              <div className="row gap6 wrap">
                {['rev.fix', 'rev.clarify', 'rev.fp', 'rev.waive'].map((k) => <Btn key={k} kind="sm" disabled={isHistory} title={isHistory ? t('act.disabledHistory') : t('app.sampleTip')}>{t(k)}</Btn>)}
              </div>
            ) : <div className="muted small">{t('rev.handled')}: {lang === 'zh-CN' ? '新版本已修复（提案 v4 / 方案 v3）' : 'Fixed in new versions (proposal v4 / design v3)'}</div>}
          </div>
        );
      })}
      {r.issues.length === 0 && r.status !== 'stale' && <div className="muted small">{lang === 'zh-CN' ? '未发现阻塞或警告。人工确认规则仍然适用。' : 'No blockers or warnings. Human approval rules still apply.'}</div>}
    </div>
  );
}

function ReviewPanel() {
  const { t, S } = useClient();
  if (!S.runs.length) return <div className="ctx"><div className="faint pad">{t('rev.noRun')}</div></div>;
  return <div className="ctx">{S.runs.map((r) => <RunCard key={r.id} r={r} />)}</div>;
}

function RightPanel() {
  const { t, S } = useClient();
  const [tab, setTab] = React.useState('ctx');
  return (
    <div className="panel">
      <div className="tabs">
        <button className={tab === 'ctx' ? 'on' : ''} onClick={() => setTab('ctx')}>{t('ctx.tab')}</button>
        <button className={tab === 'rev' ? 'on' : ''} onClick={() => setTab('rev')}>{t('rev.tab')}{S.open.some((o) => o.id === 'I-1') && <span className="tab-dot"></span>}</button>
      </div>
      {tab === 'ctx' ? <ContextPanel /> : <ReviewPanel />}
    </div>
  );
}

function Overview() {
  const [sel, setSel] = React.useState('ppt');
  const { S, t } = useClient();
  if (!S.exists) return <div className="empty">{t('ws.notYet')}</div>;
  return (
    <div className="ov">
      <ArtifactList sel={sel} setSel={setSel} />
      <ArtifactPane sel={sel} />
    </div>
  );
}

Object.assign(window, { Overview, RightPanel, RunCard });
