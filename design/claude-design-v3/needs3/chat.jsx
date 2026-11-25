// Project-agent composer: suggestion chips, a short thread, privacy toggle, file attach.
function Thread({ msgs, onClose }) {
  const { L, t } = useCtx();
  const ref = React.useRef(null);
  React.useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs.length]);
  return (
    <div className="thread" data-thread="panel">
      <div className="thread-h"><span className="agent-dot"></span><strong>{t('ch.agent')}</strong><span className="grow"></span><button className="x" onClick={onClose} aria-label={t('ch.close')}>×</button></div>
      <div className="thread-b" ref={ref}>
        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="msg-u">{m.text}</div>
        ) : (
          <div key={i} className="msg-a">
            <div>{typeof m.text === 'string' ? m.text : L(m.text)}</div>
            {m.cites && m.cites.length > 0 && <div className="row gap6 wrap">{m.cites.map((c) => <NeedChip key={c} id={c} />)}</div>}
            {m.actions && <div className="row gap6 wrap">{m.actions.map((a, j) => <button key={j} className="btn btn-sm" onClick={a.run}>{a.label}</button>)}</div>}
            <div className="small faint">{t('ch.sim')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Composer({ scope, suggestions, msgs, onSend, onChip, onFile, onCloseThread, inputRef, inline, priv, setPriv }) {
  const { t, L } = useCtx();
  const [v, setV] = React.useState('');
  const fileRef = React.useRef(null);
  const grow = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(200, el.scrollHeight) + 'px'; };
  const send = () => { if (!v.trim()) return; onSend(v); setV(''); setTimeout(() => grow(inputRef && inputRef.current), 0); };
  const ph = scope === 'home' ? t('ch.phHome') : priv ? t('ch.phPrivate') : t('ch.ph');
  return (
    <div className={'composer-wrap' + (inline ? ' inline' : '')}>
      {msgs && msgs.length > 0 && <Thread msgs={msgs} onClose={onCloseThread} />}
      {suggestions.length > 0 && (
        <div className="chips">{suggestions.map((s) => <button key={s.id} className={'sugg' + (s.hot ? ' hot' : '')} data-sugg={s.id} onClick={() => onChip(s)}>{typeof s.text === 'string' ? s.text : L(s.text)}</button>)}</div>
      )}
      <div className={'composer' + (priv ? ' priv' : '')}>
        <button className="cm-plus" title={t('cm.attach')} aria-label={t('cm.attach')} onClick={() => fileRef.current.click()}>+</button>
        <textarea ref={inputRef} rows={1} value={v} placeholder={ph} data-cm="text"
          onChange={(e) => { setV(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}></textarea>
        {setPriv && (
          <div className="seg seg-xs pv">
            <button className={!priv ? 'on' : ''} onClick={() => setPriv(false)} data-pv="project">{t('pv.project')}</button>
            <button className={priv ? 'on' : ''} onClick={() => setPriv(true)} data-pv="only">{t('pv.only')}</button>
          </div>
        )}
        <button className={'cm-send' + (v.trim() ? ' on' : '')} onClick={send} aria-label={t('cm.send')} data-cm="send">↑</button>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.markdown" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
      </div>
      {!inline && <div className="cm-hint">{t('cm.hint')}</div>}
    </div>
  );
}

Object.assign(window, { Composer, Thread });
