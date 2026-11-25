# Meetless v4 design tokens

Final values for every token in contract section 8 (`docs/superpowers/plans/2026-11-24-v3-contract.md`). `apps/desktop/src/renderer/styles/token-names.ts` did not exist on 2026-11-24, so the section 8 list was used as the authoritative list. Values follow the `minimalist-ui` skill. Where the skill conflicts with the user's rules, the user's rules win. Source: `needs4/tokens.css` in Claude Design project `52541e51-171d-433e-9140-207f9ff2033f`, entry `Meetless Needs Prototype v4.html`.

| Group | Token | v4 value | Note |
|---|---|---|---|
| Colour: surfaces | `--color-bg` | `#FBFBFA` | canvas; warm off-white, still reads as the white ChatGPT canvas |
| Colour: surfaces | `--color-sidebar` | `#F5F4F0` | one warm step darker than the canvas |
| Colour: surfaces | `--color-surface` | `#F2F1ED` | subtle fill: chips, quotes, code, file-kind tags |
| Colour: surfaces | `--color-hover` | `#EDECE8` |  |
| Colour: surfaces | `--color-selected` | `#E7E6E1` |  |
| Colour: surfaces | `--color-scrim` | `rgba(28,27,25,.22)` | warm off-black at 22% |
| Colour: text | `--color-text` | `#1C1B19` | off-black, never #000 |
| Colour: text | `--color-text-secondary` | `#787774` | muted grey, about 4.4:1 on the canvas |
| Colour: text | `--color-text-tertiary` | `#9B9A96` | meta text, timestamps, placeholders |
| Colour: text | `--color-text-inverse` | `#FFFFFF` |  |
| Colour: lines | `--color-border` | `#EAEAEA` | 1px structural lines |
| Colour: lines | `--color-border-strong` | `#D8D7D3` | hover borders, dashed hypothesis and private cards, inputs |
| Colour: lines | `--color-focus` | `#1C1B19` | 2px focus ring, offset 2px |
| Colour: AI (violet, reserved) | `--color-ai` | `#6A4FA3` | AI and rule output only |
| Colour: AI (violet, reserved) | `--color-ai-bg` | `#F1EDF8` | pastel tint behind AI text |
| Colour: status | `--color-info` | `#1F6C9F` | text on `--color-info-bg` |
| Colour: status | `--color-success` | `#346538` | text on `--color-success-bg` |
| Colour: status | `--color-warning` | `#956400` | text on `--color-warning-bg` |
| Colour: status | `--color-warning-bg` | `#FBF3DB` |  |
| Colour: status | `--color-danger` | `#9F2F2D` | text on `--color-danger-bg`; deadline marker |
| Colour: status | `--color-danger-bg` | `#FDEBEC` |  |
| Colour: avatars | `--color-avatar-1` | `#B07D57` | me (clay) |
| Colour: avatars | `--color-avatar-2` | `#5A7DA3` | slate blue |
| Colour: avatars | `--color-avatar-3` | `#A5698A` | mauve rose |
| Colour: avatars | `--color-avatar-4` | `#5C8868` | sage |
| Colour: avatars | `--color-avatar-5` | `#4D878C` | teal |
| Colour: avatars | `--color-avatar-6` | `#8A7657` | olive brown (was violet in v3) |
| Colour: avatars | `--color-avatar-7` | `#7B8A4B` | moss |
| Colour: avatars | `--color-avatar-8` | `#8C8A85` | warm grey (client) |
| Type | `--font-sans` | `"Geist","SF Pro Text",-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Noto Sans CJK SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif` | Geist for Latin, then PingFang SC on macOS, bundled Noto Sans SC elsewhere |
| Type | `--font-mono` | `"Geist Mono","JetBrains Mono","SF Mono",ui-monospace,Menlo,"PingFang SC","Noto Sans SC",monospace` |  |
| Type | `--text-xs` | `12px` |  |
| Type | `--text-sm` | `13px` |  |
| Type | `--text-base` | `14px` | body |
| Type | `--text-md` | `15px` |  |
| Type | `--text-lg` | `17px` |  |
| Type | `--text-xl` | `20px` |  |
| Type | `--text-2xl` | `28px` | home heading |
| Type | `--leading-tight` | `1.25` |  |
| Type | `--leading-normal` | `1.6` | body, per minimalist-ui |
| Type | `--weight-regular` | `400` |  |
| Type | `--weight-medium` | `500` |  |
| Type | `--weight-semibold` | `600` |  |
| Type | `--tracking-tight` | `-0.02em` | headings and large numbers only |
| Spacing | `--space-1` | `4px` |  |
| Spacing | `--space-2` | `8px` |  |
| Spacing | `--space-3` | `12px` |  |
| Spacing | `--space-4` | `16px` |  |
| Spacing | `--space-5` | `20px` |  |
| Spacing | `--space-6` | `24px` |  |
| Spacing | `--space-8` | `32px` |  |
| Spacing | `--space-10` | `40px` |  |
| Spacing | `--space-12` | `48px` |  |
| Radius | `--radius-sm` | `4px` | tags, need chips, small marks |
| Radius | `--radius-md` | `6px` | buttons, chips, segmented controls, list rows |
| Radius | `--radius-lg` | `8px` | cards, widgets, panels |
| Radius | `--radius-xl` | `12px` | modals, composer, agent thread |
| Radius | `--radius-full` | `9999px` | avatars, pills, count badges only |
| Border | `--border-width` | `1px` |  |
| Border | `--border` | `var(--border-width) solid var(--color-border)` |  |
| Border | `--border-strong` | `var(--border-width) solid var(--color-border-strong)` |  |
| Shadow | `--shadow-sm` | `0 2px 8px rgba(28,27,25,.04)` | cards on hover |
| Shadow | `--shadow-md` | `0 4px 16px rgba(28,27,25,.05)` | composer, menus, thread |
| Shadow | `--shadow-lg` | `0 16px 40px rgba(28,27,25,.08)` | modals |
| Layout | `--layout-sidebar` | `260px` |  |
| Layout | `--layout-drawer` | `420px` |  |
| Layout | `--layout-topbar` | `56px` |  |
| Layout | `--layout-content` | `768px` |  |
| Motion | `--duration-fast` | `120ms` | hover in/out; press uses 90ms |
| Motion | `--duration-normal` | `180ms` | card lift, shadow |
| Motion | `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | ease-out, no overshoot |
| Stacking | `--z-drawer` | `20` |  |
| Stacking | `--z-modal` | `50` |  |
| Stacking | `--z-toast` | `60` |  |

74 tokens. All are defined; none are left blank.

## Proposed additions (not yet in section 8)

Base needs to add these before blocks can use them. Pills use pastel tints with dark text, so info and success need a background, just as warning and danger already have one.

| Token | Value | Use |
|---|---|---|
| `--color-info-bg` | `#E7F1F8` | pill tint for info (In progress, Active); handoff waiting for you |
| `--color-success-bg` | `#EDF3EC` | pill tint for success (Done, Delivered); diff additions |

