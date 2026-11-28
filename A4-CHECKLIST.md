# A4 feature checklist (scratch, not a doc)

Reference: apps/desktop/src/renderer on origin/v3. Port behaviour, not DOM.

## Inputs (输入页)
- List: pending group then done group, counts in headers ("待处理 n" / "已处理 n"); empty state copy.
- Row: kind tag (MD/TXT/DOCX/PDF), title (noDots), requester + day, open-extract count, "仅你可见" when privateTo === me.
- Select: route focusId, else first pending, else first. Phone: list -> detail push; wide: list | sheet | extracts.
- Import file: md/markdown/txt/docx/pdf only, max 20 MB; md/txt decoded (BOM, CRLF) and sent as text; docx/pdf uploaded as blob first. Errors: BAD_TYPE -> in.badType, EMPTY_FILE -> in.emptyFile, else errorText. Notice "正在导入 {name}" and "正在识别" while it runs. After import, focus the new input.
- Visibility toggle (项目 / 仅自己) applies to the next file import.
- Write Markdown modal: title (optional, default = first line clipped 30, always .md), text (required), from (matches member displayName -> userId, else free name), 仅自己 checkbox.
- Sheet header: title, 仅你可见, 公开到项目 (only mine); share refusal PRIVATE_ITEM -> "先公开相关需求" button + hint "或者先接受或忽略相关的修改"; the blocked state is tagged with its inputId.
- Fact line "来自 X  日期"; scene picker (SCENES, default from kind) -> input.scene_set.
- docx/pdf: "文件预览" note + 下载原文件 (blob).
- Paragraphs: highlight those with an extract, hover/press links paragraph <-> extract, route paraId scrolls to and marks the paragraph.
- Extract panel: chip (rev needId) before type pill; tones new strong, hyp info, rev warning, action neutral.
  - open: 接受 (acceptCommands: creates DDL under due date if needed) / 忽略 (extract.ignored)
  - conflict on a shared input: "与现有需求冲突" + 去决定 (opens To confirm)
  - accepted: 已接受 + result need chip; ignored: 已忽略
  - blocking rev (named by the share refusal): neutral hint
- Footer: DeepSeek detector -> violet "DeepSeek" + "接受后才会成为需求"; else rules mark + "规则识别，未使用 AI 模型".

## Artifacts (产物页)
- List newest first by max(seq, newest version seq); row: kind tag, title, where + newest version day. 添加产物.
- Select focusId else first; version = route versionId if it belongs, else newest. route page passes to viewer.
- Header: title, 仅你可见, 复制给 Agent (shared only; prompt from shareableView; "copied" only after write succeeds), 在 {where} 打开 (web url), 公开到项目 (shareState ok) or warning "先公开这些需求" (links_private).
- Viewer modes: code / notion / overleaf without file -> source panel (desktop capture; on Expo show source kind + note, capture is desktop only); no version -> "还没有版本"; file kinds or overleaf with file -> OnlyOffice; else label + note.
- OnlyOffice: office.config -> loading -> app_ready -> ready; failures (call failed, script, timeout 20 s, editor error) -> fallback with reason (not_configured / unsupported_kind / no_file / unavailable). Viewer bar "OnlyOffice 只读查看" "只读", page hint when route page set. Native: react-native-webview with generated HTML; web: iframe srcdoc. Same postMessage protocol.
- Fallback: reason line (warning tone); pdf -> "需要 OnlyOffice，请下载原文件" + 下载原文件; pptx/docx -> LibreOffice page images (derived.pageHashes, PNG via readBlob), per-page text, "第 n 页", credit "由 {engine} 生成的只读预览"; pending / failed states; original download whenever there is a file. route page marks and scrolls to that page.
- Side: 本版改动 (version note), source section (when viewer is not the source), 关联需求 chips + 关联需求 modal, 版本 list (label + day, tooltip label/day/round) + 新版本.
- New artifact modal: kind (6), title, where (default per kind), url (overleaf git url or abs path; notion page url; else empty or http(s)), 仅自己 (unticking drops private needs), linkable needs (open first; shared artifact only shared needs), first version file for pptx/docx/pdf. Refused create keeps the modal.
- New version modal: label (required), note, file (file kinds) or url (checked); refusal keeps modal; roundId = current round.
- Link needs modal: tick/untick, save artifact.linked.

