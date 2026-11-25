import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiConfigFromEnv, answerLocale, cleanAnswer, ProjectAi, type AiConfig } from '../src/agents/deepseek';
import { cmd, http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';

const KEY = 'sk-test-0123456789abcdef-never-shown';
/** The user's report, verbatim. */
const SENTENCE = '需要：1. 做一个research talk的slides； 2. 准备一下leetcode的题目';

type Mode = 'ok' | 'fail' | 'hang';

/** An OpenAI-compatible chat completions endpoint that records what it was sent. */
class FakeModel {
  mode: Mode = 'ok';
  /** What the fake answers in `ok` mode; `{first}` is replaced with the first cite id in the request. */
  content = 'Customers asked for a CSV export {first}.';
  /** What the classifier answers, and the extractor's JSON. */
  classifyAs = 'question';
  extractJson = JSON.stringify({ items: [{ type: 'new', text: '1. 做一个 research talk 的 slides' }, { type: 'new', text: '准备一下 leetcode 的题目 · 每天两道' }, { type: 'bogus', text: 'x' }, { type: 'rev', text: '改 N9', needCode: 'N9' }] });
  bodies: string[] = [];
  auth: (string | undefined)[] = [];
  private server!: Server;
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        this.bodies.push(body);
        this.auth.push(req.headers.authorization);
        if (this.mode === 'hang') return void setTimeout(() => res.end('{}'), 2_000);
        if (this.mode === 'fail') {
          res.writeHead(500, { 'content-type': 'application/json' });
          return void res.end('{"error":{"message":"boom"}}');
        }
        const msgs = (JSON.parse(body) as { messages: { content: string }[] }).messages;
        const reply = (content: string) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 } }));
        };
        if (msgs[0]!.content.includes('exactly one word')) return reply(this.classifyAs);
        if (msgs[0]!.content.includes('extract work items')) return reply(this.extractJson);
        const user = msgs[1]!.content;
        const first = /\[(S\d+)\]/.exec(user)?.[1] ?? 'S1';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: this.content.replace('{first}', `[${first}]`) } }],
            usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 },
          }),
        );
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((r) => this.server.close(() => r()));
  }
}

