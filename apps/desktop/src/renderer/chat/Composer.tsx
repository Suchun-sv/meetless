import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { answer, chatMessages, type Id, type Suggestion } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { useAiEnabled } from './ai';
import { registerComposer } from './focus';
import { routeErrorText } from '../setup/model';
import {
  acceptsFile,
  agentScope,
  askCommands,
  chipLabel,
  chipOutcome,
  chipsFor,
  continueAfterSubmit,
  EXT_KIND,
  fileImport,
  getPriv,
  importResult,
  needsServer,
  onDashboardFor,
  recordSentPriv,
  recordSentPrivFor,
  setPriv,
  sendCommands,
  shouldSend,
  type U1Command,
} from './model';
import { Thread } from './Thread';
import './chat.css';

/**
 * Selector of the composer's text field (contract §12.16): the textarea inside `[data-testid="composer"]`.
 * In-app focus goes through `focusComposer()` (`chat/focus.ts`); e2e and other blocks may query this.
 */
export const COMPOSER_INPUT = '[data-testid="composer"] textarea';

/** The attach picker's `accept` list: exactly the extensions `acceptsFile` takes. Anything else is refused with `ch.badFile`. */
const ACCEPT = Object.keys(EXT_KIND)
  .map((e) => `.${e}`)
  .join(',');
