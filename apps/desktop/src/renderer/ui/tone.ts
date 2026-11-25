import type { ArtifactKind, Id, InputKind, NeedStatus, Risk, SourceKind, WorkEffect } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';

/**
 * Tones for labels and status text (contract §8). Each renders as the class `tone-<tone>`.
 * Violet (`ai`) is reserved for AI and rule output: only agent and rule proposals use it
 * (riskTone). Hypothesis testing is info and a new hypothesis is strong (v4 tokens).
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai' | 'strong' | 'muted';

/** From the prototype's ui.jsx (gray to neutral, blue to info, green to success, amber to warning). */
export const ST_TONE: Record<NeedStatus, Tone> = {
  todo: 'neutral',
  doing: 'info',
  met: 'success',
  partial: 'warning',
  moved: 'neutral',
  dropped: 'neutral',
  untested: 'neutral',
  testing: 'info',
  held: 'success',
  refuted: 'muted',
  parked: 'neutral',
};

export const EF_TONE: Record<WorkEffect, Tone> = {
  done: 'success',
  advance: 'info',
  revise: 'warning',
  spawn: 'strong',
  refute: 'muted',
  hold: 'success',
  extract: 'strong',
  move: 'warning',
};

const RISK_CODE_TONE: Record<Risk['code'], Tone> = {
  proposal: 'ai',
  waitMe: 'info',
  stale: 'warning',
  asked: 'warning',
  conflict: 'danger',
  todo: 'danger',
  wait: 'neutral',
  inputs: 'neutral',
};

/**
 * The tone of a dashboard risk row, by kind. Core's own `Risk.tone` is ignored, because it marks
 * both "waiting for you" and agent proposals violet: only proposals (agent or rule output) are
 * violet; "waiting for you" is info (v4 tokens), stale and asked are amber, conflicts and due-soon
 * todos are red, waiting on others and inputs to process are neutral.
 */
export function riskTone(risk: Pick<Risk, 'code'>): Tone {
  return RISK_CODE_TONE[risk.code];
}

/**
 * Sources are shown as short words (SourceTag), never glyphs: the user dropped square and other
 * markers on 2026-11-24. The words are the i18n `src.<kind>` keys.
 */
export const SRC_LABEL_KEY: Record<SourceKind, MessageKey> = {
  commit: 'src.commit',
  exp: 'src.exp',
  doc: 'src.doc',
  meeting: 'src.meeting',
  chat: 'src.chat',
  mail: 'src.mail',
  file: 'src.file',
  agent: 'src.agent',
};

export const KIND_LABEL: Record<ArtifactKind | InputKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  pptx: 'PPTX',
  txt: 'TXT',
  md: 'MD',
  code: 'GIT',
  notion: 'NOTION',
  overleaf: 'TEX',
};

/** Picks `--color-avatar-<n>` for a user, deterministically (FNV-1a over the id). */
export function avatarTone(userId: Id): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 8 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}