If base declines them, the fallback is `color-mix(in srgb, var(--color-info) 10%, var(--color-bg))`, which uses no raw colour. Two hover states already use `color-mix` from tokens: the primary button hover is `color-mix(in srgb, var(--color-text) 86%, var(--color-bg))`, and the hover on an AI suggestion chip is a border at 30% `--color-ai`. Check that `styles.test.ts` accepts `color-mix`.

## Rules carried by the values

- Violet (`--color-ai`, `--color-ai-bg`) appears only on AI and rule output: auto-detected marks, detection hits in documents, agent suggestion chips, agent work rows and the agent thread title. v3 used violet in four places that are not AI output, and v4 moves them:
  - hypothesis status Testing becomes info;
  - the New hypothesis effect becomes ink;
  - the "waiting for you" risk and the handoff-to-you highlight become info;
  - the hypothesis kind mark and border become grey dashed.
- Status is coloured text (`.st`), or a pastel tint with dark text (`.pill`). There are no dots, so the lineage node, the cadence milestone and list bullets became squares or nothing.
- Pills use sentence case with `letter-spacing: 0`. There is no uppercase tracking in any locale.
- Motion is limited to hover and press:
  - buttons step up 1px on hover;
  - on press they go 1px down and scale to .985 over 90ms;
  - need cards and project cards lift 2px and take `--shadow-sm`;
  - this happens only with a fine pointer;
  - under reduced motion, only colours change.

## Fonts

| Role | Font | Licence | Files to bundle (Electron, offline) |
|---|---|---|---|
| UI sans (Latin) | Geist 1.5.1 (Vercel) | SIL OFL 1.1 | `Geist-Variable.woff2` (58 KB, weights 100 to 900), from npm `geist` at `dist/fonts/geist-sans/` |
| Mono | Geist Mono 1.5.1 | SIL OFL 1.1 | `GeistMono-Variable.woff2` (58 KB), from npm `geist` at `dist/fonts/geist-mono/` |
| Chinese | PingFang SC (macOS system), then Noto Sans SC | PingFang: Apple system font, not bundled. Noto Sans SC: SIL OFL 1.1 | `@fontsource-variable/noto-sans-sc` 5.x: unicode-range woff2 slices plus its `index.css`. Only the slices in use are loaded. This keeps Windows and Linux consistent. |
| Chinese and other fallback | Noto Sans CJK SC, Hiragino Sans GB, Microsoft YaHei, system-ui | system | none |
| Editorial serif | not used | not applicable | Considered for the home heading, but zh-CN is the main locale. A Latin serif would only show in English, so the two locales would look different. Section 8 also has no `--font-serif`. |

