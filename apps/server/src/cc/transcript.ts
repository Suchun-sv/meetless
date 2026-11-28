import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { CcItem } from '@meetless/api';

/** A tool step as one short line: the file, the command, the pattern or the URL. */
export function toolSummary(name: string, input: unknown, cwd: string): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const path = (v: unknown) => {
    const p = str(v);
    if (!p) return '';
    const r = isAbsolute(p) ? relative(cwd, p) : p;
    return r.startsWith('..') ? p : r;
  };
  const one = (s: string) => s.split('\n')[0]!.trim();
  let s: string;
  switch (name) {
    case 'Bash':
      s = one(str(i.command));
      break;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      s = path(i.file_path ?? i.notebook_path);
      break;
    case 'Glob':
    case 'Grep':
      s = `${str(i.pattern)}${i.path ? ` in ${path(i.path)}` : ''}`;
      break;
    case 'WebFetch':
      s = str(i.url);
      break;
    case 'WebSearch':
      s = str(i.query);
      break;
    case 'Task':
      s = one(str(i.description) || str(i.prompt));
      break;
    default: {
      const first = Object.entries(i).find(([, v]) => typeof v === 'string' || typeof v === 'number');
      s = first ? `${first[0]}: ${String(first[1])}` : '';
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/** A short preview of a tool's input for the approval card. */
export function inputPreview(name: string, input: unknown, cwd: string): string {
  if (name === 'Bash') {
    const cmd = String((input as { command?: unknown } | null)?.command ?? '');
    return cmd.length > 400 ? `${cmd.slice(0, 397)}...` : cmd;
  }
  const s = toolSummary(name, input, cwd);
  if (s) return s;
  const j = JSON.stringify(input ?? {});
  return j.length > 400 ? `${j.slice(0, 397)}...` : j;
}

/** Claude Code keeps a session as `<config>/projects/<encoded cwd>/<id>.jsonl`; found by id, whatever the encoding. */
export function findTranscript(configDir: string, sessionId: string): string | null {
  const root = join(configDir, 'projects');
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = join(root, d, `${sessionId}.jsonl`);
    try {
      if (statSync(f).isFile()) return f;
    } catch {
      // not here
    }
  }
  return null;
}

type Line = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { id?: string; role?: string; content?: unknown };
};
type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean };

/** Lines Claude Code writes for its own commands and reminders, not something the user typed. */
const SYSTEM_TEXT = /^\s*<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/;

/**
 * The session's conversation from its transcript: what the user typed, the assistant's text (one
 * item per message), and one item per tool step with its outcome. Turns run anywhere (Meetless,
 * a terminal, Remote Control) are in the same file. Subagent lines are left out.
 */
export function readHistory(file: string, cwd: string): CcItem[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const items: CcItem[] = [];
  const assistantAt = new Map<string, number>();
  const tools = new Map<string, number>();
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    let e: Line;
    try {
      e = JSON.parse(l) as Line;
    } catch {
      continue;
    }
    if (e.isSidechain || e.isMeta || !e.message) continue;
    const at = e.timestamp ?? '';
    const content = e.message.content;
    if (e.type === 'user') {
      if (typeof content === 'string') {
        if (!SYSTEM_TEXT.test(content)) items.push({ kind: 'user', id: e.uuid ?? `u${items.length}`, text: content, at });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const texts: string[] = [];
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text && !SYSTEM_TEXT.test(b.text)) texts.push(b.text);
        if (b.type === 'tool_result' && b.tool_use_id) {
          const k = tools.get(b.tool_use_id);
          const t = k === undefined ? null : items[k];
          if (t && t.kind === 'tool') t.ok = !b.is_error;
        }
      }
      if (texts.length) items.push({ kind: 'user', id: e.uuid ?? `u${items.length}`, text: texts.join('\n'), at });
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      const mid = e.message.id ?? e.uuid ?? `a${items.length}`;
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text) {
          const k = assistantAt.get(mid);
          const prev = k === undefined ? null : items[k];
          if (prev && prev.kind === 'assistant') prev.text += b.text;
          else {
            assistantAt.set(mid, items.length);
            items.push({ kind: 'assistant', id: mid, text: b.text, at });
          }
        } else if (b.type === 'tool_use' && b.id && b.name) {
          tools.set(b.id, items.length);
          items.push({ kind: 'tool', id: b.id, name: b.name, summary: toolSummary(b.name, b.input, cwd), ok: null, at });
          // Text after a tool step is a new bubble.
          assistantAt.delete(mid);
        }
      }
    }
  }
  return items;
}

/** One page from the end: `before` is an item index (as a string) from an earlier page. */
export function pageOf(items: CcItem[], before: string | undefined, limit: number): { items: CcItem[]; before: string | null } {
  const b = before === undefined || before === '' ? items.length : Number(before);
  const end = Number.isSafeInteger(b) ? Math.max(0, Math.min(b, items.length)) : items.length;
  const start = Math.max(0, end - limit);
  return { items: items.slice(start, end), before: start > 0 ? String(start) : null };
}
