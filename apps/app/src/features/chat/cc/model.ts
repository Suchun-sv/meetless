import type { Id } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import type { CcEvent, CcItem } from './api';

/** One row of the Claude Code thread. Tool steps are one grey line each; a permission waits inline. */
export type CcRow =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean | null }
  | { kind: 'permission'; id: string; tool: string; input: string; expiresAt: string; state: 'pending' | 'allow' | 'deny' }
  | { kind: 'result'; id: string; costUsd?: number }
  | { kind: 'error'; id: string; code: string };

export function fromHistory(items: readonly CcItem[]): CcRow[] {
  return items.map((x): CcRow => {
    switch (x.kind) {
      case 'user':
      case 'assistant':
        return { kind: x.kind, id: x.id, text: x.text };
      case 'tool':
        return { kind: 'tool', id: x.id, name: x.name, summary: x.summary, ok: x.ok };
      case 'result':
        return { kind: 'result', id: x.id, costUsd: x.costUsd };
    }
  });
}

/** Folds one stream event into the rows (text deltas append to their message; results mark their tool). */
export function applyEvent(rows: readonly CcRow[], e: CcEvent): CcRow[] {
  switch (e.type) {
    case 'session':
      return [...rows];
    case 'user':
      return rows.some((r) => r.kind === 'user' && r.id === e.id) ? [...rows] : [...rows.filter((r) => !(r.kind === 'user' && r.id === 'pending-user')), { kind: 'user', id: e.id, text: e.text }];
    case 'text': {
      const i = rows.findIndex((r) => r.kind === 'assistant' && r.id === e.id);
      if (i < 0) return [...rows, { kind: 'assistant', id: e.id, text: e.delta }];
      const r = rows[i] as Extract<CcRow, { kind: 'assistant' }>;
      return [...rows.slice(0, i), { ...r, text: r.text + e.delta }, ...rows.slice(i + 1)];
    }
    case 'tool':
      return [...rows, { kind: 'tool', id: e.id, name: e.name, summary: e.summary, ok: null }];
    case 'tool_result':
      return rows.map((r) => (r.kind === 'tool' && r.id === e.id ? { ...r, ok: e.ok } : r));
    case 'permission':
      return [...rows, { kind: 'permission', id: e.approvalId, tool: e.tool, input: e.input, expiresAt: e.expiresAt, state: 'pending' }];
    case 'permission_done':
      return rows.map((r) => (r.kind === 'permission' && r.id === e.approvalId ? { ...r, state: e.behavior } : r));
    case 'result':
      return [...rows, { kind: 'result', id: `r-${rows.length}`, costUsd: e.costUsd }];
    case 'error':
      return [...rows, { kind: 'error', id: `e-${rows.length}`, code: e.code }];
  }
}

const VERB: Record<string, MessageKey> = {
  Read: 'cc.tool.read',
  Glob: 'cc.tool.find',
  Grep: 'cc.tool.search',
  Edit: 'cc.tool.edit',
  MultiEdit: 'cc.tool.edit',
  Write: 'cc.tool.write',
  NotebookEdit: 'cc.tool.edit',
  Bash: 'cc.tool.run',
  WebFetch: 'cc.tool.fetch',
  WebSearch: 'cc.tool.web',
  Task: 'cc.tool.task',
  TodoWrite: 'cc.tool.todo',
};

/** 「读取 materials/…」「运行 ls」「查项目记录 needs_list」: a tool step as one short line. */
export function toolLine(t: Translator['t'], name: string, summary: string): string {
  const s = summary.length > 60 ? `${summary.slice(0, 59)}…` : summary;
  if (name.startsWith('mcp__meetless__')) return t('cc.tool.meetless', { what: s || name.slice('mcp__meetless__'.length) });
  const k = VERB[name];
  return k ? t(k, { what: s }) : `${name} ${s}`.trim();
}

/** Seconds left on a permission request, never below 0. */
export function secondsLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

/** The chat mode per project for the session: Claude Code by default, DeepSeek on request. */
export type ChatMode = 'cc' | 'ds';
const MODE = new Map<Id, ChatMode>();
export const getMode = (projectId: Id): ChatMode => MODE.get(projectId) ?? 'cc';
export const setMode = (projectId: Id, m: ChatMode) => void MODE.set(projectId, m);

/** Projects whose owner confirmed 「为这个项目开启 Claude Code」 this session (the session itself starts with the first message). */
const OPENED = new Set<Id>();
export const isOpened = (projectId: Id) => OPENED.has(projectId);
export const markOpened = (projectId: Id) => void OPENED.add(projectId);