/** Upload media type for the kinds `fileImport` does not read as text. */
const BLOB_MEDIA_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** The project agent composer: suggestion chips, the private thread, the text field, attach and the privacy switch (contract §8). */
export function Composer({ scope, inline }: { scope: 'home' | Id; inline?: boolean }) {
  const { t, live, me, today, route, submit, api, bridge, go, openNeed, openOverlay, notify, errorText } = useApp();
  const [text, setText] = useState('');
  const [priv, setPrivState] = useState(() => (scope !== 'home' ? getPriv(scope) : false));
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ai = useAiEnabled(api, me);
  /** The question waiting on `agent.ask`; the composer takes no new question meanwhile. */
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setPrivState(scope !== 'home' ? getPriv(scope) : false);
  }, [scope]);

  const msgs = chatMessages(live, me, scope);
  const onDash = onDashboardFor(scope, route.view);
  const chips = chipsFor(live, me, scope, onDash, today);
  const ph = scope === 'home' ? t('ch.phHome') : priv ? t('ch.phPrivate') : t('ch.ph');

  function togglePriv(v: boolean) {
    setPrivState(v);
    if (scope !== 'home') setPriv(scope, v);
  }

  /** Sends `cmds` in order, stopping at a rejection. Resolves to whether the first one went through. */
  async function runCommands(cmds: U1Command[]): Promise<boolean> {
    // The switch each chat message is sent under, for "Import as input" later (ruling R21).
    recordSentPrivFor(cmds, scope !== 'home' && priv);
    for (const [i, cmd] of cmds.entries()) {
      const r = await submit(cmd.type, cmd.payload);
      if (!continueAfterSubmit(r)) return i > 0;
    }
    return true;
  }

  async function send() {
    if (pending !== null || !shouldSend(text, false)) return;
    const value = text;
    setText('');
    const messageId = newId('msg');
    let cmds: U1Command[];
    const sendPriv = scope !== 'home' && priv;
    if (needsServer(answer(live, { userId: me, scope: agentScope(scope), text: value, today }), ai)) {
      setPending(value);
      // The switch the message is sent under; the server imports content under it (ruling R21).
      recordSentPriv(messageId, sendPriv);
      try {
        cmds = await askCommands(live, me, scope, value, today, new Date().toISOString(), messageId, (req) => api('agent.ask', req), { ai, priv: sendPriv });
      } finally {
        setPending(null);
      }
    } else {
      cmds = sendCommands(live, me, scope, value, today, new Date().toISOString(), messageId);
    }
    const sent = await runCommands(cmds);
    // A rejected question (submit has shown why) gives the text back, unless the user has typed again.
    if (!sent) setText((cur) => (cur === '' ? value : cur));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!shouldSend(text, e.nativeEvent.isComposing)) return;
    e.preventDefault();
    void send();
  }

  function grow(e: FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }

  function onChipClick(chip: Suggestion) {
    const label = chipLabel(t, live, chip);
    const outcome = chipOutcome(live, me, scope, chip, label, today, new Date().toISOString(), newId('msg'));
    void runCommands(outcome.commands).then(() => {
      if (outcome.open) openNeed(outcome.open.projectId, outcome.open.needId);
      if (outcome.overlay) openOverlay(outcome.overlay);
    });
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file || scope === 'home') return;
    const projectId: Id = scope;
    if (!acceptsFile(file.name)) {
      notify('error', t('ch.badFile'));
      return;
    }
    const info = fileImport({ projectId, name: file.name, priv, today, inputId: newId('in') });
    let blobHash: string | null = null;
    let fileText: string | null = null;
    try {
      if (info.readAsText) {
        fileText = await file.text();
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const up = await bridge.uploadBlob(bytes, BLOB_MEDIA_TYPE[info.kind] ?? 'application/octet-stream');
        if (!up.ok) {
          notify('error', routeErrorText(t, errorText, up.code));
          return;
        }
        blobHash = up.hash;
      }
    } catch {
      // The file could not be read, or the upload IPC itself failed: say so instead of an unhandled rejection.
      notify('error', t('ch.fileFailed'));
      return;
    }
    const res = await api('inputs.import', {
      projectId: info.projectId,
      inputId: info.inputId,
      title: info.title,
      kind: info.kind,
      blobHash,
      text: fileText,
      from: info.from,
      date: info.date,
      private: info.private,
    }).catch(() => null);
    if (!res) return notify('error', t('ch.fileFailed'));
    const out = importResult(res, projectId, info.inputId);
    if ('route' in out) go(out.route);
    else notify('error', routeErrorText(t, errorText, out.code));
  }

  return (
    <div className={`composer-wrap${inline ? ' inline' : ''}`} data-testid="composer" data-scope={scope}>
      {(msgs.length > 0 || pending !== null) && <Thread scope={scope} pending={pending} />}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`chip${c.hot ? ' hot' : ''}`} data-testid="chip" data-chip={c.id} onClick={() => onChipClick(c)}>
              {chipLabel(t, live, c)}
            </button>
          ))}
        </div>
      )}
      <div className={`composer${priv ? ' priv' : ''}${pending !== null ? ' pending' : ''}`} aria-busy={pending !== null}>
        {scope !== 'home' && (
          <button type="button" className="cm-plus" data-testid="composer-attach" title={t('cm.attach')} aria-label={t('cm.attach')} onClick={() => fileRef.current?.click()}>
            {'+'}
          </button>
        )}
        <textarea
          ref={(el) => registerComposer(el)}
          data-testid="composer-text"
          rows={1}
          value={text}
          placeholder={ph}
          aria-label={ph}
          onChange={(e) => setText(e.target.value)}
          onInput={grow}
          onKeyDown={onKeyDown}
        />
        {scope !== 'home' && (
          <div className="seg pv">
            <button type="button" data-testid="pv-project" className={priv ? '' : 'on'} onClick={() => togglePriv(false)}>
              {t('pv.project')}
            </button>
            <button type="button" data-testid="pv-only" className={priv ? 'on' : ''} onClick={() => togglePriv(true)}>
              {t('pv.only')}
            </button>
          </div>
        )}
        <button
          type="button"
          className={`cm-send${text.trim() && pending === null ? ' on' : ''}`}
          data-testid="composer-send"
          aria-label={t('cm.send')}
          disabled={pending !== null}
          onClick={() => void send()}
        >
          {'↑'}
        </button>
        {scope !== 'home' && <input ref={fileRef} type="file" className="cm-file" accept={ACCEPT} onChange={(e) => void onFileChange(e)} />}
      </div>
      {ai && (
        <div className="cm-hint tone-ai" data-testid="ai-note">
          {t('ch.aiNote')}
        </div>
      )}
      {!inline && <div className="cm-hint">{t('cm.hint')}</div>}
    </div>
  );
}