## Activity (动态)
- Title + subtitle. Kind chips: 全部 / Agent 回报 / 人工记录 / 捕获; need filter (needs with non-ignored work, by code).
- Rows newest first (date desc, seq desc), ignored dropped. Rename system lines mixed in only when no filter.
- Row: source word tag, day + author, text (mono for commits); need chips first (only when the viewer holds that need in this project), effect pill, result pill (keep success / else muted), why.
- Marks: agent + linked progress -> "通过 {client}" + "算作进度" (success); manual linked progress -> 算作进度; capture -> 捕获 label; rules mark when autoLinked; 仅你可见; unlinked -> "还没关联需求"; mine + unlinked -> 去确认 (opens To confirm).
- Empty: "还没有动态" vs "没有符合条件的动态". Capture button is desktop only.

## Deliveries (交付)
- No rounds -> "还没有截止节点" + 去设置截止.
- Timeline of rounds (A1's shared timeline); tap bar selects one round, tap again clears; route round preselects.
- Sections newest n first. Header: milestone mark, title or "第 n 轮", status pill (delivered success / current info / planned neutral), due + hard/cadence.
- Delivered: delivered-on date, items, frozen account (need chip + status + note), feedback needs (quote + from + chip).
- Current: violet rules pill + "按规则生成的草稿，交付前请确认"; planned items; account preview (shared ext needs of the round by createdSeq); 标记为已交付 -> textarea prefilled one item per line -> 确认交付 (round.delivered, no account).
- Planned: 尚未交付.

## Search (搜索) — new page, no old UI
- Core `search(view, {text, projectId})` over the viewer's own state (server already filtered private items).
- Scope: this project / all projects. Results grouped: needs (groupByNeed, code + title + matched fields), materials (input paragraphs, artifact pages), work.
- Tap target: need -> board need; input paragraph -> inputs focusId + paraId; artifact page -> artifacts focusId + versionId + page; work -> activity.
- Highlight query terms in snippet. Empty query -> nothing; no hits -> copy.
- New i18n keys needed (search.*): title, ph, scope.project, scope.all, needs, materials, work, none, field.*.

## Settings (设置)
- Language zh-CN / en (labels 中 / EN, not translated).
- Sign out (web: 退出登录; desktop: 退出登录（保留本地数据）).
- Version line: v<current> + hot commit; status: check failed (danger) / found + percent / failed / ready / up to date with last check time; 检查更新.
- Callout model: full release over hot update; dismiss per version key; primary restart / refresh / download / retry.
- Web build: newBuild event -> "有新版本，点此刷新". iOS: show app version; updater actions only where the bridge supports them.
- User row: avatar, display name, sample label when any project is sample.

## Only me (仅自己)
- Segmented 项目 / 仅自己 control, reused by inputs, markdown, artifacts (and offered to A2/A3).
- "仅你可见" text when privateTo === me (muted tone, never a dot).
- Share flows: input.shared -> PRIVATE_ITEM details.needIds -> share needs then input; artifact share only when shareState ok.
- Never filter on the client as a privacy measure; the server already does.

## Notes for the integrator
- renderer model/ids.ts uses crypto.randomUUID (missing on Hermes); my flows take newId injected.
- shell/UpdateEntry.tsx imports CSS, so calloutModel/status are ported in settings/model, not imported.
- A4 model files import renderer model/*.ts through relative paths ../../../../../desktop/src/renderer/...; Metro watchFolders and tsconfig include need the repo root.
