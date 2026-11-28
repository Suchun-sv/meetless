import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Artifact, Id, Input, Project, Round, State } from '@meetless/core';
import { MCP_TOOLS } from '@meetless/api';
import type { BlobFiles } from '../blobs';

/**
 * What a project's folder holds for its Claude Code session (all regenerated from the state, so
 * they are never edited by hand): CLAUDE.md, .claude/settings.json, materials/, the repo/ link,
 * and once the owner has started a session, .mcp.json and .meetless/session.json.
 */

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 6);

/** Letters, digits, `-` and `_` only (so the folder is safe in a shell command), plus a stable suffix from the id. */
export function slugFor(name: string, projectId: Id): string {
  const base = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'project'}-${short(projectId)}`;
}

/** Writes `content` unless the file already holds exactly that. */
export function writeIfChanged(file: string, content: string | Buffer, mode?: number): boolean {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  try {
    if (readFileSync(file).equals(data)) return false;
  } catch {
    // missing: write it
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data, mode === undefined ? undefined : { mode });
  if (mode !== undefined) chmodSync(file, mode);
  return true;
}

const roundsOf = (s: State, projectId: Id): Round[] =>
  Object.values(s.rounds)
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.n - b.n);

const STATUS: Record<Round['status'], string> = { planned: '未开始', current: '进行中', delivered: '已交付' };

/** CLAUDE.md: the project as the owner sees it, the rules, and where live status comes from. */
export function claudeMd(s: State, p: Project): string {
  const rounds = roundsOf(s, p.id);
  const current = rounds.find((r) => r.status === 'current') ?? null;
  const members = p.memberIds.map((id) => s.users[id]?.displayName ?? id);
  const lines = [
    `# ${p.name}`,
    '',
    '这是 Meetless 项目的工作区。这个文件由 Meetless 生成，每次项目变化都会重写，不要手改。',
    '',
    '## 项目',
    `- 项目 ID：${p.id}（调用 meetless MCP 工具时用它）`,
    `- 目标：${p.description.trim() || '（未填写）'}`,
    current?.span ? `- 当前时间段：${current.title}，${current.start} 到 ${current.due}（不是截止）` : `- 当前截止：${current ? `${current.title}，${current.due}` : '（没有进行中的截止）'}`,
  ];
  const others = rounds.filter((r) => r !== current);
  if (others.length) {
    lines.push('- 其他截止：');
    for (const r of others) lines.push(`  - ${r.title}，${r.span ? `${r.start} 到 ${r.due}，时间段` : r.due}，${STATUS[r.status]}`);
  }
  lines.push(`- 成员：${members.join('、') || '（无）'}`);
  lines.push(
    '',
    '## 规则',
    '- 默认用中文回答。',
    '- `repo/` 是只读的代码仓库：可以读，不要修改其中任何文件。',
    '- 运行 shell 命令或访问网络之前先说明要做什么；这些操作需要项目负责人批准。',
    '- 不要修改 `.claude/`、`.mcp.json`、`.meetless/`。',
    '',
    '## 资料',
    '- `materials/` 里是导出的输入和产物（文本，以及有原件时的原件），可能不是最新的。',
    '- 先 Read `materials/INDEX.md` 看有哪些文件，不要直接 Read 目录（这个会话没有 Glob 工具）。',
    '- 需求、交接、待确认等实时状态，调用 meetless MCP 工具（list_needs、get_need_context、search、read_artifact 等），不要只看 materials。',
    '',
  );
  return lines.join('\n');
}

/**
 * The middle permission setting: reads and edits inside the folder and the meetless MCP are
 * allowed; the repo and the session's own files are never edited; everything else (Bash, the
 * web, files outside the folder) asks, which `--permission-prompt-tool` turns into an approval.
 */
export function settingsJson(repoPath: string | null): string {
  // Claude Code matches file paths on Read and Edit rules only; Edit covers Write and NotebookEdit.
  // Every meetless tool by name: the server-wide `mcp__meetless` rule did not stop them asking.
  const allow = ['Read(./**)', 'Edit(./**)', 'mcp__meetless', ...MCP_TOOLS.map((t) => `mcp__meetless__${t}`)];
  const deny = ['Edit(./repo/**)', 'Edit(./.claude/**)', 'Edit(./.mcp.json)', 'Edit(./.meetless/**)'];
  if (repoPath) {
    // The link's target too, however the tools resolve it.
    allow.push(`Read(/${repoPath}/**)`);
    deny.push(`Edit(/${repoPath}/**)`);
  }
  // Every shell command and web access asks, even ones Claude Code would treat as read-only (ls, cat).
  const ask = ['Bash', 'WebFetch', 'WebSearch'];
  return `${JSON.stringify({ permissions: { allow, deny, ask, defaultMode: 'default' } }, null, 2)}\n`;
}

