# Meetless v3 设计（第一版完整实现）

日期：2026-11-24 状态：用户已批准（2026-11-24）
设计来源：Claude Design 原型 v3（已存档于 `design/claude-design-v3/`，入口 `Meetless Needs Prototype v3.html`）

## 1. 为什么做

v3 原型已经把故事圆了：需求 → 围绕产物干活 → 交付（一次交付 = 一轮）→ 反馈 → 新需求，
协作单位是人，项目有一个共享的 Agent。现在要把它变成**能装在 Mac 上真用**的版本，验证这个故事跑起来是不是好用。
**这一版只有用户本人测试**（2026-11-24 用户确认）：用户用多个账号扮演队友，把交接、回报、过时提醒走通。
产品本身面向团队（含导师），所以多人机制要真实实现，只是暂不拉真实队友。

## 2. 目标 / 非目标 / 反目标

**目标**：原型 v3 的全部页面和交互在真实产品里可用（范围 A，用户 2026-11-24 选定），
多人多客户端真实同步；Claude Code / Codex 通过 MCP 真能拉上下文、回报进度；Mac 可安装包。

**非目标**：真实大模型调用（未授权）；签名/公证；
Windows / Linux 安装包；密码、邮箱或学校单点登录；
按岗位区分可见范围（先全部相同）；Agent 之间对话；客户访问。

**部署**（用户 2026-11-24 决定）：上公网（用户有域名或 VPS），细节在阶段 2 定：HTTPS；生产环境 dev 账号强制关闭；登录和兑换邀请码限流；OnlyOffice 不直接暴露。开发期服务端留在 the dev server，SSH 隧道只用于开发。

**反目标**（做了也算失败）：
- 「仅自己」的内容出现在任何别人能看到的地方（别人的界面、链接、MCP 上下文、搜索、看板、Agent 回答）
- 界面出现圆点类符号（`·` `•` `●`、星号做项目符号、状态圆点）
- 把模拟/规则生成的内容说成 AI 结果；把项目 Agent 的「捕获」当成进度
- 弄坏用户正在用的试用服务器

## 3. 约束

- 开发、测试、截图全部在 the dev server（`ssh <user>@<dev-server>`，fish shell，用 `bash -lc`；
  `PATH=$HOME/.local/bin:$HOME/bin:$PATH DOCKER_HOST=unix:///run/user/1000/docker.sock`）。不在别的机器上跑构建。
- 不碰试用服务器：worktree `~/work/meetless-mac-pkg`、端口 4875、schema `meetless_trial`、`~/work/meetless-trial`。
  不停、不重置 `meetless-pg` 及其卷。
- Docker：只用 `meetless-*` 命名的资源，只绑 127.0.0.1，先查名字和端口冲突，不 prune，不 sudo，不装系统包。
- Electron 不在用户桌面上开窗，只走 Xvfb 容器（`infra/dev/electron-e2e.sh`）。
- Git：提交信息不加 Co-authored-by 或任何 AI 署名；不 force-push；不提交密钥。
- 中英双语（zh-CN / en）全覆盖，有完整性测试。文案短、像商业产品。
- AI 一律模拟并在界面标明（见 §7）。
- Mac 打包在用户的 Mac（`ssh <user>@<mac>`），只用构建目录和 worktree，不改系统、不绕 Gatekeeper，
  在 Mac 上弹窗前先问用户。

## 4. 实现方式（Approaches）

考虑过三种：
1. **先打底座再并行**（用户选定）：一个 agent 审查补全领域模型、定服务端接口和 MCP 工具约定、搭界面骨架；
   然后 4 个 agent 在各自 worktree 并行，各块经审查后合入；最后一个 agent 做端到端测试和打包。
   优点：并行块之间接口已定，合并返工少。代价：底座这段是串行的。
2. 按层同时开工（core / server / UI 同时写，UI 先用假数据）：起步快，但各方猜接口，合并返工多。
3. 推倒重来：丢掉已有的 `d868e05`。没有好处，它就是按 v3 写的。

## 5. 已定的产品决策（来自与用户的讨论，不要重新讨论）

**模型**
- 需求两类：**外部需求**（来源人、完成标准；todo/doing/met/partial/moved/dropped）和
  **自己的假设**（预期效果、怎么验证；untested/testing/held/refuted/parked）。被否定的假设对团队可见，作为「别再试」。
