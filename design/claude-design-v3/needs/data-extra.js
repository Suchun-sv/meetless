// SIMULATED inputs, artifacts and agent activity for both sample projects.
(function () {
  var c = function (zh, en) { return { 'zh-CN': zh, en: en }; };
  window.NeedsExtra = {
    paper: {
      inputs: [
        { id: 'IN5', kind: 'docx', title: c('Mia：消融实验建议.docx', 'Mia: ablation suggestions.docx'), from: 'mia', date: '2026-11-23', status: 'pending',
          body: [
            { p: c('建议消融里加一组：去掉分层缓存，只留压缩。', 'Add one ablation setting: drop the tiered cache, keep compression only.'), x: 'x1' },
            { p: c('我怀疑 batch 太小导致结果波动，可以试 batch=64。', 'I suspect the small batch causes noise; try batch=64.'), x: 'x2' },
            { p: c('表 4 的列顺序和表 2 保持一致会更好读。', 'Table 4 should use the same column order as Table 2.'), x: 'x3' }
          ],
          extracts: [
            { id: 'x1', type: 'rev', need: 'N7', text: c('N7 增加一组：去掉分层缓存', 'N7: add a no-tiering setting') },
            { id: 'x2', type: 'hyp', text: c('batch=64 能让消融结果更稳定', 'batch=64 stabilises ablation results'), expect: c('方差减半', 'Variance halves'), verify: c('同配置跑 3 次', 'Three runs, same setup') },
            { id: 'x3', type: 'new', text: c('表 4 列顺序与表 2 一致', 'Table 4 column order matches Table 2'), accept: c('两表列顺序相同', 'Both tables share column order') }
          ] },
        { id: 'IN4', kind: 'txt', title: c('张老师微信 11-21.txt', 'Prof. Zhang chat 11-21.txt'), from: 'prof', date: '2026-11-21', status: 'done',
          body: [{ p: c('rebuttal 可以先准备个 FAQ。', 'You could start a rebuttal FAQ.'), x: 'x1' }],
          extracts: [{ id: 'x1', type: 'new', need: 'N8', state: 'accepted', text: c('提前准备 rebuttal 常见问题', 'Prepare a rebuttal FAQ early') }] },
        { id: 'IN3', kind: 'txt', title: c('张老师微信 11-18.txt', 'Prof. Zhang chat 11-18.txt'), from: 'prof', date: '2026-11-18', status: 'done',
          body: [{ p: c('X 的召回不好复现，只比延迟就行。', 'X’s recall is hard to reproduce, compare latency only.'), x: 'x1' }],
          extracts: [{ id: 'x1', type: 'rev', need: 'N4', state: 'accepted', text: c('N4 只比延迟', 'N4: latency only') }] },
        { id: 'IN2', kind: 'pdf', title: c('VLDB 2027 征稿要求.pdf', 'VLDB 2027 call for papers.pdf'), from: 'venue', date: '2026-11-12', status: 'done',
          body: [
            { p: c('Papers must not exceed 12 pages, excluding references.', 'Papers must not exceed 12 pages, excluding references.'), x: 'x1' },
            { p: c('Submission deadline: December 1, 2026.', 'Submission deadline: December 1, 2026.'), x: 'x2' },
            { p: c('Supplementary material may be provided as a link.', 'Supplementary material may be provided as a link.') }
          ],
          extracts: [{ id: 'x1', type: 'new', need: 'N6', state: 'accepted', text: c('正文 12 页以内', 'Main text within 12 pages') },
            { id: 'x2', type: 'action', state: 'accepted', text: c('第 3 轮截止日设为 12月1日', 'Round 3 deadline set to Dec 1') }] },
        { id: 'IN1', kind: 'md', title: c('组会 #2 纪要.md', 'Group meeting #2 notes.md'), from: 'me', date: '2026-11-10', status: 'done',
          body: [
            { p: c('张老师：要和 baseline X 比一下。', 'Prof. Zhang: compare with baseline X.'), x: 'x1' },
            { p: c('张老师：摘要里把 2 倍加速说出来。', 'Prof. Zhang: state the 2× speed-up in the abstract.'), x: 'x2' },
            { p: c('Mia：补一个消融实验。', 'Mia: add an ablation study.'), x: 'x3' }
          ],
          extracts: [{ id: 'x1', type: 'new', need: 'N4', state: 'accepted', text: c('和 baseline X 做对比', 'Compare with baseline X') },
            { id: 'x2', type: 'new', need: 'N5', state: 'accepted', text: c('摘要突出 2 倍加速', 'State the 2× speed-up in the abstract') },
            { id: 'x3', type: 'new', need: 'N7', state: 'accepted', text: c('补一个消融实验', 'Add an ablation study') }] }
      ],
      artifacts: [
        { id: 'A1', kind: 'pdf', title: c('论文', 'Paper'), where: 'Overleaf', needs: ['N4', 'N6', 'N7'],
          versions: [
            { v: 'v2', date: '2026-11-23', round: 3, note: c('删除 §5.3；表 3 加入 baseline X', 'Removed §5.3; Table 3 adds baseline X') },
            { v: 'v1', date: '2026-11-10', round: 2, note: c('完整初稿', 'First full draft') }
          ],
          pages: [
            [{ t: 'h', s: 'Tiered Cache Compression for Long-Context Retrieval' }, { t: 'p', s: 'Abstract. Long contexts break existing cache methods. We present a tiered cache that cuts p50 latency by 34% while keeping recall.', n: 'N5' }, { t: 'p', s: '1 Introduction' }, { t: 'fig', s: 'Figure 1' }],
            [{ t: 'p', s: '4 Method — Algorithm 1 and complexity.' }, { t: 'tbl', s: 'Table 3: latency vs. baseline X', n: 'N4' }, { t: 'p', s: '5 Experiments (12.6 pages, 0.6 over)', n: 'N6' }]
          ] },
        { id: 'A2', kind: 'code', title: c('代码库 cache-compress', 'Repo cache-compress'), where: 'GitHub', needs: ['N4', 'N7'],
          versions: [
            { v: 'e3a9', date: '2026-11-23', round: 3, note: c('tweak temperature 0.7', 'tweak temperature 0.7') },
            { v: 'd07f', date: '2026-11-15', round: 3, note: c('baseline X runner', 'baseline X runner') },
            { v: 'b51e', date: '2026-11-04', round: 2, note: c('tiered cache prototype', 'tiered cache prototype') }
          ],
          diff: ['@@ configs/ablation.yaml', '-  temperature: 1.0', '+  temperature: 0.7', '   batch: 16', '   settings: [full, no_compress, no_tier]'] },
        { id: 'A3', kind: 'notion', title: c('实验记录', 'Experiment log'), where: 'Notion', needs: ['N7', 'H2', 'H3'],
          versions: [{ v: c('最新', 'Latest'), date: '2026-11-24', round: 3, note: c('新增 exp-21', 'Added exp-21') }],
          rows: [['exp-21', c('消融 3/5', 'Ablation 3/5'), 'N7'], ['exp-15', c('分层缓存 p50 −34%', 'Tiered cache p50 −34%'), 'H2'], ['exp-12', c('L2 归一化，无提升', 'L2 norm, no gain'), 'H3'], ['exp-03', c('漂移相关 0.83', 'Drift r = 0.83'), 'H1']] },
        { id: 'A4', kind: 'pptx', title: c('组会 slides', 'Meeting slides'), where: 'PowerPoint', needs: ['N1', 'N2'],
          versions: [
            { v: 'v2', date: '2026-11-10', round: 2, note: c('算法与两个数据集结果', 'Algorithm and both datasets') },
            { v: 'v1', date: '2026-10-27', round: 1, note: c('失效分析', 'Failure analysis') }
          ],
          pages: [[{ t: 'h', s: 'Why long contexts break caches' }, { t: 'fig', s: 'Drift vs. recall' }], [{ t: 'h', s: 'Tiered cache' }, { t: 'p', s: 'p50 182 → 120 ms' }]] }
      ],
      agentLog: [
        { agent: 'codex', tool: 'record_work', arg: 'N7 · ablation no_tier', date: '2026-11-24 09:40', pending: true },
        { agent: 'cc', tool: 'get_need_context', arg: 'N4', date: '2026-11-24 09:12' },
        { agent: 'cc', tool: 'read_artifact', arg: 'A1 v2 §4', date: '2026-11-23 22:05' },
        { agent: 'codex', tool: 'list_needs', arg: 'round=3', date: '2026-11-23 21:58' }
      ],
      work: [
        { id: 'w21', src: 'agent', agent: 'codex', date: '2026-11-24', text: c('Codex：补跑消融「去掉分层」', 'Codex: ran the no-tiering ablation'), need: 'N7', ef: 'advance', why: c('Agent 写入，待确认', 'Written by an agent, needs review'), conf: 'l', ask: 'Q4' }
      ],
      questions: [
        { id: 'Q4', q: c('Codex 记录：补跑消融「去掉分层」，关联 N7。', 'Codex logged: ran the no-tiering ablation, linked to N7.'), why: c('Agent 写入默认需要确认。', 'Agent writes need review by default.'),
          options: [{ label: c('接受', 'Accept'), op: { type: 'link', work: 'w21', need: 'N7', ef: 'advance' } }, { label: c('拒绝', 'Reject'), op: { type: 'ignore', work: 'w21' } }] }
      ]
    },
    system: {
      inputs: [
        { id: 'IN3', kind: 'pdf', title: c('客户需求说明书 v2.pdf', 'Client requirements v2.pdf'), from: 'client', date: '2026-11-22', status: 'pending',
          body: [
            { p: c('导出文件需包含导出人和导出时间。', 'Exported files must include who exported them and when.'), x: 'x1' },
            { p: c('希望 12 月中旬前上线企业微信登录。', 'We’d like WeCom login live by mid-December.'), x: 'x2' }
          ],
          extracts: [
            { id: 'x1', type: 'new', text: c('导出文件包含导出人和时间', 'Exports include exporter and time'), accept: c('CSV 头部带两个字段', 'CSV header carries both fields') },
            { id: 'x2', type: 'rev', need: 'N4', text: c('N4 目标时间：12 月中旬', 'N4 target: mid-December') }
          ] },
        { id: 'IN2', kind: 'txt', title: c('客户邮件 11-06.txt', 'Client email 11-06.txt'), from: 'client', date: '2026-11-06', status: 'done',
          body: [{ p: c('演示时希望看到导出真的能跑。', 'We want to see export actually run in the demo.'), x: 'x1' }],
          extracts: [{ id: 'x1', type: 'new', need: 'N2', state: 'accepted', text: c('演示时导出能真实跑通', 'Export runs for real in the demo') }] },
        { id: 'IN1', kind: 'md', title: c('需求会纪要.md', 'Requirements meeting notes.md'), from: 'lin', date: '2026-11-02', status: 'done',
          body: [{ p: c('客户：我们每月要把客户数据导出来做报表。', 'Client: we export customer data every month for reporting.'), x: 'x1' }],
          extracts: [{ id: 'x1', type: 'new', need: 'N1', state: 'accepted', text: c('支持数据导出', 'Support data export') }] }
      ],
      artifacts: [
        { id: 'A1', kind: 'pptx', title: c('方案 PPT', 'Proposal deck'), where: 'PowerPoint', needs: ['N1', 'N2'],
          versions: [{ v: 'v2', date: '2026-11-16', round: 2, note: c('第 7 页改为 12 个字段', 'Slide 7 now says 12 fields') }, { v: 'v1', date: '2026-11-06', round: 1, note: c('初版', 'First version') }],
          pages: [[{ t: 'h', s: '数据导出 / Data export' }, { t: 'p', s: '首版导出 12 个核心字段 / 12 core fields in v1', n: 'N1' }]] },
        { id: 'A2', kind: 'docx', title: c('技术方案', 'Technical design'), where: 'Word', needs: ['N2', 'N5'],
          versions: [{ v: 'v2', date: '2026-11-16', round: 2, note: c('流式导出与压测数据', 'Streaming export and benchmarks') }],
          pages: [[{ t: 'h', s: '3 导出 / Export' }, { t: 'p', s: '3.2 流式写出 CSV，1 万行 22 秒 / streaming CSV, 10k rows in 22 s', n: 'N2' }, { t: 'tbl', s: '压测结果 / Benchmarks', n: 'N5' }]] },
        { id: 'A3', kind: 'code', title: c('代码库 crm-web', 'Repo crm-web'), where: 'GitHub', needs: ['N3'],
          versions: [{ v: '8d10', date: '2026-11-22', round: 3, note: c('add created_at index', 'add created_at index') }, { v: '5f2e', date: '2026-11-10', round: 2, note: c('stream csv export', 'stream csv export') }],
          diff: ['@@ db/migrations/0012_index.sql', '+CREATE INDEX idx_customer_created_at', '+  ON customer (created_at);'] }
      ],
      agentLog: [{ agent: 'cc', tool: 'get_need_context', arg: 'N3', date: '2026-11-23 16:20' }],
      work: [],
      questions: []
    }
  };
})();