describe('project agent with DeepSeek (agent.ask)', () => {
  const fake = new FakeModel();
  let s: TestServer;
  let team: Team;
  let ai: AiConfig;
  const logs: string[] = [];
  const responses: string[] = [];

  const ask = async (token: string, question: string, projectId: string = 'p1') => {
    const r = await http(s.base, token, 'POST', '/v1/agent/ask', { projectId, question });
    responses.push(JSON.stringify(r.json));
    return r;
  };

  beforeAll(async () => {
    await fake.start();
    ai = aiConfigFromEnv({ MEETLESS_AI_PROVIDER: 'deepseek', MEETLESS_AI_KEY: KEY, MEETLESS_AI_BASE_URL: fake.url })!;
    ai.timeoutMs = 300;
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    s = await withServer({ ai });
    team = await seedTeam(s.base);
  });
  afterEach(() => {
    fake.classifyAs = 'question';
    fake.mode = 'ok';
    fake.content = 'Customers asked for a CSV export {first}.';
  });
  afterAll(async () => {
    await s.stop();
    await fake.stop();
    vi.restoreAllMocks();
  });

  it('me says AI is on, and a free question is answered by the model with the key only in its Authorization header', async () => {
    const me = await http(s.base, TOKENS.lin, 'GET', '/v1/me');
    responses.push(JSON.stringify(me.json));
    expect(me.json.ai).toEqual({ enabled: true, provider: 'deepseek' });

    const r = await ask(TOKENS.lin, 'Why CSV export?');
    expect(r.status).toBe(200);
    expect(r.json.reply).toMatchObject({ source: 'deepseek', simulated: false, provider: 'deepseek/deepseek-chat' });
    expect(r.json.reply.answer.intent).toBe('retrieval');
    expect(r.json.reply.answer.text).toBe('Customers asked for a CSV export.');
    expect(r.json.reply.answer.cites).toEqual([team.needs.N1]);
    expect(fake.auth.at(-1)).toBe(`Bearer ${KEY}`);
    expect(fake.bodies.at(-1)).not.toContain(KEY);
  });

  it("another user's private items never reach the request body", async () => {
    fake.bodies = [];
    await ask(TOKENS.lin, 'What are the dosing notes?');
    expect(fake.bodies).toHaveLength(1);
    expect(fake.bodies[0]).not.toContain(PRIVATE_WORD);
    expect(fake.bodies[0]).not.toContain('Dosing notes');
    expect(fake.bodies[0]).not.toContain(team.needs.Hp1);
    // The owner's own private need is in her own context.
    await ask(TOKENS.alex, 'What are the dosing notes?');
    expect(fake.bodies[1]).toContain(PRIVATE_WORD);
  });

  it('unknown cite ids are dropped, from the text and from the cites', async () => {
    fake.content = 'Export is CSV {first}[S99]. Also see [S42, S77].';
    const r = await ask(TOKENS.lin, 'CSV export?');
    const a = r.json.reply.answer;
    expect(a.text).toBe('Export is CSV. Also see.');
    expect(a.cites).toEqual([team.needs.N1]);
    expect(a.needs.map((n: { needId: string }) => n.needId)).toEqual([team.needs.N1]);
    expect(a.materials).toEqual([]);
  });

  it('a 500 from the model falls back to the rule answer', async () => {
    fake.mode = 'fail';
    const r = await ask(TOKENS.lin, 'CSV export?');
    expect(r.status).toBe(200);
    expect(r.json.reply).toMatchObject({ source: 'rules', fallback: 'error', simulated: true, provider: 'rules/1' });
    expect(r.json.reply.answer.text).toBeUndefined();
    expect(r.json.reply.answer.cites).toContain(team.needs.N1);
  });

  it('a model that does not answer in time falls back to the rule answer', async () => {
    fake.mode = 'hang';
    const r = await ask(TOKENS.lin, 'CSV export?');
    expect(r.json.reply).toMatchObject({ source: 'rules', fallback: 'timeout' });
  });

  it('intents stay with the rules and never call the model', async () => {
    const before = fake.bodies.length;
    const r = await ask(TOKENS.lin, 'what should I do first today');
    expect(r.json.reply).toMatchObject({ source: 'rules', provider: 'rules/1' });
    expect(r.json.reply.fallback).toBeUndefined();
    expect(r.json.reply.answer.intent).toBe('today');
    expect(fake.bodies.length).toBe(before);
  });

  it('a non-member is refused, and so is an empty question', async () => {
    expect((await ask(TOKENS.eve, 'CSV export?')).status).toBe(403);
    expect((await ask(TOKENS.lin, '   ')).status).toBe(400);
  });

  it('the daily token cap is enforced: past it no call is made and the rule answer comes back', async () => {
    const before = fake.bodies.length;
    ai.dailyTokens = 0;
    try {
      const r = await ask(TOKENS.lin, 'CSV export?');
      expect(r.json.reply).toMatchObject({ source: 'rules', fallback: 'budget' });
      expect(fake.bodies.length).toBe(before);
    } finally {
      ai.dailyTokens = 2_000_000;
    }
  });

  it('logs one usage line per call, with counts and no content; the key is in no response and no log line', () => {
    const usage = logs.filter((l) => l.startsWith('[meetless-ai] '));
    expect(usage.length).toBeGreaterThanOrEqual(5);
    const first = JSON.parse(usage[0]!.slice('[meetless-ai] '.length));
    expect(first).toMatchObject({ ev: 'ai.call', ok: true, totalTokens: 1000 });
    for (const l of usage) {
      expect(l).not.toMatch(/CSV|export|zebrafish|Customers/i);
    }
    for (const l of logs) expect(l).not.toContain(KEY);
    for (const r of responses) expect(r).not.toContain(KEY);
    expect(JSON.stringify(ai)).not.toContain(KEY);
  });

  it('content to add is imported into To confirm with DeepSeek extraction, validated', async () => {
    fake.bodies = [];
    const r = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: SENTENCE, messageId: 'm-add1' });
    expect(r.status).toBe(200);
    expect(r.json.reply).toMatchObject({ source: 'deepseek', simulated: false, provider: 'deepseek/deepseek-chat', answer: { intent: 'added', inputId: 'in-m-add1', private: false } });
    // The rules saw an add: no classification call, one extraction call.
    expect(fake.bodies).toHaveLength(1);
    expect(fake.bodies[0]).toContain('extract work items');
    const items = r.json.reply.answer.items as { type: string; text: string }[];
    expect(items.map((x) => [x.type, x.text])).toEqual([
      ['new', '做一个 research talk 的 slides'],
      ['new', '准备一下 leetcode 的题目 每天两道'],
      ['new', '改 N9'],
    ]);
    const input = s.svc.view(IDS.lin).inputs['in-m-add1']!;
    expect(input).toMatchObject({ kind: 'txt', privateTo: null, detector: 'deepseek/deepseek-chat' });
    expect(input.extracts.every((x) => x.state === null)).toBe(true);
    expect(s.svc.view(IDS.zhou).inputs['in-m-add1']).toBeDefined();
  });

  it('accepting them all creates the needs at once', async () => {
    const input = s.svc.view(IDS.lin).inputs['in-m-add1']!;
    for (const [i, x] of input.extracts.entries()) {
      const c = await http(s.base, TOKENS.lin, 'POST', '/v1/commands', cmd('extract.accepted', { inputId: input.id, extractId: x.id, needId: `need-add1-${i}` }));
      expect(c.status).toBe(201);
    }
    const v = s.svc.view(IDS.zhou);
    expect(v.needs['need-add1-0']).toMatchObject({ title: '做一个 research talk 的 slides', privateTo: null, projectId: 'p1' });
    expect(v.needs['need-add1-1']).toBeDefined();
  });

  it('with 「仅自己」 the input, its extracts and the needs they make stay private', async () => {
    const r = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: SENTENCE, messageId: 'm-add2', private: true });
    expect(r.json.reply.answer).toMatchObject({ intent: 'added', private: true });
    expect(s.svc.view(IDS.lin).inputs['in-m-add2']!.privateTo).toBe(IDS.lin);
    expect(s.svc.view(IDS.zhou).inputs['in-m-add2']).toBeUndefined();
    const x = s.svc.view(IDS.lin).inputs['in-m-add2']!.extracts[0]!;
    await http(s.base, TOKENS.lin, 'POST', '/v1/commands', cmd('extract.accepted', { inputId: 'in-m-add2', extractId: x.id, needId: 'need-add2-0' }));
    expect(s.svc.view(IDS.lin).needs['need-add2-0']!.privateTo).toBe(IDS.lin);
    expect(s.svc.view(IDS.zhou).needs['need-add2-0']).toBeUndefined();
  });

  it('a short message the rules cannot place is classified: add goes to To confirm, question to the answer path', async () => {
    fake.classifyAs = 'add';
    const add = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: 'research talk slides', messageId: 'm-add3' });
    expect(add.json.reply.answer.intent).toBe('added');
    fake.classifyAs = 'question';
    const q = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: 'CSV export status', messageId: 'm-q1' });
    expect(q.json.reply).toMatchObject({ source: 'deepseek', answer: { intent: 'retrieval' } });
    expect(s.svc.view(IDS.lin).inputs['in-m-q1']).toBeUndefined();
  });

  it('bad JSON from the extractor falls back to the rule detector', async () => {
    fake.extractJson = 'not json';
    try {
      const r = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: SENTENCE, messageId: 'm-add4' });
      expect(r.json.reply).toMatchObject({ source: 'rules', provider: 'rules/1', answer: { intent: 'added' } });
      expect(r.json.reply.answer.items.map((x: { text: string }) => x.text)).toEqual(['做一个research talk的slides', '准备一下leetcode的题目']);
    } finally {
      fake.extractJson = new FakeModel().extractJson;
    }
  });

  it('with no model configured the rule answer comes back marked not_configured', async () => {
    const r = await new ProjectAi(null).ask(s.svc.view(IDS.lin), { userId: IDS.lin, scope: { kind: 'project', projectId: 'p1' }, text: 'CSV export?', today: TODAY }, 'en');
    expect(r).toMatchObject({ source: 'rules', fallback: 'not_configured', provider: 'rules/1' });
  });
});

