// Shared context + small primitives.
const ClientCtx = React.createContext(null);
const useClient = () => React.useContext(ClientCtx);

const LANG_NAME = { 'zh-CN': 'lang.zh-CN', en: 'lang.en' };

function makeClientApi(lang, tz) {
  const t = (k, v) => window.MeetlessI18n.translate(lang, k, v);
  const dtf = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const dayf = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: tz });
  const tzName = (() => {
    const p = new Intl.DateTimeFormat(lang, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date('2026-11-12T12:00:00Z'));
    const z = p.find((x) => x.type === 'timeZoneName');
    return z ? z.value : tz;
  })();
  const fmt = (iso) => dtf.format(new Date(iso));
  const day = (iso) => dayf.format(new Date(iso));
  return { lang, t, fmt, day, tzName };
}

// Business content in its original language; the other-language view is a derived translation,
// marked with a small chip (full source label in the tooltip). Clicking the chip shows the original.
function Tx({ c, block }) {
  const { lang, t } = useClient();
  const [orig, setOrig] = React.useState(false);
  if (!c) return null;
  if (c.src === lang) return <span>{c[lang]}</span>;
  const text = orig ? c[c.src] : (c[lang] || c[c.src]);
  const label = t('tr.label', { lang: t(LANG_NAME[c.src]) });
  return (
    <span className={block ? 'tx tx-block' : 'tx'}>
      <span lang={orig ? c.src : lang}>{text}</span>
      <button className={'tx-chip' + (orig ? ' on' : '')} title={label + ' · ' + (orig ? t('tr.showTr') : t('tr.showOrig'))} aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOrig(!orig); }}>
        {orig ? t('tr.origShort') : t('tr.short')}
      </button>
    </span>
  );
}
// Plain string of content in current language (for compact places like timeline labels).
function txs(c, lang) { return c ? (c[lang] || c[c.src]) : ''; }

function Avatar({ id, size }) {
  const p = window.MeetlessMock.people[id];
  if (id === 'agent') return <span className="av av-agent" style={{ width: size || 22, height: size || 22 }}>AI</span>;
  return <span className={'av av-' + id} style={{ width: size || 22, height: size || 22 }}>{p ? p.initials : '?'}</span>;
}
function Person({ id }) {
  const p = window.MeetlessMock.people[id];
  return <span className="person"><Avatar id={id} size={18} />{p ? p.name : id}</span>;
}

function Badge({ tone, children, title }) {
  return <span className={'badge b-' + (tone || 'gray')} title={title}>{children}</span>;
}
const SEV_TONE = { block: 'red', warn: 'amber', suggest: 'blue', human: 'violet' };
const RUN_TONE = { queued: 'gray', running: 'blue', done: 'green', partial: 'amber', failed: 'red', cancelled: 'gray', stale: 'gray' };
const STATUS_TONE = { making: 'gray', review: 'blue', revise: 'amber', final: 'blue', confirmed: 'green', delivered: 'green' };

function Btn({ kind, children, onClick, disabled, title }) {
  return <button className={'btn ' + (kind ? 'btn-' + kind : '')} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}
// Mutating action: disabled while viewing history.
function ActBtn({ k, kind }) {
  const { t, isHistory } = useClient();
  return <Btn kind={kind} disabled={isHistory} title={isHistory ? t('act.disabledHistory') : t('app.sampleTip')}>{t(k)}</Btn>;
}

function Section({ title, children, aside }) {
  return (
    <section className="sec">
      <div className="sec-h"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function VerChip({ vid }) {
  const M = window.MeetlessMock;
  const v = M.versions[vid];
  const { lang } = useClient();
  if (!v) return null;
  const a = M.artifacts[v.art];
  const label = a.kind === 'code' ? 'crm-web@' + v.n : txs(a.title, lang) + ' v' + v.n;
  return <span className={'ver ver-' + a.kind}><span className="ver-k">{a.kind.toUpperCase()}</span>{label}</span>;
}

Object.assign(window, { ClientCtx, useClient, makeClientApi, Tx, txs, Avatar, Person, Badge, Btn, ActBtn, Section, VerChip, SEV_TONE, RUN_TONE, STATUS_TONE, LANG_NAME });
