import type { CommitResult, InboxCard, InboxItem, InboxList, InboxMaterial } from './api';

/*
 * A stand-in for S's inbox routes in dev builds only (see api.ts). It holds a few materials like the
 * design's, and plays an analysis for anything added: pages read, a summary typed out, a due date,
 * items one by one, then the routing. `inbox.get` long-polls on `rev` like the server.
 */

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let projects: string[] = [];
/** Materials name projects by placeholder (@P0, @P1, @P2), resolved to the user's real projects when sent. */
const real = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/@P([0-2])/g, (_, i: string) => projects[Number(i)] ?? projects[0] ?? 'p1')) as T;
const store = new Map<string, InboxMaterial>();
let seeded = false;

const zero = { items: 0, projects: 0, duplicates: 0, conflicts: 0 };

function material(m: Partial<InboxMaterial> & Pick<InboxMaterial, 'id' | 'kind' | 'title' | 'source' | 'status'>): InboxMaterial {
  return { addedAt: now(), counts: { ...zero }, projectIds: [], rev: 1, items: [], ...m };
}

function seedStore() {
  if (seeded) return;
  seeded = true;
  const [a, b, c] = ['@P0', '@P1', '@P2'];
  // B6: one material split across two projects, each item with its own project.
  const items: InboxItem[] = [
    { id: 'i1', type: 'need', text: 'TODS 扩展版补一节相关工作', projectId: a },
    { id: 'i2', type: 'need', text: 'Tutorial 讲义 12月10日 前交初稿', projectId: b },
    { id: 'i3', type: 'hyp', text: '扩展版可以只改第 5 节', projectId: a },
    { id: 'i4', type: 'rev', text: 'N6 改成 12 页以内', projectId: a, duplicateOf: `${a}:N6` },
    { id: 'i5', type: 'need', text: 'Tutorial 准备 3 个例子', projectId: b },
  ];
  for (const m of [
    material({ id: 'm-mail', kind: 'mail', title: '陈老师：RE: TODS 扩展版和 Tutorial', source: '邮件', addedAt: ago(90), status: 'ready', counts: { items: 5, projects: 2, duplicates: 1, conflicts: 0 }, projectIds: [a, b], items, summary: '陈老师希望 TODS 扩展版补相关工作，Tutorial 讲义 12月10日 前交初稿。', routing: { candidates: [{ projectId: a, reason: 'TODS 扩展版是这篇论文的期刊版' }, { projectId: b, reason: 'Tutorial 讲义和这个项目的交付有关' }] } }),
    material({ id: 'proposal:mock', kind: 'proposal', title: 'Agent 提议：VLDB 投稿 N6 改成 12 页以内', source: '项目 Agent', addedAt: ago(60 * 14), status: 'ready', counts: { items: 1, projects: 1, duplicates: 0, conflicts: 0 }, projectIds: [a], items: [{ id: 'pr1', type: 'rev', text: 'N6 改成 12 页以内', projectId: a }], routing: { candidates: [{ projectId: a, reason: '项目 Agent 在这个项目里提的' }] } }),
    material({ id: 'm-chat', kind: 'chat', title: '微信：和李同学的聊天', source: '12 条消息', addedAt: ago(2), status: 'analyzing', stage: 'extracting', progress: null }),
    material({ id: 'm-pdf', kind: 'pdf', title: '作业4_批改要求.pdf', source: 'PDF 6 页', addedAt: ago(60 * 20), status: 'committed', counts: { items: 3, projects: 1, duplicates: 0, conflicts: 0 }, projectIds: [c], committed: { projectIds: [c], count: 3 } }),
    material({ id: 'm-empty', kind: 'image', title: '截图 11月27日', source: '图片', addedAt: ago(60 * 30), status: 'empty' }),
    // For A2's review shots: B3 (one project, a duplicate and a due conflict), B7 (a new project), a failure.
    material({
      id: 'm-b3',
      kind: 'pdf',
      title: '组会 #3 纪要.pdf',
      source: 'PDF 6 页',
      addedAt: ago(30),
      status: 'ready',
      pages: 6,
      counts: { items: 4, projects: 1, duplicates: 1, conflicts: 1 },
      projectIds: [a],
      summary: '组会决定先补 baseline X 对比，投稿日期提前到 11月30日。',
      due: { date: '2026-11-30', quote: '原文第 1 页：「投稿提前到 11 月 30 日」' },
      items: [
        { id: 'b3-1', type: 'need', text: '和 baseline X 做对比', duplicateOf: `${a}:N4` },
        { id: 'b3-2', type: 'rev', text: 'VLDB 投稿提前到 11月30日', conflict: { needId: `${a}:N4`, field: 'due', old: '2026-12-02', new: '2026-11-30' } },
        { id: 'b3-3', type: 'hyp', text: '分层缓存在 32k 以上才有收益' },
        { id: 'b3-4', type: 'need', text: '补充 32k 上下文的实验' },
      ],
      routing: {
        candidates: [
          { projectId: a, reason: '提到 N4 和 baseline X 做对比，是这个项目的需求', reasonBold: ['N4 和 baseline X 做对比'] },
          { projectId: b, reason: '也提到了导出数据的实验' },
        ],
      },
    }),
    material({
      id: 'm-b7',
      kind: 'chat',
      title: '微信：王老师',
      source: '3 条消息',
      addedAt: ago(45),
      status: 'ready',
      counts: { items: 2, projects: 1, duplicates: 0, conflicts: 0 },
      summary: '王老师请你做学院开放日的海报，下周六前给初稿。',
      due: { date: '2026-12-05', quote: '「下周六之前给我个初稿就行」' },
      items: [
        { id: 'b7-1', type: 'need', text: '开放日海报初稿', projectId: null },
        { id: 'b7-2', type: 'need', text: '海报放三个研究方向', projectId: null },
      ],
      routing: { candidates: [], newProject: { name: '学院开放日海报', reason: '和你现有的项目都不相关', firstRound: { title: '海报初稿', due: '2026-12-05', quote: '下周六之前给我个初稿就行' } } },
    }),
    material({ id: 'm-failed', kind: 'image', title: '扫描件 作业说明', source: '图片', addedAt: ago(60 * 3), status: 'failed', error: { code: 'UNREADABLE', message: '扫描件太模糊' } }),
  ])
    store.set(m.id, m);
  void play(store.get('m-chat')!, false);
}

