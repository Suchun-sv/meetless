import { Platform } from 'react-native';
import type { Id } from '@meetless/core';
import type { CcEvent, CcHandoff, CcItem, CcStatus } from './api';

/*
 * A stand-in for S's /cc routes while they do not exist (404) or with `?ccmock=1`. Variants for the
 * other states: `?ccmock=elsewhere` (in use elsewhere), `viewer` (not the owner), `new` (never
 * opened). It keeps a little history per project and streams a turn that stops at a permission card.
 */

const variant = Platform.OS === 'web' && typeof location !== 'undefined' ? (/[?&]ccmock=([a-z]+)/.exec(location.search)?.[1] ?? '1') : '1';

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const HISTORY: CcItem[] = [
  { kind: 'user', id: 'u1', text: '离 VLDB 投稿还差什么？', at: ago(40) },
  { kind: 'tool', id: 't1', name: 'mcp__meetless__needs_list', summary: '当前截止的需求', ok: true, at: ago(40) },
  { kind: 'tool', id: 't2', name: 'Read', summary: 'materials/组会 #2 纪要.md', ok: true, at: ago(40) },
  {
    kind: 'assistant',
    id: 'a1',
    text: '还剩 5 天，4 条外部需求都还没完成。按要紧程度：\nN5 摘要还没改，把 2 倍加速写进第二句就能结掉。\nN7 消融跑了 4/6 组，还差 2 组。\nN6 正文 12.6 页，删 §5.3 后还超 0.6 页，H4 在验证。',
    at: ago(39),
  },
  { kind: 'result', id: 'r1', costUsd: 0.04, at: ago(39) },
];

/** A fixed Markdown reply for `?ccmock=md`: heading, bold, list, a table wider than a phone, code. */
const MD_SAMPLE = [
  '## 离 VLDB 投稿还差什么',
  '还剩 **5 天**，4 条外部需求都还没完成。按要紧程度：',
  '',
  '| 需求 | 状态 | 还差 | 负责人 | 预计 |',
  '|---|---|---|---|---|',
  '| N5 摘要突出 2 倍加速 | 未开始 | 改第二句 | Alex | 0.5 天 |',
  '| N7 补一个消融实验 | 进行中 | 2 组消融 | Mia | 2 天 |',
  '| N6 正文 12 页以内 | 进行中 | 0.6 页 | Alex | 1 天 |',
  '',
  '- 先结掉 *N5*，最快',
  '- `exp-25`、`exp-26` 今晚开跑',
  '',
  '> 删掉 §5.3 后还超 0.6 页，H4 在验证。',
  '',
  '```bash',
  'python run_ablation.py --config exp-25.yaml --seeds 3 --out results/table4.csv',
  '```',
].join('\n');

interface Proj {
  status: CcStatus;
  items: CcItem[];
  waiting: Map<string, (allow: boolean) => void>;
  log: CcEvent[];
  done: boolean;
  stopped: boolean;
}
const projects = new Map<Id, Proj>();

