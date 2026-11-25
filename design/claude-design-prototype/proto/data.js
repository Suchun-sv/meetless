// Meetless prototype — SIMULATED project data (PRD §13 scenario). Not real customer data.
// Content keeps its original language (src); the other language is an AI-derived translation, labelled in the UI.
(function () {
  function c(src, zh, en) { var o = { src: src }; o['zh-CN'] = zh; o.en = en; return o; }

  var people = {
    lin: { name: 'Lin An', initials: 'LA', roles: ['sales'], lang: 'zh-CN' },
    ben: { name: 'Ben Carter', initials: 'BC', roles: ['tech'], lang: 'en' },
    zhou: { name: 'Zhou Yu', initials: 'ZY', roles: ['tech', 'sales'], lang: 'zh-CN' }
  };
  var roles = {
    sales: c('zh-CN', '需求／销售', 'Requirements / Sales'),
    tech: c('zh-CN', '技术／交付', 'Engineering / Delivery')
  };

  var project = {
    name: c('zh-CN', '客户管理系统首版交付', 'CRM v1 delivery'),
    client: c('zh-CN', '客户 A', 'Client A'),
    tz: 'Europe/London'
  };
  var otherProjects = [c('zh-CN', '客户 B 数据迁移', 'Client B data migration'), c('en', '内部工具升级', 'Internal tooling refresh')];

  // Artifact content per version. Anchors: slide / paragraph / file+lines.
  var artifacts = {
    ppt: { kind: 'pptx', file: 'Client-A-proposal.pptx', title: c('zh-CN', '客户提案', 'Client proposal'), owner: 'lin' },
    doc: { kind: 'docx', file: 'Export-design.docx', title: c('zh-CN', '导出方案', 'Export design'), owner: 'ben' },
    code: { kind: 'code', file: 'crm-web', title: c('en', '代码仓库 crm-web', 'Repository crm-web'), owner: 'ben' }
  };
  var versions = {
    'ppt.3': { art: 'ppt', n: 3, hash: 'sha256:7c1e…9a40', by: 'lin', summary: c('zh-CN', '新增第 7 页「数据导出」', 'Added slide 7 "Data export"'),
      slides: [
        { n: 6, title: c('zh-CN', '客户画像与标签', 'Customer profiles & tags') },
        { n: 7, title: c('zh-CN', '数据导出', 'Data export'), body: c('zh-CN', '支持导出全部客户字段，一键生成 CSV。', 'Export every customer field to CSV in one click.'), issue: 'I-1' },
        { n: 8, title: c('zh-CN', '上线计划', 'Rollout plan') },
        { n: 9, title: c('zh-CN', '性能指标（图表）', 'Performance (chart)'), unparsed: true }
      ] },
    'ppt.4': { art: 'ppt', n: 4, parent: 'ppt.3', hash: 'sha256:d03b…11f2', by: 'lin', summary: c('zh-CN', '第 7 页改为「12 个核心字段」，引用决定 D-5', 'Slide 7 now says "12 core fields", citing decision D-5'),
      slides: [
        { n: 6, title: c('zh-CN', '客户画像与标签', 'Customer profiles & tags') },
        { n: 7, title: c('zh-CN', '数据导出', 'Data export'), body: c('zh-CN', '首版支持导出 12 个核心客户字段（见方案 §3.2），其余字段列入下一期。', 'v1 exports 12 core customer fields (see design §3.2); other fields are planned for the next phase.'), changed: true },
        { n: 8, title: c('zh-CN', '上线计划', 'Rollout plan') },
        { n: 9, title: c('zh-CN', '性能指标（图表）', 'Performance (chart)'), unparsed: true }
      ] },
    'doc.2': { art: 'doc', n: 2, hash: 'sha256:41aa…c7e9', by: 'ben', summary: c('en', '补充导出字段白名单', 'Added export field allow-list'),
      paras: [
        { n: '3.1', text: c('en', '导出任务异步执行，完成后通知用户下载。', 'Exports run as background jobs; users are notified when the file is ready.') },
        { n: '3.2', text: c('en', '仅导出 12 个字段：姓名、公司、邮箱、电话……备注和附件不导出。', 'Only 12 fields are exported: name, company, email, phone, … Notes and attachments are excluded.'), issue: 'I-1' },
        { n: '3.3', text: c('en', '单次导出上限 1 万行。', 'A single export is capped at 10,000 rows.'), issue: 'I-2' }
      ] },
    'doc.3': { art: 'doc', n: 3, parent: 'doc.2', hash: 'sha256:9be0…3d18', by: 'ben', summary: c('en', '§3.3 补充性能验证方法', 'Added performance verification method to §3.3'),
      paras: [
        { n: '3.1', text: c('en', '导出任务异步执行，完成后通知用户下载。', 'Exports run as background jobs; users are notified when the file is ready.') },
        { n: '3.2', text: c('en', '仅导出 12 个字段：姓名、公司、邮箱、电话……备注和附件不导出。', 'Only 12 fields are exported: name, company, email, phone, … Notes and attachments are excluded.') },
        { n: '3.3', text: c('en', '单次导出上限 1 万行；以 1 万行样本在预发环境计时，要求 30 秒内完成。', 'A single export is capped at 10,000 rows; timed on staging with a 10,000-row sample, it must finish within 30 s.'), changed: true }
      ] },
    'code.3f9a21c': { art: 'code', n: '3f9a21c', hash: 'git:3f9a21c', by: 'ben', summary: c('en', '导出接口与字段白名单', 'Export endpoint and field allow-list'),
      path: 'src/export/fields.ts', lines: '12–40', branch: 'feature/export', pr: '#118',
      diff: [
        { k: '+', t: 'export const EXPORT_FIELDS = [' },
        { k: '+', t: "  'name', 'company', 'email', 'phone'," },
        { k: '+', t: "  'title', 'city', 'owner', 'stage'," },
        { k: '+', t: "  'source', 'createdAt', 'updatedAt', 'tags'," },
        { k: '+', t: '] as const; // 12 fields — notes/attachments excluded' }
      ] }
  };

  var requirement = {
    id: 'R-12', title: c('zh-CN', '支持数据导出', 'Support data export'),
    acc1: c('zh-CN', '可导出 CSV；1 万行内 30 秒完成', 'Export to CSV; 10,000 rows within 30 s'),
    acc2: c('zh-CN', '可导出 CSV；字段限 12 个核心字段（D-5）；1 万行内 30 秒完成', 'Export to CSV; limited to 12 core fields (D-5); 10,000 rows within 30 s')
  };

  var issues = {
    'I-1': { sev: 'block', agent: 'sales', title: c('zh-CN', '对外承诺与实现范围不一致', 'External claim does not match implemented scope'),
      where: c('zh-CN', '提案 v3 · 第 7 页', 'Proposal v3 · slide 7'),
      evidence: c('zh-CN', 'PPT 称「支持导出全部客户字段」；方案 v2 §3.2 与 crm-web@3f9a21c src/export/fields.ts L12–40 只支持 12 个字段。', 'Slide says "export every customer field"; design v2 §3.2 and crm-web@3f9a21c src/export/fields.ts L12–40 support only 12 fields.'),
      rule: 'sales-claims v1.3 · SC-04', owner: 'lin' },
    'I-2': { sev: 'warn', agent: 'tech', title: c('en', '验收条件缺少可执行的验证方法', 'Acceptance criterion lacks a verification method'),
      where: c('en', '方案 v2 · §3.3', 'Design v2 · §3.3'),
      evidence: c('en', 'R-12 要求「1 万行 30 秒」，方案未说明如何测量。', 'R-12 requires "10,000 rows in 30 s"; the design does not say how this is measured.'),
      rule: 'export-review v2.0 · ER-07', owner: 'ben' }
  };

  var decision = {
    id: 'D-5', text: c('zh-CN', '首版导出限定 12 个核心字段，其余字段列入 R-15 下一期。', 'v1 export is limited to 12 core fields; the rest moves to R-15 for the next phase.'),
    by: 'lin', source: 'M-1'
  };

  var meetings = {
    'M-1': { id: 'M-1', title: c('zh-CN', '导出范围评审', 'Export scope review'), purpose: c('zh-CN', '解决 I-1：对外承诺是「全部字段」，实现是 12 个字段，定下首版范围。', 'Resolve I-1: the external claim is "all fields", the implementation has 12; settle v1 scope.'),
      attendees: ['lin', 'ben', 'zhou'], refs: ['ppt.3', 'doc.2', 'code.3f9a21c'],
      notes: [
        { who: 'ben', text: c('en', '备注和附件字段含敏感信息，导出前需要单独的权限设计。', 'Notes and attachments contain sensitive data and need their own permission design before export.') },
        { who: 'zhou', text: c('zh-CN', '全字段导出至少要再加两周，赶不上月底交付。', 'Full-field export needs at least two more weeks and would miss the end-of-month delivery.') },
        { who: 'lin', text: c('zh-CN', '客户电话里提过先要核心字段，可以接受分期。', 'The client said on a call that core fields come first; phasing is acceptable.') }
      ],
      outcomes: [
        { k: 'decision', ref: 'D-5', text: decision.text, who: 'lin' },
        { k: 'action', text: c('zh-CN', '修改提案第 7 页并引用 D-5', 'Revise proposal slide 7 and cite D-5'), who: 'lin' },
        { k: 'action', text: c('en', '在方案 §3.3 补充性能验证方法', 'Add performance verification method to design §3.3'), who: 'ben' },
        { k: 'lean', text: c('en', '下一期可能按角色控制备注导出', 'Next phase may gate notes export by role'), who: 'ben' }
      ] },
    'M-0': { id: 'M-0', title: c('zh-CN', '客户 A 电话沟通', 'Client A call'), purpose: c('zh-CN', '了解客户对导出的实际用法', 'Understand how the client actually uses exports'),
      attendees: ['lin'], refs: [], late: true,
      notes: [{ who: 'lin', text: c('zh-CN', '客户主要用导出做月度报表，只用到基本联系信息。', 'The client mainly uses exports for monthly reports and only needs basic contact info.') }],
      outcomes: [{ k: 'fact', text: c('zh-CN', '客户月报只需基本联系字段', 'Client monthly reports only need basic contact fields'), who: 'lin' }] }
  };

  var skills = [
    { id: 'sales-claims', name: c('zh-CN', '对外承诺一致性', 'External claim consistency'), role: 'sales', maintainer: 'lin', scope: c('zh-CN', 'PPT、对外文档', 'Slides, client-facing documents'),
      versions: [
        { v: '1.3', status: 'retired', rules: [
          { id: 'SC-04', sev: 'block', text: c('zh-CN', '对外材料中的能力表述必须与已发布方案及代码一致', 'Capability claims in client material must match the published design and code') },
          { id: 'SC-05', sev: 'warn', text: c('zh-CN', '涉及期限的承诺需引用已确认的计划', 'Commitments with dates must cite a confirmed plan') }
        ] },
        { v: '1.4', status: 'active', rules: [
          { id: 'SC-04', sev: 'block', text: c('zh-CN', '对外材料中的能力表述必须与已发布方案及代码一致', 'Capability claims in client material must match the published design and code') },
          { id: 'SC-05', sev: 'warn', text: c('zh-CN', '涉及期限的承诺需引用已确认的计划', 'Commitments with dates must cite a confirmed plan') },
          { id: 'SC-06', sev: 'warn', added: true, text: c('zh-CN', '出现「全部」「所有」等全称表述时，必须引用对应方案条目', 'Universal wording ("all", "every") must cite the matching design section') }
        ] }
      ] },
    { id: 'export-review', name: c('en', '导出功能技术评审', 'Export feature technical review'), role: 'tech', maintainer: 'ben', scope: c('en', '方案文档、代码', 'Design documents, code'),
      versions: [{ v: '2.0', status: 'active', rules: [
        { id: 'ER-03', sev: 'block', text: c('en', '导出字段必须有显式白名单', 'Exported fields must come from an explicit allow-list') },
        { id: 'ER-07', sev: 'warn', text: c('en', '性能类验收条件必须写明测量方法', 'Performance acceptance criteria must state how they are measured') }
      ] }] }
  ];

  // Events in server-accepted order (seq). recordedAt = when the sync service accepted it; occurredAt = business time when different.
  var events = [
    { seq: 1, type: 'project', at: '2026-11-02T09:30:00Z', who: 'lin', label: c('zh-CN', '创建项目与岗位', 'Project and roles created') },
    { seq: 2, type: 'requirement', at: '2026-11-03T10:15:00Z', who: 'lin', label: c('zh-CN', 'R-12 支持数据导出', 'R-12 Support data export') },
    { seq: 3, type: 'change', at: '2026-11-03T10:20:00Z', who: 'ben', label: c('en', 'C-24 客户数据导出', 'C-24 Customer data export') },
    { seq: 4, type: 'publish', at: '2026-11-05T14:02:00Z', who: 'ben', label: c('en', '提案 v3 · 方案 v2 · crm-web@3f9a21c', 'Proposal v3 · Design v2 · crm-web@3f9a21c') },
    { seq: 5, type: 'agent', at: '2026-11-05T14:06:00Z', who: 'agent', label: c('zh-CN', '1 项阻塞 · 1 项警告', '1 blocking · 1 warning') },
    { seq: 6, type: 'review', at: '2026-11-06T11:00:00Z', who: 'ben', label: c('en', '评审第 1 轮', 'Review round 1') },
    { seq: 7, type: 'approve', at: '2026-11-06T16:20:00Z', who: 'zhou', label: c('zh-CN', 'Zhou Yu 批准第 1 轮（技术）', 'Zhou Yu approved round 1 (engineering)') },
    { seq: 8, type: 'meeting', at: '2026-11-07T15:00:00Z', who: 'lin', label: c('zh-CN', 'M-1 导出范围评审', 'M-1 Export scope review') },
    { seq: 9, type: 'decision', at: '2026-11-07T17:30:00Z', who: 'lin', label: c('zh-CN', 'D-5 首版限 12 个核心字段', 'D-5 v1 limited to 12 core fields') },
    { seq: 10, type: 'import', at: '2026-11-08T09:40:00Z', occurredAt: '2026-11-04T15:00:00Z', who: 'lin', label: c('zh-CN', 'M-0 客户 A 电话（补录）', 'M-0 Client A call (imported late)') },
    { seq: 11, type: 'publish', at: '2026-11-09T13:10:00Z', who: 'lin', label: c('zh-CN', '提案 v4 · 方案 v3', 'Proposal v4 · Design v3') },
    { seq: 12, type: 'agent', at: '2026-11-09T13:14:00Z', who: 'agent', label: c('zh-CN', '无阻塞 · 1 项建议', 'No blockers · 1 suggestion') },
    { seq: 13, type: 'stale', at: '2026-11-09T13:20:00Z', who: 'agent', label: c('zh-CN', '方案 v2 的重跑晚到，标记过期', 'Late rerun for design v2 marked stale') },
    { seq: 14, type: 'review', at: '2026-11-10T10:00:00Z', who: 'ben', label: c('en', '评审第 2 轮', 'Review round 2') },
    { seq: 15, type: 'approve', at: '2026-11-10T15:30:00Z', who: 'zhou', label: c('zh-CN', '第 2 轮必需评审完成', 'Round 2 required reviews complete') },
    { seq: 16, type: 'baseline', at: '2026-11-12T15:00:00Z', who: 'lin', label: c('zh-CN', '基线 B-3 确认', 'Baseline B-3 confirmed') },
    { seq: 17, type: 'delivery', at: '2026-11-14T11:00:00Z', who: 'ben', label: c('en', '交付包 P-1 交付给客户 A', 'Package P-1 delivered to Client A') },
    { seq: 18, type: 'accept', at: '2026-11-17T10:00:00Z', who: 'lin', label: c('zh-CN', '客户 A 验收通过', 'Client A accepted') },
    { seq: 19, type: 'skill', at: '2026-11-18T09:00:00Z', who: 'lin', label: c('zh-CN', 'sales-claims v1.3 → v1.4', 'sales-claims v1.3 → v1.4') }
  ];

  // Derive project state from events with seq <= cut. Pure function of the event log, so every client
  // (whatever its language) that replays to the same seq gets the same state.
  function stateAt(cut) {
    var s = {
      cut: cut, exists: cut >= 1, hasReq: false, hasChange: false,
      working: {}, confirmed: {}, prev: {}, acc: null,
      decisions: [], open: [], resolvedLater: [], runs: [], rounds: [], meetings: [],
      baseline: null, delivery: null, skillActive: { 'sales-claims': '1.3', 'export-review': '2.0' },
      status: null, reasons: []
    };
    if (cut >= 2) { s.hasReq = true; s.acc = requirement.acc1; }
    if (cut >= 3) { s.hasChange = true; s.status = 'making'; }
    if (cut >= 4) { s.working = { ppt: 'ppt.3', doc: 'doc.2', code: 'code.3f9a21c' }; }
    if (cut >= 5) {
      s.runs.push({ id: 'AR-31', agent: 'sales', skill: 'sales-claims v1.3', input: ['ppt.3', 'doc.2', 'code.3f9a21c'], cut: 4, status: 'done', issues: ['I-1'], model: 'claude-sonnet-5 (simulated)', lang: 'zh-CN' });
      s.runs.push({ id: 'AR-32', agent: 'tech', skill: 'export-review v2.0', input: ['doc.2', 'code.3f9a21c', 'ppt.3'], cut: 4, status: 'partial', issues: ['I-2'], uncovered: true, model: 'claude-sonnet-5 (simulated)', lang: 'en' });
      s.open.push({ id: 'I-1', owner: 'lin' }, { id: 'I-2', owner: 'ben' });
    }
    if (cut >= 6) {
      s.status = 'review';
      s.rounds.push({ id: 1, manifest: ['ppt.3', 'doc.2', 'code.3f9a21c'], basis: ['R-12 rev1'], approvals: [{ who: 'zhou', state: 'pending' }, { who: 'lin', state: 'pending' }] });
    }
    if (cut >= 7) { s.rounds[0].approvals[0].state = 'approved'; }
    if (cut >= 8) { s.meetings.push('M-1'); s.open.push({ id: 'M-1-outcomes', owner: 'lin', meeting: true }); }
    if (cut >= 9) {
      s.decisions.push('D-5'); s.acc = requirement.acc2;
      s.open = s.open.filter(function (o) { return o.id !== 'M-1-outcomes'; });
      s.rounds[0].basisChanged = true;
      s.rounds[0].approvals.forEach(function (a) { if (a.state === 'approved') a.state = 'void'; });
      s.status = 'revise';
      s.open.push({ id: 'A-1', owner: 'lin', action: true }, { id: 'A-2', owner: 'ben', action: true });
      s.reasons.push({ what: c('zh-CN', 'R-12 验收条件收窄为 12 个核心字段', 'R-12 acceptance narrowed to 12 core fields'), src: 'D-5 · M-1' });
    }
    if (cut >= 10) { s.meetings.push('M-0'); }
    if (cut >= 11) {
      s.prev = { ppt: 'ppt.3', doc: 'doc.2' };
      s.working.ppt = 'ppt.4'; s.working.doc = 'doc.3';
      s.reasons.push({ what: c('zh-CN', '提案第 7 页改写，方案 §3.3 补充验证方法', 'Proposal slide 7 rewritten; design §3.3 gained a verification method'), src: 'D-5 · A-1 · A-2' });
      s.open = s.open.filter(function (o) { return !o.action; });
    }
    if (cut >= 12) {
      s.runs.unshift({ id: 'AR-40', agent: 'sales', skill: 'sales-claims v1.3', input: ['ppt.4', 'doc.3', 'code.3f9a21c'], cut: 11, status: 'done', issues: [], model: 'claude-sonnet-5 (simulated)', lang: 'zh-CN' });
      s.runs.unshift({ id: 'AR-41', agent: 'tech', skill: 'export-review v2.0', input: ['doc.3', 'code.3f9a21c', 'ppt.4'], cut: 11, status: 'partial', issues: [], uncovered: true, model: 'claude-sonnet-5 (simulated)', lang: 'en' });
      s.open = s.open.filter(function (o) { return o.id !== 'I-1' && o.id !== 'I-2'; });
    }
    if (cut >= 13) { s.runs.push({ id: 'AR-35', agent: 'tech', skill: 'export-review v2.0', input: ['doc.2'], cut: 4, status: 'stale', staleFor: 'doc.2', issues: [], model: 'claude-sonnet-5 (simulated)', lang: 'en' }); }
    if (cut >= 14) {
      s.status = 'review';
      s.rounds.unshift({ id: 2, manifest: ['ppt.4', 'doc.3', 'code.3f9a21c'], basis: ['R-12 rev2', 'D-5'], approvals: [{ who: 'zhou', state: 'pending' }, { who: 'lin', state: 'pending' }] });
    }
    if (cut >= 15) { s.rounds[0].approvals.forEach(function (a) { a.state = 'approved'; }); s.status = 'final'; }
    if (cut >= 16) { s.status = 'confirmed'; s.baseline = { id: 'B-3', items: ['ppt.4', 'doc.3', 'code.3f9a21c'], decisions: ['D-5'] }; s.confirmed = { ppt: 'ppt.4', doc: 'doc.3', code: 'code.3f9a21c' }; }
    if (cut >= 17) { s.delivery = { id: 'P-1', state: 'delivered' }; s.status = 'delivered'; s.open.push({ id: 'ACC', owner: 'lin', accept: true }); }
    if (cut >= 18) { s.delivery.state = 'accepted'; s.open = s.open.filter(function (o) { return !o.accept; }); }
    if (cut >= 19) { s.skillActive['sales-claims'] = '1.4'; }
    return s;
  }

  window.MeetlessMock = { people: people, roles: roles, project: project, otherProjects: otherProjects, artifacts: artifacts, versions: versions,
    requirement: requirement, issues: issues, decision: decision, meetings: meetings, skills: skills, events: events, stateAt: stateAt };
})();