- 每条需求有来源（原话 + 出处）、修订记录、负责人、所属轮次、父需求、私有标记。
  **来源、轮次、修订理由由系统自动填写，拿不准才进「待确认」问人**。
- 上下文版本 = 1 + 修订次数。
- 轮次：硬截止或定期检查。交付时冻结交付项，并逐条记录需求状态。
- 输入：导入 Word / PDF / 文本 / Markdown，或在应用里现场写 Markdown；
  识别出的新需求、修订、假设、动作**默认进待确认**，逐条接受或忽略；接受后建立或修订需求并挂上原话出处。
- 冲突（新输入与已有需求矛盾）：Agent 指出，由导入人或负责人决定——修订需求 / 保留并搁置新请求 / 交给别人决定。

**协作**
- 协作单位是人。全项目一个共享「项目 Agent」。客户不是成员、看不到项目；导师是成员。
  团队有岗位，岗位内外都协作，所有岗位可见范围相同。
- **交接给人**：状态 sent → accepted / asked / declined → doing → returned → done；
  **只有发起人能确认完成**。交接附一句短 prompt + 链接 `meetless://<projectId>/<needCode>`，
  链接背后的上下文由 MCP 现场生成，可预览、可刷新。
  记录对方 Agent 拉取的版本；需求之后被修订时显示「上下文已过时，现为第 N 版」，可「提醒刷新」。
- **回报**：任何人的 Agent 通过 MCP 回报直接算进度；项目 Agent 对代码库/文档的「捕获」只作参考，不算进度。
- **隐私**：默认共享；对话框和导入处有「项目 / 仅自己」开关，私有内容之后可「公开到项目」。

**界面**（照 v3 原型）
- ChatGPT 风格：白色画布、灰色侧栏、黑白为主，只有 AI 相关用紫色。
- 侧栏：新输入、「我的」（跨项目首页，带计数）、项目树（当前项目展开：看板 / 需求 / 输入 / 产物 / 动态 / 交付，
  带成员头像和角标）、底部「Agent 接入」、用户行（中/EN 切换）。
- 顶栏：项目名、成员、「待确认」。
- 每页底部是项目 Agent 对话框，上方是动态建议（热点用紫色）。
- **没有任何圆点符号**；状态用彩色文字表示；分隔用间距。
- 视觉 token（颜色、字体、间距、圆角、阴影、动效）见 `docs/superpowers/specs/2026-11-24-meetless-v3-visual-tokens.md`，取值已于 2026-11-24 经用户确认。
- **看板**：每个项目一个（点项目默认进看板），「我的」也有一个。卡片从项目记录实时计算：
  - 项目：进度、风险、成员与岗位、交付准备度、假设、最近动态；按需加：来源分布、按人周报
  - 「我的」：项目概览、交给我的、待我确认、我交出的、我负责的、即将到期；按需加：全部风险
  - 卡片标「项目 Agent 生成 更新于 HH:MM」，可刷新、可移除；可从建议条或对话（「加一张…卡片」）添加；
    卡片配置按「用户 × 范围」保存，只属于该用户。
- 产物：Overleaf / 代码库 / Notion / PPTX / DOCX / PDF，有版本、关联需求、「在源处打开」。
  应用内查看优先 OnlyOffice（见 §8.5）。

## 6. 页面清单（范围 A，每页对应的原型文件）

| 页面 | 内容 | 原型 |
|---|---|---|
| 我的（首页看板） | 跨项目卡片，§5 | `needs3/dash.jsx`、`needs3/app.jsx` |
| 项目看板 | 项目卡片，§5 | `needs3/dash.jsx` |
| 需求 | 外部需求 / 假设两栏看板，需求卡（负责人、交接状态、仅你可见）、谱系 | `needs3/board.jsx` |
| 需求详情抽屉 | 交给…、复制给 Agent、公开到项目；来源原话、修订、动态（捕获标参考）、相关产物；交接块（接受/提问/拒绝、交回、过时提醒、确认完成） | `needs3/board.jsx` |
| 交接弹窗 / 链接弹窗 | 按岗位分组选人、说明、到期、上下文预览与刷新、发送 | `needs3/collab.jsx` |
| 待确认 | 识别结果逐条接受/忽略；冲突并排对比（现有需求 vs 新输入）三种处理 | `needs3/collab.jsx`（AskPanel）、`needs/inputs.jsx` |
| 输入 | 导入文件、现场写 Markdown、段落与识别结果对照 | `needs/inputs.jsx` |
| 产物 | 列表、版本、关联需求、应用内查看 | `needs/artifacts.jsx`、`needs3/ui.jsx`（DocFrame） |
| 动态 | 工作记录流，按需求过滤；Agent 回报 / 人工 / 捕获区分 | `needs/pages.jsx` |
| 交付 | 轮次时间线（甘特，今天线）、每轮交付清单与逐条状态 | `needs/pages.jsx`、`needs3/ui.jsx`（Timeline） |
| Agent 接入 | Claude Code / Codex 安装命令、令牌管理、最近调用、skill 下载 | `needs/agent.jsx` |
| 对话框 | 建议条、对话线程（引用需求芯片、可执行动作）、项目/仅自己、附件、发送 | `needs3/chat.jsx` |
| 登录 / 新建项目 / 成员与岗位 / 轮次设置 | 原型没有，按同一视觉风格补：新用户从空开始，能建项目、加成员和岗位、定轮次 | — |

