import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiConfigFromEnv, answerLocale, cleanAnswer, ProjectAi, type AiConfig } from '../src/agents/deepseek';
import { http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';

const KEY = 'sk-test-0123456789abcdef-never-shown';

type Mode = 'ok' | 'fail' | 'hang';

/** An OpenAI-compatible chat completions endpoint that records what it was sent. */
class FakeModel {
  mode: Mode = 'ok';
  /** What the fake answers in `ok` mode; `{first}` is replaced with the first cite id in the request. */
  content = 'Customers asked for a CSV export {first}.';
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
        const user = (JSON.parse(body) as { messages: { content: string }[] }).messages[1]!.content;
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

  it('with no model configured the rule answer comes back marked not_configured', async () => {
    const r = await new ProjectAi(null).ask(s.svc.view(IDS.lin), { userId: IDS.lin, scope: { kind: 'project', projectId: 'p1' }, text: 'CSV export?', today: TODAY }, 'en');
    expect(r).toMatchObject({ source: 'rules', fallback: 'not_configured', provider: 'rules/1' });
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
