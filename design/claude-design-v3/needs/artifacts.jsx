// Artifacts: versions on the left, an embedded viewer in the middle, linked needs on the right.
function Artifacts() {
  const { P, L, t, fmt, artifacts, selArtifact, setSelArtifact, setCopy } = useCtx();
  const a = artifacts.find((x) => x.id === selArtifact) || artifacts[0];
  const [vi, setVi] = React.useState(0);
  React.useEffect(() => setVi(0), [a && a.id]);
  if (!a) return null;
  const v = a.versions[vi] || a.versions[0];
  const vname = (x) => (typeof x.v === 'string' ? x.v : L(x.v));
  let viewer;
  if (a.kind === 'code') {
    viewer = (
      <div className="codebox">
        <div className="oo-bar"><span className="mono">{L(a.title)} @ {vname(v)}</span><span className="grow"></span><Pill tone="amber">{t('af.mock')}</Pill></div>
        <pre className="diff">{(a.diff || []).map((l, i) => <div key={i} className={l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l[0] === '@' ? 'hunk' : ''}>{l}</div>)}</pre>
      </div>
    );
  } else if (a.kind === 'notion') {
    viewer = (
      <div className="notion">
        <div className="oo-bar"><span>Notion · {L(a.title)}</span><span className="grow"></span><Pill tone="amber">{t('af.mock')}</Pill></div>
        <div className="notion-p">
          <h2>{L(a.title)}</h2>
          <table className="tbl"><tbody>{a.rows.map((r) => <tr key={r[0]}><td className="mono">{r[0]}</td><td>{L(r[1])}</td><td><NeedChip id={r[2]} /></td></tr>)}</tbody></table>
        </div>
      </div>
    );
  } else {
    viewer = <DocFrame name={L(a.title) + ' ' + vname(v)} kind={a.kind} pages={a.pages} />;
  }
  return (
    <div className="three">
      <div className="pane-l">
        {artifacts.map((x) => (
          <div key={x.id} className={'li' + (x.id === a.id ? ' on' : '')} data-artifact={x.id} onClick={() => setSelArtifact(x.id)}>
            <div className="row gap6"><FileKind kind={x.kind} /><span className="li-t">{L(x.title)}</span></div>
            <div className="small faint">{x.where + DOT + vname(x.versions[0]) + DOT + fmt(x.versions[0].date)}</div>
          </div>
        ))}
      </div>
      <div className="pane-c">
        <div className="row gap6 wrap af-h">
          <h2>{L(a.title)}</h2>
          <span className="grow"></span>
          <button className="btn btn-sm" onClick={() => setCopy({ artifact: a.id })}>{t('cp.btn')}</button>
          <button className="btn btn-sm">{t('af.open', { w: a.where })} ↗</button>
        </div>
        {viewer}
      </div>
      <div className="pane-r">
        <h3>{t('af.changes')}</h3>
        <div className="small">{L(v.note)}</div>
        <h3>{t('af.needs')}</h3>
        <div className="stack">{a.needs.map((id) => <NeedChip key={id} id={id} />)}</div>
        <h3>{t('af.versions')}</h3>
        <div className="stack">
          {a.versions.map((x, i) => (
            <button key={i} className={'ver' + (i === vi ? ' on' : '')} onClick={() => setVi(i)}>
              <span className="mono">{vname(x)}</span><span className="faint small">{fmt(x.date) + DOT + t('round', { n: x.round })}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Artifacts });
