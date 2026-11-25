import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clip, type ArtifactKind, type Id, type InputKind, type NeedStatus, type SourceKind } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { displayName, initials } from '../model/state';
import { avatarTone, KIND_LABEL, SRC_LABEL_KEY, ST_TONE, type Tone } from './tone';

/*
 * Shared primitives (contract §8). They render only base classes from styles/base.css: no
 * inline colour, font, radius or shadow, and no dots. No kind marks: a need code is never
 * preceded by a glyph, square or dot (external needs and hypotheses differ by the N / H prefix).
 */

export function Pill({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={`pill tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Need status as coloured text. */
export function Status({ s }: { s: NeedStatus }) {
  const { t } = useApp();
  return <span className={`st tone-${ST_TONE[s]}`}>{t(`st.${s}` as MessageKey)}</span>;
}

export function FileKind({ kind }: { kind: ArtifactKind | InputKind }) {
  return <span className={`fk fk-${kind}`}>{KIND_LABEL[kind]}</span>;
}

/** Where something came from, as a short word in a file-kind style tag (no glyph). */
export function SourceTag({ src }: { src: SourceKind }) {
  const { t } = useApp();
  return <span className="fk fk-src">{t(SRC_LABEL_KEY[src])}</span>;
}

export function Avatar({ userId, size }: { userId: Id; size?: 'sm' }) {
  const { live } = useApp();
  const name = displayName(live, userId);
  return (
    <span className={`av av-${avatarTone(userId)}${size === 'sm' ? ' av-sm' : ''}`} title={name}>
      {initials(name)}
    </span>
  );
}

/** A need's code and clipped title; opens the need. */
export function NeedChip({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live, t, openNeed } = useApp();
  const n = live.needs[needId];
  if (!n || n.projectId !== projectId) return <span className="faint small">{t('common.missingText')}</span>;
  const cls = `needchip${n.kind === 'hyp' ? ' nc-hyp' : ''}${n.status === 'refuted' ? ' nc-ref' : ''}`;
  return (
    <button
      type="button"
      className={cls}
      title={`${n.code} ${n.title}`}
      onClick={(e) => {
        e.stopPropagation();
        openNeed(projectId, needId);
      }}
    >
      <span className="mono faint">{n.code}</span>
      <span className="nc-t">{clip(n.title, 60)}</span>
    </button>
  );
}

/** Marks rule output: 「规则识别」 in violet, with the "no AI model" tip. */
export function RulesMark({ confirmed, onFix }: { confirmed?: boolean; onFix?: () => void }) {
  const { t } = useApp();
  if (confirmed) return <span className="ai ai-ok">{t('ai.confirmed')}</span>;
  return (
    <span className="ai tone-ai" title={t('app.rulesTip')}>
      {t('ai.rules')}
      {onFix && (
        <button type="button" className="ai-fix" onClick={onFix}>
          {t('ai.fix')}
        </button>
      )}
    </span>
  );
}

const BTN_CLASS = { primary: ' btn-primary', sm: ' btn-sm', ghost: ' btn-ghost' } as const;

export function Btn({ kind, testId, className, type, ...rest }: { kind?: keyof typeof BTN_CLASS; testId?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type ?? 'button'} className={`btn${kind ? BTN_CLASS[kind] : ''}${className ? ` ${className}` : ''}`} data-testid={testId} {...rest} />;
}
