import { needLink, type Id, type State } from '@meetless/core';
import type { Locale, Translator } from '@meetless/i18n';
import { linkPreview, promptText } from '@renderer/collab/model';

export { linkPreview, promptText } from '@renderer/collab/model';

/** How long 「已复制」 stays on the copy button. */
export const COPIED_MS = 1500;

/**
 * The link-for-agent box (链接弹窗, desktop `PromptBox`): the prompt to paste into an agent, and
 * the shareable context it resolves to. Null for a need with no shareable context (private, or
 * not visible): the box then shows only `lk.privateFirst`.
 */
export interface LinkBox {
  code: string;
  link: string;
  prompt: string;
  /** The context markdown the link returns now, and its version. */
  markdown: string;
  version: number;
}

export function linkBox(t: Translator['t'], live: State, projectId: Id, needId: Id, locale: Locale): LinkBox | null {
  const preview = linkPreview(live, needId, locale);
  if (!preview) return null;
  const link = needLink(projectId, preview.code);
  return { code: preview.code, link, prompt: promptText(t, link), markdown: preview.markdown, version: preview.version };
}

/** What the link sheet shows: the need is not in this project's view at all, or the box (which may itself be private-only). */
export function linkSheet(live: State, projectId: Id, needId: Id): 'missing' | 'ok' {
  const n = live.needs[needId];
  return n && n.projectId === projectId ? 'ok' : 'missing';
}