function card(m: InboxMaterial): InboxCard {
  const { rev: _r, summary: _s, due: _d, items: _i, routing: _ro, sizeBytes: _z, pages: _p, ...c } = m;
  return c;
}

function bump(m: InboxMaterial, patch: Partial<InboxMaterial>) {
  Object.assign(m, patch, { rev: m.rev + 1 });
}

/** The scripted analysis: reading pages, typing the summary, the due date, items one by one, routing, done. */
async function play(m: InboxMaterial, paged: boolean) {
  const pages = paged ? 6 : 0;
  bump(m, { status: 'analyzing', stage: 'reading', progress: paged ? { page: 1, pages } : null, pages: paged ? pages : undefined });
  for (let p = 2; p <= pages; p++) {
    await wait(500);
    bump(m, { progress: { page: p, pages } });
  }
  await wait(400);
  bump(m, { stage: 'extracting' });
  const summary = '第 4 次作业的批改要求：共 48 份报告，按评分表打分并写评语，12月10日 前在课程系统提交成绩。';
  for (let i = 0; i < summary.length; i += 6) {
    await wait(120);
    bump(m, { summary: summary.slice(0, i + 6) });
  }
  await wait(300);
  bump(m, { due: { date: '2026-12-10', quote: '原文第 2 页：「请于 12 月 10 日（周四）23:59 前提交成绩」' } });
  for (const it of [
    { id: 'n1', type: 'need', text: '批改 48 份报告' },
    { id: 'n2', type: 'need', text: '每份报告写 3 行以上评语' },
    { id: 'n3', type: 'need', text: '12月10日 前在课程系统提交成绩' },
  ] satisfies InboxItem[]) {
    await wait(700);
    bump(m, { items: [...m.items, it] });
  }
  bump(m, { stage: 'routing' });
  await wait(1500);
  const pid = '@P2';
  bump(m, {
    status: 'ready',
    stage: 'done',
    progress: null,
    counts: { items: m.items.length, projects: 1, duplicates: 0, conflicts: 0 },
    projectIds: [pid],
    routing: { candidates: [{ projectId: pid, reason: '课程作业的批改，和这个项目的截止一致' }] },
  });
}

export const mockInbox = {
  seed(ids: string[]) {
    if (ids.length) projects = ids;
  },
  async call<T>(name: string, input: Record<string, unknown>): Promise<T> {
    seedStore();
    await wait(80);
    const id = String(input.materialId ?? '');
    const m = store.get(id);
    switch (name) {
      case 'inbox.list': {
        const all = [...store.values()].sort((x, y) => y.addedAt.localeCompare(x.addedAt));
        const pending = all.filter((x) => x.status === 'ready').map(card);
        const recent = all.filter((x) => x.status !== 'ready').map(card);
        return real({ pending, recent, older: 0, badge: pending.length } satisfies InboxList) as T;
      }
      case 'inbox.get': {
        if (!m) throw new Error('NOT_FOUND');
        const rev = typeof input.rev === 'number' ? input.rev : -1;
        for (let i = 0; i < 40 && m.status === 'analyzing' && m.rev <= rev; i++) await wait(100);
        return real({ ...m, items: [...m.items] }) as T;
      }
      case 'inbox.add': {
        const nid = `m-${Date.now()}`;
        const isFile = typeof input.blobHash === 'string';
        const name = String(input.fileName ?? '');
        const kind = !isFile ? 'text' : /pdf/.test(String(input.mediaType)) ? 'pdf' : /image/.test(String(input.mediaType)) ? 'image' : 'docx';
        const title = isFile ? name || '文件' : String(input.text ?? '').split('\n')[0]!.slice(0, 30) || '粘贴的文字';
        const nm = material({ id: nid, kind, title, source: kind === 'text' ? '粘贴' : kind === 'pdf' ? 'PDF' : kind === 'image' ? '图片' : '文档', status: 'analyzing', ...(isFile ? { sizeBytes: 1_200_000 } : {}) });
        store.set(nid, nm);
        void play(nm, kind === 'pdf');
        return { id: nid, rev: nm.rev, existing: false } as T;
      }
      case 'inbox.commit': {
        if (!m) throw new Error('NOT_FOUND');
        const pids = real(m.projectIds.length ? m.projectIds : ['@P0']);
        bump(m, { status: 'committed', committed: { projectIds: pids, count: m.counts.items || m.items.length } });
        return { batchId: `b-${Date.now()}`, projectIds: pids, created: m.counts.items || m.items.length, merged: 0, changedDue: 1, undoUntil: new Date(Date.now() + 7 * 864e5).toISOString() } satisfies CommitResult as T;
      }
      case 'inbox.undo':
        if (m) bump(m, { status: 'ready', committed: undefined });
        return { ok: true } as T;
      case 'inbox.retry':
        if (m) void play(m, m.kind === 'pdf');
        return { rev: m?.rev ?? 0 } as T;
      case 'inbox.remove':
        store.delete(id);
        return { ok: true } as T;
    }
    throw new Error(`mock: ${name}`);
  },
};