function proj(projectId: Id): Proj {
  let p = projects.get(projectId);
  if (!p) {
    const fresh = variant === 'new';
    p = {
      status: {
        state: variant === 'elsewhere' ? 'in_use_elsewhere' : 'idle',
        detail: variant === 'elsewhere' ? '终端 claude --resume' : undefined,
        owner: variant !== 'viewer',
        session: fresh ? null : { id: 'mock-session', name: 'meetless 项目' },
        repoPath: fresh ? null : '~/github/kvcache-compress',
        turn: null,
        available: true,
      },
      items: fresh ? [] : variant === 'md' ? [...HISTORY.slice(0, 1), { kind: 'assistant', id: 'md1', text: MD_SAMPLE, at: ago(38) }] : HISTORY.map((x) => ({ ...x })),
      waiting: new Map(),
      log: [],
      done: true,
      stopped: false,
    };
    projects.set(projectId, p);
  }
  return p;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The scripted turn: a tool step, some text, a Bash permission, then the answer. */
async function play(pr: Proj, text: string): Promise<void> {
  const emit = (e: CcEvent) => {
    if (!pr.stopped) pr.log.push({ ...e, seq: pr.log.length + 1 });
  };
  pr.status.state = 'running_here';
  if (!pr.status.session) {
    pr.status.session = { id: 'mock-session', name: 'meetless 项目' };
    emit({ type: 'session', sessionId: 'mock-session' });
  }
  const uid = `u${Date.now()}`;
  emit({ type: 'user', id: uid, text });
  pr.items.push({ kind: 'user', id: uid, text, at: now() });
  await wait(400);
  emit({ type: 'tool', id: 'tm1', name: 'Glob', summary: 'repo/**/*.py' });
  await wait(300);
  emit({ type: 'tool_result', id: 'tm1', ok: true });
  const aid = `a${Date.now()}`;
  for (const piece of ['我先看一下仓库里', '有哪些实验脚本，', '需要运行一条命令。']) {
    await wait(250);
    emit({ type: 'text', id: aid, delta: piece });
  }
  const approvalId = `p${Date.now()}`;
  emit({ type: 'tool', id: 'tm2', name: 'Bash', summary: 'ls repo/experiments' });
  emit({ type: 'permission', approvalId, tool: 'Bash', input: 'ls repo/experiments', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  const allow = await new Promise<boolean>((r) => pr.waiting.set(approvalId, r));
  pr.waiting.delete(approvalId);
  emit({ type: 'permission_done', approvalId, behavior: allow ? 'allow' : 'deny' });
  emit({ type: 'tool_result', id: 'tm2', ok: allow });
  const bid = `b${Date.now()}`;
  const reply = allow ? '有 6 组消融配置，exp-21 到 exp-26，前 4 组已有结果文件。' : '好的，不运行命令。我只根据材料回答。';
  for (const piece of reply.match(/.{1,8}/g) ?? []) {
    await wait(120);
    emit({ type: 'text', id: bid, delta: piece });
  }
  pr.items.push({ kind: 'assistant', id: bid, text: reply, at: now() });
  emit({ type: 'result', costUsd: 0.02, durationMs: 4200 });
}

export const mockCc = {
  async call<T>(name: string, input: Record<string, unknown>): Promise<T> {
    const pr = proj(String(input.projectId));
    await wait(80);
    switch (name) {
      case 'cc.status':
        return { ...pr.status } as T;
      case 'cc.history':
        return { items: pr.items.slice(-50), before: null } as T;
      case 'cc.turn': {
        if (!pr.status.owner) throw new Error('NOT_AUTHORISED');
        pr.log = [];
        pr.done = false;
        pr.stopped = false;
        pr.status.turn = { id: 'mock-turn', startedAt: now() };
        void play(pr, String(input.text)).finally(() => {
          pr.done = true;
          pr.status.state = 'idle';
          pr.status.turn = null;
        });
        return { turnId: 'mock-turn', next: 0 } as T;
      }
      case 'cc.events': {
        const after = Number(input.after ?? 0);
        for (let i = 0; i < 20 && pr.log.length <= after && !pr.done; i++) await wait(100);
        return { events: pr.log.slice(after), next: pr.log.length, done: pr.done && pr.log.length <= after + pr.log.slice(after).length } as T;
      }
      case 'cc.cancel':
        pr.stopped = true;
        for (const f of pr.waiting.values()) f(false);
        return { cancelled: true } as T;
      case 'cc.approve':
        pr.waiting.get(String(input.approvalId))?.(input.allow === true);
        return { ok: true } as T;
      case 'cc.handoff': {
        const id = pr.status.session?.id ?? 'SESSION';
        const cd = "ssh -t your-server 'cd ~/meetless/paper && env CLAUDE_CONFIG_DIR=$HOME/meetless/.claude-home ~/.local/bin/claude";
        return {
          commands: [
            { kind: 'terminal', command: `${cd} --resume ${id}'`, note: '在终端里接着这个会话' },
            { kind: 'remote', command: `${cd} --remote-control "meetless 论文" --resume ${id}'`, note: '在 claude.ai 或手机 App 里接着用，需要个人账号登录' },
          ],
        } satisfies CcHandoff as T;
      }
      case 'cc.repo':
        pr.status.repoPath = (input.repoPath as string | null) ?? null;
        return { repoPath: pr.status.repoPath } as T;
    }
    throw new Error(`mock: ${name}`);
  },
};