export function mcpJson(url: string, token: string): string {
  return `${JSON.stringify({ mcpServers: { meetless: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}\n`;
}

/**
 * `repo/`: a read-only view of the project's code repo. bindfs is not on this host, so it is a
 * symlink; the settings deny every edit under it (and its target) and Bash always asks.
 */
export function linkRepo(folder: string, repoPath: string | null): 'symlink' | 'none' {
  const link = join(folder, 'repo');
  let current: string | null = null;
  try {
    current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : '';
  } catch {
    current = null;
  }
  const ok = repoPath !== null && existsSync(repoPath) && statSync(repoPath).isDirectory();
  if (current !== null && (!ok || current !== repoPath)) rmSync(link, { recursive: current === '', force: true });
  if (!ok) return 'none';
  if (current !== repoPath) symlinkSync(repoPath!, link);
  return 'symlink';
}

const safe = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'untitled';

const EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/zip': '.zip',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};
const MAX_COPY = 100 * 1024 * 1024;

function inputText(i: Input): string {
  const from = i.from as unknown as { name?: string; userId?: string } | null;
  const head = [`# ${i.title}`, '', `- 日期：${i.date}`, `- 类型：${i.kind}${i.scene ? `，${i.scene}` : ''}`];
  if (from?.name || from?.userId) head.push(`- 来自：${from.name ?? from.userId}`);
  if (i.summary) head.push('', `摘要：${i.summary}`);
  return `${[...head, '', ...i.body.map((b) => b.text)].join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function artifactReadme(s: State, a: Artifact): string {
  const needs = a.needIds.map((id) => s.needs[id]?.code).filter(Boolean);
  const lines = [`# ${a.title}`, '', `- 类型：${a.kind}`, `- 位置：${a.where}`];
  if (a.url) lines.push(`- 链接：${a.url}`);
  if (needs.length) lines.push(`- 关联需求：${needs.join('、')}`);
  lines.push('', '## 版本');
  for (const v of [...a.versions].reverse()) lines.push(`- ${v.label}，${v.date}${v.note ? `：${v.note}` : ''}${v.url ? `（${v.url}）` : ''}`);
  return `${lines.join('\n')}\n`;
}

/**
 * materials/: every input and artifact the owner can see, as text, plus original files where the
 * server holds them. Files no longer part of the set are removed. Returns how many files changed.
 */
export function syncMaterials(folder: string, s: State, projectId: Id, blobs: BlobFiles): number {
  const root = join(folder, 'materials');
  const want = new Set<string>();
  let changed = 0;
  const put = (rel: string, content: string) => {
    want.add(rel);
    if (writeIfChanged(join(root, rel), content)) changed++;
  };
  const copy = (rel: string, hash: string) => {
    const src = blobs.path(hash);
    try {
      const st = statSync(src);
      if (st.size > MAX_COPY) return;
      want.add(rel);
      const dest = join(root, rel);
      if (existsSync(dest) && statSync(dest).size === st.size) return;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      changed++;
    } catch {
      // not held here
    }
  };
  for (const i of Object.values(s.inputs)) {
    if (i.projectId !== projectId) continue;
    const base = `${i.date}-${safe(i.title.replace(/\.(md|txt)$/i, ''))}-${short(i.id)}`;
    put(`inputs/${base}.md`, inputText(i));
    if (i.blobHash && !['md', 'txt', 'paste'].includes(i.kind)) copy(`inputs/originals/${base}.${/^[a-z0-9]{1,5}$/.test(i.kind) ? i.kind : 'bin'}`, i.blobHash);
  }
  for (const a of Object.values(s.artifacts)) {
    if (a.projectId !== projectId) continue;
    const dir = `artifacts/${safe(a.title)}-${short(a.id)}`;
    put(`${dir}/README.md`, artifactReadme(s, a));
    const v = [...a.versions].reverse().find((x) => x.blobHash);
    if (v?.blobHash) {
      const ext = (v.mediaType && EXT[v.mediaType]) || '';
      copy(`${dir}/${safe(v.label)}-${short(v.id)}${ext}`, v.blobHash);
      if (v.derived?.texts?.length) put(`${dir}/${safe(v.label)}-${short(v.id)}.txt`, `${v.derived.texts.join('\n\n')}\n`);
    }
  }
  // Always there: the list of files, since a session cannot list a folder without asking (no Glob, Bash asks).
  const files = [...want].sort();
  put(
    'INDEX.md',
    files.length
      ? `# 材料目录\n\n${files.map((f) => `- materials/${f}`).join('\n')}\n`
      : '# 材料目录\n\n暂时没有导出的材料。\n',
  );
  const walk = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    } catch {
      return [];
    }
  };
  for (const f of walk(root)) {
    if (!want.has(relative(root, f))) {
      rmSync(f, { force: true });
      changed++;
    }
  }
  return changed;
}
