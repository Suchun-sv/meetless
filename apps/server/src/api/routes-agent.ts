import { DomainError } from '@meetless/core';
import { answerLocale, MAX_QUESTION_CHARS, ProjectAi } from '../agents/deepseek';
import { ApiError } from './frame';
import type { Handler } from './frame';
import { reqString } from './fields';

const OFF = new ProjectAi(null);

/**
 * `agent.ask`: one question, answered from the caller's own view only (`service.view`, the same
 * privacy filter as sync and MCP). Intents get the rule answer; free questions go to the model
 * when it is configured, else (or when it fails) the rule answer with `fallback`.
 */
const agentAsk: Handler<'agent.ask'> = async ({ p, req, deps }) => {
  const scope = reqString(req.projectId, 'projectId');
  const question = reqString(req.question, 'question').trim();
  if (!question || [...question].length > MAX_QUESTION_CHARS) throw new ApiError('BAD_REQUEST', { field: 'question' });
  if (req.threadId !== undefined) reqString(req.threadId, 'threadId');
  if (scope !== 'home') deps.service.requireMember(p.userId, scope);
  const view = deps.service.view(p.userId);
  const user = view.users[p.userId];
  if (!user) throw new DomainError('NOT_FOUND', 'user not registered');
  const today = deps.cfg.now().toISOString().slice(0, 10);
  const reply = await (deps.ai ?? OFF).ask(
    view,
    { userId: p.userId, scope: scope === 'home' ? { kind: 'home' } : { kind: 'project', projectId: scope }, text: question, today },
    answerLocale(question, user.locale),
  );
  return { reply };
};

/** Project agent handlers: spread into `HANDLERS` in `api/index.ts`. */
export const AGENT_HANDLERS = { 'agent.ask': agentAsk };
