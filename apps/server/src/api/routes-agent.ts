import { randomUUID } from 'node:crypto';
import { answer, clip, DomainError, isFreeQuestion, looksLikeQuestion, type AgentReply, type Id } from '@meetless/core';
import { answerLocale, MAX_QUESTION_CHARS, ProjectAi } from '../agents/deepseek';
import type { Principal } from '../auth';
import { importInput } from '../imports/import';
import { ApiError } from './frame';
import type { ApiDeps, Handler } from './frame';
import { reqString } from './fields';

const OFF = new ProjectAi(null);

/** The input's title: the first line, list and quote marks dropped, 40 characters. */
function titleFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return clip(line.replace(/^[\s#>*-]+/, ''), 40);
}

/**
 * Text given to add: imported like a typed input (source 消息, the composer's privacy), its
 * extracts waiting in To confirm, answered with the extracts it proposed.
 */
async function addAsInput(deps: ApiDeps, p: Principal, projectId: Id, text: string, messageId: Id, priv: boolean, today: string): Promise<AgentReply> {
  const inputId = `in-${messageId}`;
  await importInput(deps, p, { projectId, inputId, title: titleFrom(text), kind: 'txt', blobHash: null, text, from: null, date: today, private: priv }, { addAll: true });
  const input = deps.service.view(p.userId).inputs[inputId]!;
  const byModel = input.detector.startsWith('deepseek');
  return {
    answer: {
      intent: 'added',
      projectId,
      inputId,
      private: input.privateTo !== null,
      items: input.extracts.map((x) => ({ extractId: x.id, type: x.type, text: x.text, needId: x.needId })),
      cites: [],
    },
    provider: input.detector,
    simulated: !byModel,
    source: byModel ? 'deepseek' : 'rules',
  };
}

/**
 * `agent.ask`: one message, answered from the caller's own view only (`service.view`, the same
 * privacy filter as sync and MCP). In a project, content to add (the rules' `asInput`, or what
 * the model classifies as `add` when the rules cannot tell) is imported into To confirm. Other
 * intents get the rule answer; free questions go to the model when it is configured, else (or
 * when it fails) the rule answer with `fallback`.
 */
const agentAsk: Handler<'agent.ask'> = async ({ p, req, deps }) => {
  const scope = reqString(req.projectId, 'projectId');
  const question = reqString(req.question, 'question').trim();
  if (!question || [...question].length > MAX_QUESTION_CHARS) throw new ApiError('BAD_REQUEST', { field: 'question' });
  if (req.threadId !== undefined) reqString(req.threadId, 'threadId');
  const messageId = req.messageId === undefined ? randomUUID() : reqString(req.messageId, 'messageId');
  if (req.private !== undefined && typeof req.private !== 'boolean') throw new ApiError('BAD_REQUEST', { field: 'private' });
  if (scope !== 'home') deps.service.requireMember(p.userId, scope);
  const view = deps.service.view(p.userId);
  const user = view.users[p.userId];
  if (!user) throw new DomainError('NOT_FOUND', 'user not registered');
  const today = deps.cfg.now().toISOString().slice(0, 10);
  const ai = deps.ai ?? OFF;
  const areq = { userId: p.userId, scope: scope === 'home' ? ({ kind: 'home' } as const) : ({ kind: 'project', projectId: scope } as const), text: question, today };

  if (scope !== 'home') {
    const rules = answer(view, areq);
    let add = rules.answer.intent === 'asInput';
    // The rules could not tell: a short message with no question shape asks the model what it is.
    if (!add && ai.enabled && isFreeQuestion(rules.answer) && !looksLikeQuestion(question)) add = (await ai.classify(p.userId, question)) === 'add';
    if (add) return { reply: await addAsInput(deps, p, scope, question, messageId, req.private === true, today) };
  }
  return { reply: await ai.ask(view, areq, answerLocale(question, user.locale)) };
};

/** Project agent handlers: spread into `HANDLERS` in `api/index.ts`. */
export const AGENT_HANDLERS = { 'agent.ask': agentAsk };