describe('content to add with AI off: the rules alone decide', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer();
    await seedTeam(s.base);
  });
  afterAll(async () => {
    await s.stop();
  });

  it('the user sentence yields 2 new extracts in To confirm, through the agent and through New input', async () => {
    const r = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: SENTENCE, messageId: 'm-off1' });
    expect(r.json.reply).toMatchObject({ source: 'rules', provider: 'rules/1', simulated: true, answer: { intent: 'added', inputId: 'in-m-off1' } });
    const x = s.svc.view(IDS.lin).inputs['in-m-off1']!.extracts;
    expect(x.map((e) => [e.type, e.text, e.state])).toEqual([
      ['new', '做一个research talk的slides', null],
      ['new', '准备一下leetcode的题目', null],
    ]);
    const imp = await http(s.base, TOKENS.lin, 'POST', '/v1/projects/p1/inputs', { inputId: 'in-off2', title: 't', kind: 'md', blobHash: null, text: SENTENCE, from: null, date: TODAY, private: false });
    expect(imp.json.extracts).toBe(2);
  });

  it('a real question still gets an answer, not an import', async () => {
    const r = await http(s.base, TOKENS.lin, 'POST', '/v1/agent/ask', { projectId: 'p1', question: '为什么要导出 CSV？', messageId: 'm-off3' });
    expect(r.json.reply.answer.intent).not.toBe('added');
    expect(s.svc.view(IDS.lin).inputs['in-m-off3']).toBeUndefined();
  });
});