原型里的 `strip.js` 是原型期的补丁；正式实现里**源头就不产生圆点**，另用测试兜底（§10）。

## 7. AI：模拟，但接口是真的

- 不做任何外部模型调用。保留 provider 接口；Claude 适配器保持不启用。
- **需求识别**：规则（关键词、句式），记 `detector: "rules/1"`。
- **项目 Agent 回答**：对项目记录（需求、原话、修订、动态、产物文字）做关键词检索，按模板组织回答并给出需求引用芯片；
  能识别的意图（加卡片、导入、交接、查过时等）给出可执行动作。
- **看板卡片选择、建议条**：规则。
- 界面标签：所有这类输出标「规则生成」（en: "Rule-based"）。不出现「AI 已审核」之类的话。

## 8. 架构

### 8.1 现有基础（保留并复用）
pnpm monorepo，TS strict。`packages/core`（事件溯源领域）、`packages/i18n`、`packages/client`
（同步引擎 + node:sqlite 缓存）、`apps/server`（Fastify + ws，PgEventStore：服务端分配 seq、幂等追加、
按成员过滤读取、WebSocket 推送；内容寻址 blob 存储；LibreOffice 转换 worker，容器 `meetless-office`）、
`apps/desktop`（Electron 45 + Vite + React，窄 IPC 桥，renderer 无 Node）。Playwright 与 Xvfb 下 Electron 测试脚手架。

### 8.2 领域模型
`v3` 分支的 `d868e05` 已重写 core：types / events / reducer / queries / scope（隐私过滤）/ search / detect /
dashboard / agent / context，旧的 PR 式模型已删除（历史在 git 里）。底座阶段要**对照本文和原型审查补全**，
不推倒。必须保持的不变式：事件日志只追加、事件 id 幂等、按成员过滤、私有过滤在服务端执行、
权限校验在 reducer（如只有发起人能确认交接完成）。

### 8.3 服务端
- 现有事件追加/读取/推送通道承载所有新事件。
- 新增 HTTP：上下文生成 `GET /projects/:pid/needs/:code/context`（返回 markdown + version；
  如果调用者是某交接的接收人，记一次 fetch）、Agent 令牌（建、列、吊销；只存哈希）、
  导入文件（上传 → blob → 文本抽取 → 规则识别 → 生成输入事件）、产物文件与 OnlyOffice 取文件（只读，无保存回调）。
- 所有读接口经同一隐私过滤（`scope.ts`）。

### 8.4 MCP 与 skill
- **服务端直接提供 MCP over HTTP**（用户 2026-11-24 决定）：路由 `POST /mcp`，Streamable HTTP，官方 MCP TypeScript SDK，
  跑在服务端进程里，无状态，用 Agent 令牌（`Authorization: Bearer`）。理由：每台机器不用装东西；升级一次所有人生效；
  服务端也不因此变重。没有单独的 MCP 包。工具：`get_need_context(link|project+code)`、`list_needs`、`search`、`read_artifact`、
  `record_work`（直接算进度，`via` 记客户端）、`propose_need`（进待确认）、`set_verdict`（假设结论）。
- `skills/meetless/SKILL.md`：开工前拉上下文、里程碑回报、做完交回；Claude Code 与 Codex 通用。
- Agent 接入页给出可直接复制的命令：`claude mcp add --transport http meetless <服务地址>/mcp --header "Authorization: Bearer <令牌>" --header "X-Meetless-Client: claude-code"`
  和 `~/.codex/config.toml` 片段（`url`、`bearer_token_env_var`、`http_headers` 带 `X-Meetless-Client`）。

