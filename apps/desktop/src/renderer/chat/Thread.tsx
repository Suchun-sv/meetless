import { useEffect, useRef } from 'react';
import { chatMessages, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Pill } from '../ui/primitives';
import { Reply } from './Reply';

/**
 * The private thread for `scope` (contract §8): one user's own history with the project agent,
 * never seen by anyone else. `.thread-b` is the scroll box; when a message arrives it jumps to the
 * bottom so the newest answer is in view (as the prototype's `needs3/chat.jsx` does), with no
 * scroll animation.
 */
export function Thread({ scope }: { scope: 'home' | Id }) {
  const { t, live, me, submit } = useApp();
  const msgs = chatMessages(live, me, scope);
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, scope]);
  return (
    <div className="thread" data-testid="thread">
      <div className="thread-h">
        <strong>{scope === 'home' ? t('ch.homeAgent') : t('ch.agent')}</strong>
        <span className="grow" />
        <button type="button" className="x" data-testid="thread-close" aria-label={t('ch.close')} onClick={() => void submit('chat.cleared', { scope })}>
          {'×'}
        </button>
      </div>
      <div className="thread-b" ref={body}>
        {msgs.map((m) => (
          <div key={m.id} className="thread-msg">
            <div className="msg-u">{m.text}</div>
            <div className="msg-a" data-testid="msg-a">
              <Reply reply={m.reply} scope={scope} messageId={m.id} />
              <Pill tone="ai" title={t('app.rulesTip')}>
                {t('app.rules')}
              </Pill>
              <div className="faint small">{t('ch.sim')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
