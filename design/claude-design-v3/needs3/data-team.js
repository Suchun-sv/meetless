// SIMULATED team project: three roles building a data-export feature for an external client. All fictional.
(function () {
  var c = function (zh, en) { return { 'zh-CN': zh, en: en }; };
  window.NeedsProjects = window.NeedsProjects || [];
  window.NeedsProjects.push({
    id: 'team',
    name: c('Atlas 数据平台 · 导出功能', 'Atlas data platform · Export'),
    kindLabel: c('团队项目 · 3 个岗位', 'Team project · 3 roles'),
    start: '2026-11-02', end: '2026-12-12', today: '2026-11-24',
    people: {
      me: c('你', 'You'),
      lin: c('林安（产品负责人）', 'Lin An (product lead)'),
      ruo: c('沈若（产品）', 'Shen Ruo (product)'),
      ben: c('Ben（研发）', 'Ben (engineering)'),
      zhou: c('周屿（测试）', 'Zhou Yu (QA)'),
      client: c('王经理（客户 A）', 'Mr Wang (Client A)')
    },
    rounds: [
      { n: 1, title: c('需求评审', 'Requirements review'), kind: 'cadence', start: '2026-11-02', due: '2026-11-09', status: 'delivered',
        delivery: { items: [c('需求文档 v1', 'Requirements doc v1')], account: [{ need: 'N1', v: 'met', note: c('字段范围写进 §2', 'Field scope in §2') }],
          feedback: [{ who: 'client', text: c('导出要能按时间筛选。', 'Export should filter by date.'), needs: ['N2'] }] } },
      { n: 2, title: c('内部演示', 'Internal demo'), kind: 'cadence', start: '2026-11-09', due: '2026-11-18', status: 'delivered',
        delivery: { items: [c('演示环境', 'Demo environment'), c('技术方案 v2', 'Technical design v2')], account: [{ need: 'N1', v: 'met', note: c('流式导出，1 万行 22 秒', 'Streaming export, 10k rows in 22 s') }],
          feedback: [{ who: 'lin', text: c('导出要有权限控制。', 'Export needs permission control.'), needs: ['N3'] },
            { who: 'client', text: c('导出文件要带导出人和时间。', 'Files should carry who exported and when.'), needs: ['N4'] }] } },
      { n: 3, title: c('客户交付', 'Client delivery'), kind: 'hard', start: '2026-11-18', due: '2026-11-28', status: 'current',
        delivery: { draft: true, items: [c('导出功能 v1', 'Export v1'), c('操作手册', 'User guide')],
          account: [{ need: 'N2', v: 'partial', note: c('筛选已做，测试中', 'Filter done, in testing') }, { need: 'N3', v: 'todo', note: c('未开始', 'Not started') },
            { need: 'N4', v: 'todo', note: c('未开始', 'Not started') }, { need: 'N5', v: 'partial', note: c('脚本已写，未进 CI', 'Script written, not in CI yet') }] } },
      { n: 4, title: c('二期', 'Phase 2'), kind: 'cadence', start: '2026-11-28', due: '2026-12-12', status: 'planned' }
    ],
    needs: [
      { id: 'N1', kind: 'ext', round: 1, status: 'met', by: 'client', title: c('支持数据导出（12 个核心字段）', 'Data export (12 core fields)'),
        accept: c('可导出 CSV；首版 12 个核心字段', 'CSV export; 12 core fields in v1'),
        source: { src: 'meeting', date: '2026-11-02', quote: c('“我们每月要把客户数据导出来做报表，首版核心字段就够。”', '“We export customer data monthly; core fields are enough for v1.”'), ref: c('需求评审纪要', 'Requirements review notes') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'H1', kind: 'hyp', round: 2, status: 'held', by: 'me', title: c('流式导出能把内存压到 200 MB 内', 'Streaming export keeps memory under 200 MB'),
        expect: c('内存 < 200 MB，耗时 < 30 秒', '< 200 MB, < 30 s'), verify: c('压测 1 万行', 'Load test with 10k rows'), verdict: c('成立：140 MB，22 秒', 'Held: 140 MB, 22 s'),
        source: { src: 'commit', date: '2026-11-10', quote: c('5f2e stream csv export', '5f2e stream csv export'), ref: c('代码库 atlas-export', 'Repo atlas-export') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'H2', kind: 'hyp', round: 2, status: 'refuted', by: 'ben', title: c('加一张缓存表能提速', 'A cache table speeds export up'),
        expect: c('耗时减半', 'Halve the time'), verify: c('压测 1 万行', 'Load test with 10k rows'), verdict: c('不成立：48 → 47 秒，已回退', 'Refuted: 48 → 47 s, reverted'),
        source: { src: 'commit', date: '2026-11-07', quote: c('a13c add export cache table', 'a13c add export cache table'), ref: c('代码库 atlas-export', 'Repo atlas-export') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'N2', kind: 'ext', round: 3, status: 'doing', by: 'client', fromRound: 1, title: c('导出支持按时间筛选', 'Export filters by date'),
        accept: c('选日期范围后只导出该范围；有「最近 7 天」快捷项', 'Only the chosen range is exported; a “last 7 days” shortcut'),
        revisions: [{ date: '2026-11-22', text: c('增加「最近 7 天」快捷项', 'Add a “last 7 days” shortcut'), why: c('王经理邮件 11-22', 'Mr Wang’s email, 11-22'), conf: 'h' }],
        source: { src: 'meeting', date: '2026-11-09', quote: c('“导出要能按时间筛选。”', '“Export should filter by date.”'), ref: c('需求评审反馈', 'Review feedback') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'H3', kind: 'hyp', round: 3, status: 'testing', by: 'ben', parent: 'N2', title: c('加 created_at 索引后筛选仍在 30 秒内', 'With a created_at index, filtered export stays under 30 s'),
        expect: c('筛选不增加耗时', 'No extra time with filtering'), verify: c('带日期条件压测', 'Load test with a date filter'),
        source: { src: 'commit', date: '2026-11-22', quote: c('8d10 add created_at index', '8d10 add created_at index'), ref: c('代码库 atlas-export', 'Repo atlas-export') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'N3', kind: 'ext', round: 3, status: 'todo', by: 'lin', fromRound: 2, title: c('导出需要权限控制', 'Export needs permission control'),
        accept: c('只有管理员能导出备注字段', 'Only admins can export the notes field'),
        source: { src: 'chat', date: '2026-11-18', quote: c('“导出要有权限控制，备注不能谁都能导。”', '“Export needs permissions; not everyone may export notes.”'), ref: c('项目群 · 林安', 'Team chat · Lin An') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'N4', kind: 'ext', round: 3, status: 'todo', by: 'client', fromRound: 2, title: c('导出文件包含导出人和时间', 'Exports carry exporter and time'),
        accept: c('CSV 头部带两个字段', 'CSV header carries both fields'),
        source: { src: 'mail', date: '2026-11-18', quote: c('“导出文件要带导出人和时间。”', '“Files should carry who exported and when.”'), ref: c('客户邮件', 'Client email') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'N5', kind: 'ext', round: 3, status: 'doing', by: 'zhou', title: c('1 万行 30 秒的压测进 CI', '10k-row 30 s load test in CI'),
        accept: c('每次合并自动跑压测', 'Load test runs on every merge'),
        source: { src: 'chat', date: '2026-11-20', quote: c('“性能数字要能复现，压测得进 CI。”', '“Numbers must be reproducible; put the load test in CI.”'), ref: c('项目群 · 周屿', 'Team chat · Zhou Yu') }, conf: { source: 'h', round: 'h', status: 'h' } },
      { id: 'N6', kind: 'ext', round: 4, status: 'moved', by: 'client', title: c('登录支持企业微信', 'Log in with WeCom'),
        accept: c('企业微信扫码登录', 'WeCom QR login'),
        source: { src: 'meeting', date: '2026-11-16', quote: c('“登录最好用企业微信。”', '“Login via WeCom if possible.”'), ref: c('内部演示纪要', 'Demo notes') }, conf: { source: 'h', round: 'h', status: 'h' } }
    ],
    work: [
      { id: 'w1', src: 'meeting', date: '2026-11-02', text: c('需求评审纪要', 'Requirements review notes'), need: 'N1', ef: 'extract', why: c('客户核心需求', 'Core client need'), conf: 'h' },
      { id: 'w2', src: 'commit', date: '2026-11-07', text: c('Ben：a13c add export cache table', 'Ben: a13c add export cache table'), need: 'H2', ef: 'spawn', why: c('Ben 的提速尝试', 'Ben’s speed-up attempt'), conf: 'h' },
      { id: 'w3', src: 'exp', date: '2026-11-08', text: c('压测：48 → 47 秒', 'Load test: 48 → 47 s'), need: 'H2', ef: 'refute', res: 'revert', why: c('几乎没变化', 'Hardly any change'), conf: 'h' },
      { id: 'w4', src: 'commit', date: '2026-11-10', text: c('5f2e stream csv export', '5f2e stream csv export'), need: 'H1', ef: 'spawn', why: c('换流式写出', 'Switch to streaming'), conf: 'h' },
      { id: 'w5', src: 'exp', date: '2026-11-11', text: c('压测：22 秒，140 MB', 'Load test: 22 s, 140 MB'), need: 'H1', ef: 'hold', res: 'keep', why: c('达到预期', 'Meets the expectation'), conf: 'h' },
      { id: 'w6', src: 'commit', date: '2026-11-21', text: c('Ben：c91a date range filter', 'Ben: c91a date range filter'), need: 'N2', ef: 'advance', why: c('筛选接口', 'Filter endpoint'), conf: 'h' },
      { id: 'w7', src: 'commit', date: '2026-11-22', text: c('Ben：8d10 add created_at index', 'Ben: 8d10 add created_at index'), need: 'H3', ef: 'spawn', why: c('为 N2 保性能', 'Keeping N2 fast'), conf: 'h' },
      { id: 'w8', src: 'commit', date: '2026-11-23', text: c('周屿：b210 load test script', 'Zhou Yu: b210 load test script'), need: 'N5', ef: 'advance', why: c('压测脚本', 'Load test script'), conf: 'h' }
    ],
    questions: [],
    metrics: []
  });

  window.NeedsExtra = window.NeedsExtra || {};
  window.NeedsExtra.team = {
    inputs: [
      { id: 'IN3', kind: 'pdf', title: c('客户需求说明书 v2.pdf', 'Client requirements v2.pdf'), from: 'client', date: '2026-11-23', status: 'pending',
        body: [
          { p: c('导出需包含客户的全部字段。', 'Exports must include all customer fields.'), x: 'x1' },
          { p: c('希望支持导出 Excel 格式。', 'Excel export would be welcome.'), x: 'x2' }
        ],
        extracts: [
          { id: 'x1', type: 'rev', need: 'N1', text: c('N1 改为导出全部字段（与现有需求冲突）', 'N1: export all fields (conflicts with the current need)') },
          { id: 'x2', type: 'new', text: c('支持导出 Excel', 'Support Excel export'), accept: c('可选 CSV / XLSX', 'CSV or XLSX selectable') }
        ] },
      { id: 'IN2', kind: 'md', title: c('内部演示纪要.md', 'Internal demo notes.md'), from: 'lin', date: '2026-11-18', status: 'done',
        body: [{ p: c('林安：导出要有权限控制。', 'Lin An: export needs permission control.'), x: 'x1' }],
        extracts: [{ id: 'x1', type: 'new', need: 'N3', state: 'accepted', text: c('导出需要权限控制', 'Export needs permission control') }] },
      { id: 'IN1', kind: 'md', title: c('需求评审纪要.md', 'Requirements review notes.md'), from: 'ruo', date: '2026-11-02', status: 'done',
        body: [{ p: c('客户：每月导出做报表，首版核心字段就够。', 'Client: monthly export for reports; core fields are enough for v1.'), x: 'x1' }],
        extracts: [{ id: 'x1', type: 'new', need: 'N1', state: 'accepted', text: c('支持数据导出', 'Data export') }] }
    ],
    artifacts: [
      { id: 'A1', kind: 'docx', title: c('需求文档', 'Requirements doc'), where: 'Word', needs: ['N1', 'N2', 'N3', 'N4'],
        versions: [{ v: 'v3', date: '2026-11-22', round: 3, note: c('N2 增加快捷项；新增 N3、N4', 'N2 shortcut; added N3, N4') }, { v: 'v1', date: '2026-11-06', round: 1, note: c('初版', 'First version') }],
        pages: [[{ t: 'h', s: '2 导出 / Export' }, { t: 'p', s: '2.1 首版 12 个核心字段 / 12 core fields', n: 'N1' }, { t: 'p', s: '2.2 按时间筛选，含最近 7 天 / date filter, last 7 days', n: 'N2' }, { t: 'p', s: '2.3 备注仅管理员可导出 / notes: admins only', n: 'N3' }]] },
      { id: 'A2', kind: 'code', title: c('代码库 atlas-export', 'Repo atlas-export'), where: 'GitHub', needs: ['N2', 'H3'],
        versions: [{ v: '8d10', date: '2026-11-22', round: 3, note: c('add created_at index', 'add created_at index') }, { v: 'c91a', date: '2026-11-21', round: 3, note: c('date range filter', 'date range filter') }],
        diff: ['@@ api/export/filter.ts', '+export function byRange(q, from, to) {', '+  return q.where("created_at", ">=", from).andWhere("created_at", "<", to);', '+}'] },
      { id: 'A3', kind: 'pptx', title: c('演示 PPT', 'Demo deck'), where: 'PowerPoint', needs: ['N1', 'H1'],
        versions: [{ v: 'v2', date: '2026-11-18', round: 2, note: c('流式导出压测数据', 'Streaming export benchmarks') }],
        pages: [[{ t: 'h', s: '导出 1 万行 22 秒 / 10k rows in 22 s' }, { t: 'fig', s: 'benchmark chart', n: 'H1' }]] }
    ],
    agentLog: [
      { agent: 'cc', tool: 'record_work', arg: 'N2 · filter tests', date: '2026-11-24 11:05' },
      { agent: 'codex', tool: 'get_need_context', arg: 'N3', date: '2026-11-24 10:20' }
    ],
    work: [],
    questions: []
  };
})();