### 8.5 OnlyOffice
- **只读查看**（实施方决定）：不在应用里编辑，编辑去源处（Overleaf / Word / Notion），新版本靠上传或捕获进来。
- 容器 `meetless-onlyoffice`（镜像 `onlyoffice/documentserver:8.3` 已在机器上），127.0.0.1:55435，开 JWT，
  密钥放未入库的本地 env 文件；只读查看模式。
- 桌面端在产物页嵌入 DocumentServer 的 api.js；服务端给 DS 提供带签名的取文件 URL。
- 没配置 DS 或 DS 不可用时，回退到现有 LibreOffice 转页面图预览，界面注明。
- 开发期 Mac 上看 DS 和服务端一样走 SSH 隧道，隧道只用于开发。
- 公网部署（用户 2026-11-24 决定，细节在阶段 2）：OnlyOffice 不直接暴露，DS 只在内网经签名 URL 取文件；对外只有服务端的 HTTPS。

### 8.6 桌面端
- renderer 重写成 v3：侧栏、顶栏、对话框、各页面、抽屉、弹窗；样式从原型 CSS 移植（`needs2/v2.css`、`needs3/*.css`）。
- 主进程与 IPC 桥沿用（含已有的文件日志、登录错误可见）。
- 样例数据：开发命令加载原型里的两个项目（论文、Atlas），界面标「样例数据」。新用户从空开始。

### 8.7 账号：邀请码（用户 2026-11-24 选定）
- 服务端首次启动时生成一个**管理员邀请码**，打印到日志和数据目录的文件里；用户用它在登录页建第一个账号。
- 项目成员页可以「邀请成员」：生成一次性邀请码（可设岗位），对方在登录页填名字 + 邀请码，得到个人令牌，存在本机客户端。
  没有密码。令牌在服务端只存哈希，可吊销。
- 加成员 = 选已有账号，或生成邀请码。Agent 令牌挂在个人账号下。
- 现有固定 dev 账号只在测试和开发里用，正式启动默认关闭（开关用环境变量）。
- 归属：服务端部分归 S，登录页和邀请界面归 U1。

### 8.8 实施方决定的几件事（用户可推翻）
- **对话记录**：每个人和项目 Agent 的对话保存下来，**只有本人看得到**，不在团队间共享。
  Agent 回答只用提问人能看到的内容。「项目 / 仅自己」开关决定对话里**产生的东西**（输入、需求、动态）是否共享。
  理由：共享线程会把提问人的私有内容带给别人，第一版不冒这个险。
- **捕获最新**（用户 2026-11-24 补充）：真实读取，不放假数据。按需求编号和关键词规则匹配到需求，
  标「捕获 仅供参考」，不算进度。归 U3。来源：
  - 代码库：已关联的本地 git 仓库（复用 `packages/client/src/git.ts`）。
  - **Overleaf：填项目的 git 地址**（Overleaf 的 git 集成 `https://git.overleaf.com/<id>`，用户自己的 Overleaf git 令牌存在本机钥匙串/本地配置，不入库、不上传服务端），
    客户端 clone/pull 后按 git 来源处理。
  - **Notion：填页面链接**，通过 Notion MCP（`https://mcp.notion.com/mcp`，用户自己 OAuth 授权）读取页面内容；
    没授权时界面提示去授权，不报假内容。
  - 已上传的文档版本（DOCX / PPTX / PDF）。
  - 测试用本地 bare git 仓库代替 Overleaf、用假的 MCP 服务代替 Notion；真实 Overleaf / Notion 账号的验证留给用户试用时做。
- **试用数据**：旧试用服务器里是旧模型的数据，不迁移。v3 试用另起一个实例（端口 4876、schema `meetless_trial_v3`），
  旧的 4875 照常开着，等用户说再关。

## 9. 并行分工

**阶段 0 底座**（1 个 agent，在 `v3` 分支）：
- 审查补全 core；冻结事件类型与查询签名。
- 服务端接口与 MCP 工具的类型约定（请求/响应类型放共享包）。
- renderer 骨架：路由/视图切换、原型样式基础、i18n 接入、组件目录约定、空页面占位。
- 隔离约定：每个并行块的 worktree、PG schema、端口（见下）。
- 全部测试绿后提交并推送 `v3`。

**阶段 1 并行**（4 个 agent，各自从 `v3` 开 worktree 和分支）：

