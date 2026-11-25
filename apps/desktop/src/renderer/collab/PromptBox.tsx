import { useEffect, useRef, useState } from 'react';
import { needLink, type Id, type IsoTime } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Btn } from '../ui/primitives';
import { copyText } from './clipboard';
import { linkPreview, promptText } from './model';
import './collab.css';

const COPIED_MS = 1500;

/**
 * The agent prompt with a copy button, and a togglable live preview of the shareable context
 * (needs3/collab.jsx `PromptBox`). `defaultOpen` lets a test render the preview open without a
 * click — this repo has no jsdom, so component tests render static markup. A need with no
 * shareable context — private, or invisible to this viewer — shows only `lk.privateFirst`: no
 * prompt, no copy button, no preview.
 */
export function PromptBox({ projectId, needId, defaultOpen }: { projectId: Id; needId: Id; defaultOpen?: boolean }) {
  const { t, live, locale, fmtClock, notify } = useApp();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [gen, setGen] = useState<IsoTime | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const preview = linkPreview(live, needId, locale);
  if (!preview) return <div className="pbox">{t('lk.privateFirst')}</div>;

  const prompt = promptText(t, needLink(projectId, preview.code));

  const onCopy = async () => {
    const ok = await copyText(prompt);
    if (!ok) {
      notify('error', t('lk.copyFailed'));
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <div className="pbox">
      <div className="row gap6">
        <span className="small faint grow">{t('lk.prompt')}</span>
        <Btn kind="primary" testId="lk-copy" onClick={onCopy}>
          {copied ? `✓ ${t('cp.copied')}` : t('lk.copy')}
        </Btn>
      </div>
      <pre className="pbox-p" data-testid="lk-prompt">
        {prompt}
      </pre>
      <div className="row gap6">
        <button type="button" className="link" data-testid="lk-preview" onClick={() => setOpen((o) => !o)}>
          {(open ? '▾ ' : '▸ ') + t('lk.preview')}
        </button>
        <span className="grow" />
        {open && <span className="small faint">{t('lk.gen', { t: gen ? fmtClock(gen) : t('lk.now'), v: preview.version })}</span>}
        {open && (
          <button type="button" className="link" data-testid="lk-refresh" onClick={() => setGen(new Date().toISOString())}>
            {t('lk.refresh')}
          </button>
        )}
      </div>
      {open && <textarea className="inp mono-ta" readOnly data-testid="lk-context" value={linkPreview(live, needId, locale)?.markdown ?? ''} />}
      <div className="small faint">{t('lk.note')}</div>
    </div>
  );
}