Inter, Roboto and Open Sans are not used. Put the files under `apps/desktop/src/renderer/assets/fonts/` and reference them with relative `@font-face` URLs from `tokens.css`. The Claude Design preview loads the same Geist files from jsDelivr, because it cannot hold binary assets.

## Appendix: copy changes (v4 i18n layer, `needs4/i18n-v4.js`)

| Key | Locale | Old | New |
|---|---|---|---|
| `ai.inferred` | zh | 自动识别 | 规则识别 |
| `ai.inferred` | en | Auto-detected | Rule-matched |
| `card.ai` | zh | 自动整理 | 规则归类 |
| `card.ai` | en | Auto-sorted | Sorted by rule |
| `ask.sub` | zh | 其余已自动整理。 | 其余条目已按规则归类。 |
| `ask.sub` | en | Everything else is sorted automatically. | The rest was sorted by rule. |
| `ask.empty` | zh | 都确认好了 | 没有待确认的事项 |
| `ask.empty` | en | All confirmed | Nothing to confirm |
| `db.by` | zh | 项目 Agent 生成 | 按项目记录生成 |
| `db.by` | en | Generated by project agent | Built from the project record |
| `db.byHome` | zh | Agent 生成 | 按各项目记录生成 |
| `db.byHome` | en | Generated by agent | Built from your projects |
| `db.hint` | zh | 告诉项目 Agent 你想看什么，它会生成卡片 | 说出想看的内容，按项目记录生成卡片 |
| `db.hint` | en | Tell the project agent what you want to see and it builds a card | Name what you want to see; a card is built from the project record |
| `db.ph` | zh | 例如：加一张本周谁做了什么的卡片… | 例如：加一张本周分工卡片 |
| `db.ph` | en | e.g. Add a card showing who did what this week… | e.g. Add a card for this week by person |
| `db.added` | zh | 已添加「{name}」，数据来自当前项目记录，会随项目变化自动更新。 | 已添加「{name}」，随项目记录更新。 |
| `db.added` | en | Added “{name}”. It reads the project record and updates as the project changes. | Added “{name}”. It updates with the project record. |
| `db.exists` | zh | 「{name}」已经在看板上，已帮你刷新。 | 「{name}」已在看板上，已刷新。 |
| `db.exists` | en | “{name}” is already on the dashboard; refreshed it. | “{name}” is already on the dashboard. Refreshed. |
| `st.sub` | zh | 提交、实验、文档和沟通，自动关联到需求。 | 提交、实验、文档和消息，按规则关联到需求。 |
| `st.sub` | en | Commits, experiments, docs and messages, linked to needs automatically. | Commits, experiments, docs and messages, linked to needs by rule. |
| `dl.draft` | zh | 已自动生成，交付前请确认 | 按规则生成的草稿，交付前请确认 |
| `dl.draft` | en | Auto-drafted. Review before delivery. | Drafted by rule. Review before you deliver. |
| `cap.label` | zh | 捕获 · 仅供参考 | 捕获，仅供参考 |
| `cap.label` | en | Captured · reference only | Captured, for reference |
| `cap.text` | zh | 项目 Agent 捕获：最近 3 次提交和 1 处文档改动与此需求相关 | 已捕获：最近 3 次提交和 1 处文档改动与此需求相关 |
| `cap.text` | en | Project agent captured: 3 recent commits and 1 doc change relate to this need | Captured: 3 recent commits and 1 doc change relate to this need |
| `ch.asInput` | zh | 这像是一份新输入，导入后我来识别需求。 | 这段像一份新输入。导入后按规则识别需求。 |
| `ch.asInput` | en | This looks like a new input. Import it and I’ll detect the needs. | This looks like a new input. Import it to detect needs by rule. |
| `ch.ph` | zh | 问这个项目的任何问题，或粘贴新的输入… | 提问，或粘贴邮件、会议记录 |
| `ch.ph` | en | Ask anything about this project, or paste a new input… | Ask about this project, or paste an email or notes |
| `ch.phHome` | zh | 问你所有项目的任何问题… | 问所有项目的进度和截止 |
| `ch.phHome` | en | Ask anything across your projects… | Ask about progress and deadlines across projects |
| `ch.phPrivate` | zh | 只有你能看到… | 只有你能看到 |
| `ch.phPrivate` | en | Only you will see this… | Only you can see this |
| `cm.ph` | zh | 粘贴邮件、会议记录，或写下新的要求… | 粘贴邮件、会议记录或新要求 |
| `cm.ph` | en | Paste an email or meeting notes, or write a new request… | Paste an email, meeting notes or a new request |
| `cm.hint` | zh | 导入后自动识别需求，确认后生效 | 导入后识别需求，你确认后才生效 |
| `cm.hint` | en | Needs are detected on import and take effect once confirmed | Needs are detected on import and apply once you confirm |
| `in.mdPh` | zh | 记录要求、会议要点…… | 要求或会议要点 |
| `in.mdPh` | en | Requests, meeting notes… | Requests or meeting notes |
| `in.parsing` | zh | 识别中… | 正在识别 |
| `in.parsing` | en | Detecting… | Detecting needs |
| `home.hi` | zh | 今天有 {n} 件事等你 | 今天要处理 {n} 件事 |
| `home.hi` | en | {n} things are waiting for you | {n} things to handle today |
| `ho.btn` | zh | 交给… | 转交 |
| `ho.btn` | en | Hand off… | Hand off |
| `ho.title` | zh | 交给谁？ | 选择接手人 |
| `ho.title` | en | Hand off to | Choose who takes it |
| `ho.ask` | zh | 希望对方做什么 | 需要对方做的事 |
| `ho.ask` | en | What should they do | What you need from them |
| `ho.send` | zh | 交出 | 确认转交 |
| `ho.send` | en | Hand off | Send handoff |
| `ho.question` | zh | 有疑问 | 提问 |
| `ho.question` | en | Ask | Ask a question |
| `ho.preview` | zh | 对方会收到 | 对方收到的内容 |
| `ho.preview` | en | They will get | What they receive |
| `ho.stale` | zh | 之后需求有更新，现为第 {v} 版 | 需求已更新到第 {v} 版 |
| `ho.stale` | en | The need changed since then; now v{v} | The need is now at v{v} |
| `sg.stale` | zh | {need} 已更新，提醒 {who} 刷新 | 提醒 {who} 刷新 {need} |
| `sg.stale` | en | {need} changed — ask {who} to refresh | Ask {who} to refresh {need} |
| `sg.conflict` | zh | 有 {n} 个冲突等你决定 | 处理 {n} 个冲突 |
| `sg.conflict` | en | {n} conflict needs your call | Resolve conflicts ({n}) |
| `sg.toMe` | zh | {who} 交给你一件事 | 查看 {who} 交给你的需求 |
| `sg.toMe` | en | {who} handed you something | Open the handoff from {who} |
| `mine.none` | zh | 你目前没有负责的未完成需求 | 你名下没有未完成的需求 |
| `mine.none` | en | Nothing open is owned by you | You own no open needs |
| `lk.note` | zh | Agent 打开链接时现场生成，拿到的始终是最新版。 | Agent 打开链接时生成，内容总是最新版。 |
| `lk.note` | en | Generated when the agent opens the link, so it is always current. | Built when the agent opens the link, so it is always the latest. |
| `ag.sub` | zh | Agent 通过 MCP 读取需求和上下文，写入默认进待确认。 | Agent 通过 MCP 读取需求和上下文；写入默认进入待确认。 |
| `ag.sub` | en | Agents read needs and context over MCP. Writes go to review by default. | Agents read needs and context over MCP. Their writes wait in To confirm. |
| `ef.hold` | zh | 验证 | 已验证 |
| `ask.title` | en | Needs your input | Needs your confirmation |
| `ch.reminded` | en | Reminded {who}: {need} changed, please refresh the context. | Reminded {who} to refresh the context for {need}. |
| `home.byMe` | en | I handed off | Handed off by me |
| `w.byMe` | en | I handed off | Handed off by me |
| `rk.conflict` | en | {n} conflict needs a decision | Conflicts to resolve: {n} |
| `round.left` | en | {n}d left | {n} days left |
| `card.evidence` | en | {n} refs | {n} sources |
| `ag.suggest` | en | Write (reviewed) | Write, after review |
| `w.sources` | en | Where needs come from | Need sources |

## User decisions (2026-11-24)
- The v4 visual draft and these token values are **approved**. Add `--color-info-bg` and `--color-success-bg`.
- **No kind marks before need codes.** Remove the small black square in front of external-need codes everywhere: board cards, the drawer header, dashboards, lists and chips. External needs and hypotheses are told apart by the code prefix (N / H), the board column or filter, and the hypothesis card's grey dashed border. The hypothesis glyph also goes, so the rule is symmetric. No replacement marker; square markers in lists ("became squares") are dropped too, and spacing is used instead.
- The copy changes in the appendix are approved and go into the i18n catalogue.

See contract §8 (`docs/superpowers/plans/2026-11-24-v3-contract.md`) for how these tokens are implemented.