| 块 | 负责 | 主要目录 |
|---|---|---|
| S 服务端 | 邀请码账号、上下文 HTTP、Agent 令牌、导入抽取、MCP 路由（HTTP）、登录与邀请码限流、skill、服务端测试（真 Postgres）和 MCP 端到端测试 | `apps/server`、`skills/` |
| U1 框架与看板 | 侧栏、顶栏、对话框（检索回答、建议条、加卡片）、项目看板、「我的」看板、登录（邀请码）/建项目/成员岗位与邀请/轮次设置、Agent 接入页 | `renderer/shell`、`renderer/dash`、`renderer/chat`、`renderer/setup` |
| U2 需求与协作 | 需求看板、抽屉、交接块、交接弹窗、链接弹窗、待确认与冲突 | `renderer/needs`、`renderer/collab` |
| U3 输入与产物 | 输入页（导入、写 Markdown）、产物页（OnlyOffice + 回退）、捕获最新、动态、交付时间线、OnlyOffice 容器脚本 | `renderer/inputs`、`renderer/artifacts`、`renderer/stream`、`renderer/deliveries`、`infra/dev` |

隔离：块 X 用 schema `meetless_v3_<x>`、服务端端口 4881（S）/4882（U1）/4883（U2）/4884（U3）、
Vite 端口 5181–5184。UI 块需要的服务端新接口如果 S 还没合入，先在桥层用 core 直接实现或写假实现并标 TODO，合入时替换。
共享文件（i18n 资源、全局样式、路由表）只追加不改别人的段落；合并冲突由合并方解决。

每块完成：自测全绿 → 审查 agent 对照本文和原型检查（规格符合 + 代码质量）→ 修完 → 合入 `v3`。
合入顺序：S 优先，UI 块随后，任一块合入后其他块 rebase。

**阶段 2 集成**（1 个 agent）：端到端测试（§10）、Electron 测试、文档（ARCHITECTURE、README 运行说明、
「哪些是模拟的」、`docs/screenshots/v3/` 中英截图）、最终全分支审查。然后在用户 Mac 上打未签名 arm64 包。
`v3` 合入 `main`、升级试用服务器，**都先问用户**。

## 10. 验收与测试

- core 单测：需求生命周期；识别结果接受/忽略的效果；修订使上下文版本 +1；交接过时检测；
  交接状态机与权限（只有发起人能确认完成）；冲突三种处理；隐私在所有出口被排除；看板卡片计算；规则识别与检索回答带引用。
- 服务端测试连真 Postgres；MCP 端到端：官方 SDK 客户端经 HTTP 连运行中的测试服务端、调工具、断言服务端状态变化且私有内容不出现。
- Playwright 两个独立客户端（一个 zh-CN、一个 en）连真服务端：A 把需求交给 B → B 接受、复制链接/prompt →
  B 的 Agent 经 MCP 回报 → A 看到进度 → A 修订使交接过时 → 「提醒刷新」生效 → A 的私有项在 B 端从不出现 →
  通过对话框加看板卡片，刷新后仍在 → 两种语言下全文扫描无圆点符号。
- Electron（Xvfb）：启动、登录、持久化、重启。
- `pnpm -r typecheck`、`pnpm -r test`、`pnpm test:e2e`、Electron 检查保持全绿。
- 截图对照原型逐页看过（中英各一套）。

## 11. 留给实施者

组件拆分和命名、样式移植方式（直接搬 CSS 或改写）、规则识别的具体词表、检索打分方法、
OnlyOffice 的嵌入细节、测试数据构造方式——按现有代码习惯自定，在提交说明或文档里写清楚。

## 12. 后续：项目记忆（预留接口，未实现）

用户 2026-11-24 决定：项目记忆是后续功能，**本版不做**，也不上传任何会话记忆。现在只预留名字。

- 预留 MCP 工具（现有工具不得占用这两个名字，`@meetless/api` 有测试）：
  - `remember`：Agent 提议一条项目记忆。字段：类型（决定 / 事实 / 教训 / 约定）、简短正文、关联需求、来源会话。
  - `recall`：按问题查项目记忆。
- 预留事件族 `memory.*`（本版没有任何 `memory.*` 事件）。
- 将来做的时候：
  - Agent 写入的记忆默认「仅自己」，由本人在「待确认」里公开到项目。
  - 导入会话记忆走清单，由用户勾选要导入的条目。
  - 互相矛盾的记忆由人裁决。
  - 需求上下文（`get_need_context`）带上相关记忆。