describe('aiConfigFromEnv and cleanAnswer', () => {
  it('needs both the provider and a key', () => {
    expect(aiConfigFromEnv({})).toBeNull();
    expect(aiConfigFromEnv({ MEETLESS_AI_PROVIDER: 'deepseek' })).toBeNull();
    expect(aiConfigFromEnv({ MEETLESS_AI_KEY: KEY })).toBeNull();
    const c = aiConfigFromEnv({ MEETLESS_AI_PROVIDER: 'deepseek', MEETLESS_AI_KEY: KEY })!;
    expect(c).toMatchObject({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', dailyTokens: 2_000_000, rate: { limit: 20, windowMs: 600_000 } });
    expect(c.key).toBe(KEY);
    expect(Object.keys(c)).not.toContain('key');
  });

  it('answers in the language of the question; codes and numbers alone keep the account locale', () => {
    expect(answerLocale('为什么要做消融实验？', 'en')).toBe('zh-CN');
    expect(answerLocale('N4 为什么改了', 'en')).toBe('zh-CN');
    expect(answerLocale('Why do we need the ablation study?', 'zh-CN')).toBe('en');
    expect(answerLocale('N4?', 'zh-CN')).toBe('zh-CN');
    expect(answerLocale('N4 Hp2 3/5', 'en')).toBe('en');
    expect(answerLocale('h2 n12', 'zh-CN')).toBe('zh-CN');
  });

  it('takes out markers, markdown, bullets and dots', () => {
    const known = new Set(['S1', 'S2']);
    const out = cleanAnswer('**导出**只做 CSV [S2]【S1】[S9]\n- 第二点 · 细节 [S1、S3]\n• 第三点', known);
    expect(out.ids).toEqual(['S2', 'S1']);
    expect(out.text).toBe('导出只做 CSV\n第二点 细节\n第三点');
  });
});
