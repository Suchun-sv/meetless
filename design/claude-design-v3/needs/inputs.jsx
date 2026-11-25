// Inputs: imported files and hand-written Markdown, with detected needs to accept or ignore.
const NEED_WORDS = /(需要|要求|希望|应该|必须|要|should|need|must|want|please)/i;

// Simulated detection: every line that reads like a request becomes a proposed need.
function detect(lines) {
  return lines.map((s, i) => ({ s, i })).filter((o) => NEED_WORDS.test(o.s)).slice(0, 5)
    .map((o, k) => ({ id: 'x' + (k + 1), line: o.i, type: 'new', text: { 'zh-CN': o.s.slice(0, 60), en: o.s.slice(0, 60) }, accept: { 'zh-CN': '—', en: '—' } }));
}

function makeInput(id, kind, title, text, today) {
  const lines = (text || '').split(/\n+/).map((s) => s.replace(/^[#>*\-\s]+/, '').trim()).filter(Boolean);
  const ex = detect(lines);
  const body = lines.length ? lines.map((s, i) => { const x = ex.find((e) => e.line === i); return { p: { 'zh-CN': s, en: s }, x: x ? x.id : undefined }; })
    : [{ p: { 'zh-CN': '（文件内容预览）', en: '(file preview)' } }];
  return { id, kind, title: { 'zh-CN': title, en: title }, from: 'me', date: today, status: 'pending', parsing: true, body, extracts: ex, isNew: true };
}

function MdModal({ onClose, onImport }) {
  const { t } = useCtx();
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  return (
    <div className="scrim" onClick={onClose}>
      <div className="askp" onClick={(e) => e.stopPropagation()} data-md="modal">
        <div className="row"><h2 className="grow">{t('in.mdTitle')}</h2><button className="x" onClick={onClose} aria-label={t('close')}>×</button></div>
        <input className="inp" placeholder={t('in.mdName')} value={title} onChange={(e) => setTitle(e.target.value)} data-md="title" />
        <textarea className="inp ta" placeholder={t('in.mdPh')} value={text} onChange={(e) => setText(e.target.value)} data-md="text"></textarea>
        <div className="row gap6" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('in.cancel')}</button>
          <button className="btn btn-primary" disabled={!text.trim()} data-md="go" onClick={() => onImport((title.trim() || text.trim().split('\n')[0].slice(0, 30)) + '.md', 'md', text)}>{t('in.mdGo')}</button>
        </div>
      </div>
    </div>
  );
}

function Inputs() {
  const { P, L, t, fmt, inputs, selInput, setSelInput, extractAct, addInput } = useCtx();
  const [md, setMd] = React.useState(false);
  const [hot, setHot] = React.useState(null);
  const fileRef = React.useRef(null);
  const cur = inputs.find((i) => i.id === selInput) || inputs[0];
  const pickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const kind = ext === 'pdf' ? 'pdf' : ext === 'docx' || ext === 'doc' ? 'docx' : ext === 'md' ? 'md' : 'txt';
    if (kind === 'txt' || kind === 'md') { const r = new FileReader(); r.onload = () => addInput(f.name, kind, String(r.result)); r.readAsText(f); }
    else addInput(f.name, kind, '');
    e.target.value = '';
  };
  const groups = [['pending', inputs.filter((i) => i.status === 'pending')], ['done', inputs.filter((i) => i.status === 'done')]];
  const who = (k) => (P.people[k] ? L(P.people[k]) : k);
  const office = cur && (cur.kind === 'pdf' || cur.kind === 'docx');
  return (
    <div className="three">
      <div className="pane-l">
        <div className="row gap6 wrap">
          <button className="btn btn-primary btn-sm" onClick={() => fileRef.current.click()} data-in="import">{t('in.import')}</button>
          <button className="btn btn-sm" onClick={() => setMd(true)} data-in="write">{t('in.write')}</button>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.markdown" style={{ display: 'none' }} onChange={pickFile} />
        </div>
        <div className="faint small">{t('in.types')}</div>
        {groups.map(([g, list]) => list.length > 0 && (
          <div key={g} className="stack">
            <div className="side-label" style={{ padding: '10px 4px 0' }}>{t('in.' + g)} · {list.length}</div>
            {list.map((i) => {
              const open = i.extracts.filter((x) => !x.state).length;
              return (
                <div key={i.id} className={'li' + (cur && cur.id === i.id ? ' on' : '')} data-input={i.id} onClick={() => setSelInput(i.id)}>
                  <div className="row gap6"><FileKind kind={i.kind} /><span className="li-t">{L(i.title)}</span></div>
                  <div className="small faint row gap6"><span>{who(i.from) + DOT + fmt(i.date)}</span>{open > 0 && <span className="nav-n">{open}</span>}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="pane-c">
        {!cur ? <div className="faint pad">{t('in.empty')}</div> : office ? (
          <DocFrame name={L(cur.title)} kind={cur.kind} active={hot} pages={[cur.body.map((b) => ({ t: 'p', s: L(b.p), x: b.x, label: b.x && (cur.extracts.find((e) => e.id === b.x) || {}).need }))]} />
        ) : (
          <div className="sheet">
            <div className="row gap6"><FileKind kind={cur.kind} /><strong>{L(cur.title)}</strong></div>
            <div className="small faint">{t('in.from', { who: who(cur.from) }) + DOT + fmt(cur.date)}</div>
            {cur.body.map((b, i) => <p key={i} className={'para' + (b.x ? ' hit' : '') + (b.x && b.x === hot ? ' on' : '')}>{L(b.p)}</p>)}
          </div>
        )}
      </div>

      <div className="pane-r">
        <h3>{t('in.extract')}</h3>
        {cur && cur.parsing && <div className="faint small">{t('in.parsing')}</div>}
        {cur && !cur.parsing && cur.extracts.length === 0 && <div className="faint small">{t('in.none')}</div>}
        {cur && !cur.parsing && cur.extracts.map((x) => (
          <div key={x.id} className={'xc' + (x.state ? ' ' + x.state : '')} data-x={x.id} onMouseEnter={() => setHot(x.id)} onMouseLeave={() => setHot(null)}>
            <div className="row gap6"><Pill tone={x.type === 'hyp' ? 'violet' : x.type === 'rev' ? 'amber' : x.type === 'action' ? 'gray' : 'ink'}>{t('in.x.' + x.type)}</Pill>{x.need && <NeedChip id={x.need} />}</div>
            <div className="xc-t">{L(x.text)}</div>
            {!x.state ? (
              <div className="row gap6">
                <button className="btn btn-sm btn-primary" onClick={() => extractAct(cur.id, x.id, 'accept')}>{t('in.accept')}</button>
                <button className="btn btn-sm" onClick={() => extractAct(cur.id, x.id, 'ignore')}>{t('in.ignore')}</button>
              </div>
            ) : <div className="small faint">{x.state === 'accepted' ? '✓ ' + t('in.accepted') : t('in.ignored')}</div>}
          </div>
        ))}
        {cur && cur.isNew && <div className="faint small">{t('in.sim')}</div>}
      </div>
      {md && <MdModal onClose={() => setMd(false)} onImport={(name, kind, text) => { addInput(name, kind, text); setMd(false); }} />}
    </div>
  );
}

Object.assign(window, { Inputs, makeInput });
