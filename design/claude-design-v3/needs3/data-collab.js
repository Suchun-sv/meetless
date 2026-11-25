// SIMULATED collaboration layer: members and roles, handoffs, agent reports, conflicts, private items,
// suggestion chips and canned project-agent answers.
(function () {
  var c = function (zh, en) { return { 'zh-CN': zh, en: en }; };
  window.NeedsCollab = {
    paper: {
      roles: [{ id: 'pi', name: c('导师', 'Advisor'), members: ['prof'] }, { id: 'stu', name: c('学生', 'Student'), members: ['me'] }, { id: 'co', name: c('合作者', 'Co-author'), members: ['mia'] }],
      owners: { N4: 'me', N5: 'me', N6: 'me', N7: 'mia', N8: 'me', H4: 'me' },
      handoffs: [
        { id: 'HO1', need: 'N7', from: 'me', to: 'mia', state: 'doing', date: '2026-11-21', due: '2026-11-28', fetched: { v: 1, at: '2026-11-22' },
          ask: c('把剩下 2 组消融跑完，结果填进表 4。', 'Run the last 2 ablation settings and fill Table 4.') },
        { id: 'HO2', need: 'N5', from: 'prof', to: 'me', state: 'sent', date: '2026-11-24', due: '2026-11-27',
          ask: c('摘要改好后发我看一眼。', 'Send me the abstract once it’s revised.') }
      ],
      work: [
        { id: 'wr1', src: 'agent', by: 'mia', date: '2026-11-24', text: c('Mia（通过 Codex）回报：消融第 4 组跑完，no_tier 延迟 +18%', 'Mia (via Codex): ablation setting 4 done, no_tier latency +18%'), need: 'N7', ef: 'advance', why: c('按交接要求推进', 'Progress on the handoff'), conf: 'h' }
      ],
      needs: [
        { id: 'H7', kind: 'hyp', round: 3, status: 'untested', private: true, by: 'me', title: c('换 RoPE 外推可能进一步降延迟', 'RoPE extrapolation may cut latency further'),
          expect: c('p50 再降 5%', 'p50 another −5%'), verify: c('先在小数据集上试', 'Try on the small dataset first'),
          source: { src: 'doc', date: '2026-11-24', quote: c('个人笔记：试试 RoPE 外推', 'Personal note: try RoPE extrapolation'), ref: c('我的草稿', 'My drafts') }, conf: { source: 'h', round: 'h', status: 'h' } }
      ],
      questions: [],
      suggestions: [
        { id: 's1', text: c('起草第 3 轮交付说明', 'Draft the round 3 delivery note') },
        { id: 's2', text: c('总结本周进展发给张老师', 'Summarise this week for Prof. Zhang') }
      ],
      answers: {
        s1: { text: c('第 3 轮交付说明（草稿）：已完成与 baseline X 的延迟对比；摘要待改；正文还超 0.6 页；消融 4/5，Mia 在跑最后一组。', 'Round 3 delivery note (draft): latency comparison with baseline X done; abstract pending; main text 0.6 page over; ablation 4/5, Mia is running the last setting.'), cites: ['N4', 'N5', 'N6', 'N7'] },
        s2: { text: c('本周进展：分层缓存结果稳定（p50 −34%）；按您 11-18 的意见，baseline X 只比延迟；删掉 §5.3 后 12.6 页；消融由 Mia 补跑中。', 'This week: tiered cache holds (p50 −34%); baseline X compared on latency only, per your 11-18 note; 12.6 pages after cutting §5.3; Mia is finishing the ablation.'), cites: ['H2', 'N4', 'N6', 'N7'] }
      },
      faq: [
        { kw: 'baseline|N4|召回|recall|只比', text: c('N4 只比延迟，是因为张老师 11-18 在微信里说 X 的召回不好复现。这是 N4 的第 1 次修订。', 'N4 compares latency only because Prof. Zhang said on 11-18 that X’s recall is hard to reproduce. It is N4’s first revision.'), cites: ['N4'] },
        { kw: 'L2|归一|H3|normal', text: c('试过。exp-12 里 Recall@10 从 0.712 降到 0.709，已回退（commit 9c0d），不建议再试。', 'Tried. In exp-12 Recall@10 went 0.712 → 0.709; reverted (commit 9c0d). Not worth retrying.'), cites: ['H3'] },
        { kw: 'Mia|N7|消融|ablation', text: c('N7 已交给 Mia。她的 Codex 今天回报第 4 组跑完，还差 1 组，期限 11-28。', 'N7 is with Mia. Her Codex reported setting 4 done today; one to go, due 11-28.'), cites: ['N7'] }
      ],
      summary: c('这个项目在第 3 轮（VLDB 投稿，剩 7 天）。进行中：N4、N6、N7；未开始：N5。可以问具体的需求，比如「N4 为什么只比延迟」。', 'Round 3 (VLDB submission, 7 days left). In progress: N4, N6, N7; not started: N5. Ask about a specific need, e.g. “why does N4 compare latency only?”')
    },
    team: {
      roles: [{ id: 'pm', name: c('产品', 'Product'), members: ['lin', 'ruo'] }, { id: 'dev', name: c('研发', 'Engineering'), members: ['me', 'ben'] }, { id: 'qa', name: c('测试', 'QA'), members: ['zhou'] }],
      owners: { N2: 'zhou', N3: 'me', N4: 'ben', N5: 'zhou', H3: 'ben' },
      handoffs: [
        { id: 'HO1', need: 'N3', from: 'lin', to: 'me', state: 'sent', date: '2026-11-24', due: '2026-11-27',
          ask: c('权限方案和实现你来负责，周五前给我看方案。', 'Please own the permission design and build; show me the design by Friday.') },
        { id: 'HO2', need: 'N2', from: 'me', to: 'zhou', state: 'doing', date: '2026-11-21', due: '2026-11-26', fetched: { v: 1, at: '2026-11-21' },
          ask: c('补按时间筛选的测试用例。', 'Add test cases for the date filter.') }
      ],
      work: [
        { id: 'wr1', src: 'agent', by: 'zhou', date: '2026-11-24', text: c('周屿（通过 Claude Code）回报：新增 6 个筛选测试，2 个失败', 'Zhou Yu (via Claude Code): 6 filter tests added, 2 failing'), need: 'N2', ef: 'advance', why: c('按交接要求推进', 'Progress on the handoff'), conf: 'h' }
      ],
      needs: [],
      questions: [
        { id: 'QC1', conflict: { need: 'N1', old: c('首版导出 12 个核心字段', '12 core fields in v1'), neu: c('导出需包含客户的全部字段。', 'Exports must include all customer fields.'), src: c('客户需求说明书 v2.pdf', 'Client requirements v2.pdf') },
          q: c('新文档和 N1 冲突：全部字段，还是 12 个核心字段？', 'The new document conflicts with N1: all fields, or 12 core fields?'),
          why: c('你导入了这份文档，由你来定；也可以交给产品负责人。', 'You imported it, so it’s your call; or hand it to the product lead.'),
          options: [
            { label: c('以新文档为准，修订 N1', 'Go with the new doc, revise N1'), op: { type: 'revise', need: 'N1', text: c('改为导出全部字段', 'Export all fields'), why: c('客户需求说明书 v2', 'Client requirements v2') } },
            { label: c('保留 N1，全部字段放到二期', 'Keep N1; all fields go to phase 2'), op: { type: 'newNeed', round: 4, by: 'client', title: c('导出全部字段（二期）', 'Export all fields (phase 2)') } },
            { label: c('交给林安决定', 'Hand to Lin An to decide'), op: { type: 'handoff', need: 'N1', to: 'lin', ask: c('客户新文档要全部字段，和 N1 冲突，请你定。', 'Client’s new doc asks for all fields, conflicting with N1. Your call.') } }
          ] }
      ],
      suggestions: [
        { id: 't1', text: c('生成给客户的交付说明', 'Draft the delivery note for the client') },
        { id: 't2', text: c('各岗位本周进展', 'This week by role') }
      ],
      answers: {
        t1: { text: c('交付说明（草稿，仅对外部内容）：按时间筛选已完成，含「最近 7 天」；导出人和时间字段将在本轮加入；企业微信登录在二期。内部假设和讨论不会出现在对外说明里。', 'Delivery note (draft, client-facing only): date filter done incl. “last 7 days”; exporter/time fields land this round; WeCom login in phase 2. Internal hypotheses and discussion are left out.'), cites: ['N2', 'N4', 'N6'] },
        t2: { text: c('产品：客户新文档和 N1 的冲突待定。研发：Ben 完成筛选并加了索引；N3 权限刚交给你。测试：周屿新增 6 个筛选测试，2 个失败；压测未进 CI。', 'Product: the N1 conflict is open. Engineering: Ben shipped the filter and an index; N3 was just handed to you. QA: Zhou added 6 filter tests, 2 failing; load test not in CI yet.'), cites: ['N1', 'N2', 'N3', 'N5'] }
      },
      faq: [
        { kw: '缓存|cache|H2', text: c('Ben 11-07 试过缓存表，48 → 47 秒几乎没变化，已回退。后来改用流式导出（H1）。', 'Ben tried a cache table on 11-07: 48 → 47 s, reverted. Streaming export (H1) replaced it.'), cites: ['H2', 'H1'] },
        { kw: '权限|permission|N3', text: c('N3 由林安在内部演示后提出：备注只有管理员能导出。今天已交给你，周五前给方案。', 'Lin An raised N3 after the demo: only admins export notes. Handed to you today; design due Friday.'), cites: ['N3'] },
        { kw: '筛选|filter|N2|测试', text: c('N2 筛选已实现；周屿在补测试，2 个失败。注意：N2 在 11-22 加了「最近 7 天」，周屿拿到的是之前的版本。', 'N2 is built; Zhou is adding tests, 2 failing. Note: N2 gained “last 7 days” on 11-22, after Zhou fetched the context.'), cites: ['N2'] }
      ],
      summary: c('第 3 轮客户交付，剩 4 天。产品有 1 个冲突待定，研发和测试在推 N2、N3、N5。可以问「缓存表试过吗」「N3 是谁提的」。', 'Round 3 client delivery, 4 days left. One product conflict open; engineering and QA on N2, N3, N5. Try “did we try a cache table?” or “who raised N3?”')
    },
    home: {
      suggestions: [
        { id: 'h1', text: c('今天先做什么？', 'What should I do first today?') },
        { id: 'h2', text: c('汇总所有项目的截止日', 'All deadlines across projects') }
      ],
      answers: {
        h1: { text: c('建议顺序：① Atlas：客户新文档与 N1 冲突，等你决定；② Atlas：林安交给你的 N3 权限，周五前；③ 论文：张老师交给你的 N5 摘要，11-27 前。', 'Suggested order: ① Atlas: the N1 conflict needs your call; ② Atlas: N3 permissions from Lin An, due Friday; ③ Paper: N5 abstract from Prof. Zhang, due 11-27.') },
        h2: { text: c('Atlas 第 3 轮客户交付 11-28（剩 4 天）；论文第 3 轮 VLDB 投稿 12-01（剩 7 天）。', 'Atlas round 3 client delivery 11-28 (4 days); Paper round 3 VLDB submission 12-01 (7 days).') }
      },
      summary: c('你在 2 个项目里。可以问「今天先做什么」或「有哪些事在等我」。', 'You’re in 2 projects. Ask “what first today?” or “what’s waiting on me?”')
    }
  };
})();
