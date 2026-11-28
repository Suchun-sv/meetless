import { createHash, randomUUID } from 'node:crypto';
import {
  detectExtracts,
  detectScene,
  projectRounds,
  toConfirm,
  toItems,
  type ExtractInput,
  type Id,
  type IsoDate,
  type Need,
  type Scene,
} from '@meetless/core';
import type { InboxCard, InboxCommitReq, InboxCommitRes, InboxItem, InboxMaterial, InboxSource, InboxAddReq } from '@meetless/api';
import { ApiError, type ApiDeps } from '../api/frame';
import type { Command } from '../service';
import { MAX_EXTRACT_CHARS } from '../agents/deepseek';
import { extractText, MAX_IMPORT_BYTES, MAX_IMPORT_CHARS, pdfPages } from '../imports/extract';
import { ocr, type OcrConfig } from './ocr';
import { routeItems } from './route';

/** One step to take back on undo. */
type UndoStep =
  | { t: 'need'; needId: Id; kind: 'ext' | 'hyp' }
  | { t: 'work'; workId: Id }
  | { t: 'moved'; needId: Id; roundId: Id | null }
  | { t: 'revised'; needId: Id; prev: string }
  | { t: 'project'; projectId: Id };

interface Batch {
  summary: InboxCommitRes;
  at: string;
  plan: UndoStep[];
}

/** A material's whole record (`ml_inbox.doc`): what the client sees, the text read from it, and its last commit. */
interface Doc {
  material: InboxMaterial;
  given: InboxAddReq;
  contentHash: string;
  text: string | null;
  /** A PDF's text per page, to say which page an item came from. */
  pagesText?: string[];
  batch: Batch | null;
}

const POLL_MS = 20_000;
const UNDO_MS = 7 * 24 * 3600_000;
const RECENT_DAYS = 30;
const ANALYSIS_MS = 150_000;
const STEP_MS = 120;

class InboxFail extends Error {
  constructor(
    readonly code: NonNullable<InboxMaterial['error']>['code'],
    message: string,
  ) {
    super(message);
  }
}

const sha = (s: string | Uint8Array) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return [...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The 「需求」 inbox: materials the user drops in with no project yet, kept as server rows (never
 * events, so installed clients never meet an event type they do not know). Each is read (text, PDF
 * pages, docx, OCR), extracted (DeepSeek or the rules), routed among the user's projects (or a new
 * one) and checked against their needs; the client follows by long-poll. Commit and undo write
 * only existing events. Pending extracts and agent proposals already in projects show as materials too.
 */
export class InboxManager {
  private waiters = new Map<string, Set<() => void>>();
  private queue: string[] = [];
  private running = 0;

  constructor(
    private readonly deps: ApiDeps,
    private readonly ocrCfg: OcrConfig | null,
  ) {}

  /** Picks up analyses a restart interrupted. */
  async start(userIds: Id[]): Promise<void> {
    for (const u of userIds) {
      for (const r of await this.deps.accounts.inboxOf(u)) {
        if ((r.doc as Doc).material.status === 'analyzing') this.enqueue(r.id);
      }
    }
  }

  private now(): string {
    return this.deps.cfg.now().toISOString();
  }

  private today(): IsoDate {
    return this.now().slice(0, 10);
  }

  // ---------------------------------------------------------------- rows

  private async load(userId: Id, id: string): Promise<{ doc: Doc; createdAt: string }> {
    const r = await this.deps.accounts.inbox(id);
    if (!r || r.userId !== userId) throw new ApiError('NOT_FOUND');
    return { doc: r.doc as Doc, createdAt: r.createdAt };
  }

  private async save(userId: Id, doc: Doc, createdAt?: string): Promise<void> {
    doc.material.rev += 1;
    await this.deps.accounts.putInbox({ id: doc.material.id, userId, createdAt: createdAt ?? doc.material.addedAt, updatedAt: this.now(), doc });
    const w = this.waiters.get(doc.material.id);
    if (w) {
      this.waiters.delete(doc.material.id);
      for (const f of w) f();
    }
  }

  // ---------------------------------------------------------------- add, get, list

  async add(userId: Id, req: InboxAddReq): Promise<{ id: string; rev: number; existing: boolean }> {
    const text = typeof req.text === 'string' && req.text.trim() ? req.text : null;
    const blobHash = typeof req.blobHash === 'string' && req.blobHash ? req.blobHash : null;
    if (!text && !blobHash) throw new ApiError('BAD_REQUEST', { field: 'text' });
    if (text && text.length > MAX_IMPORT_CHARS) throw new ApiError('TOO_LARGE');
    let size: number | undefined;
    if (blobHash) {
      const meta = await this.deps.service.blobMeta.get(blobHash);
      if (!meta || !(await this.deps.service.canReadBlob(userId, blobHash))) throw new ApiError('NOT_AUTHORISED');
      if (meta.size > MAX_IMPORT_BYTES) throw new ApiError('TOO_LARGE');
      size = meta.size;
    }
    const contentHash = blobHash ?? sha(text!.trim());
    for (const r of await this.deps.accounts.inboxOf(userId)) {
      const d = r.doc as Doc;
      if (d.contentHash === contentHash) return { id: d.material.id, rev: d.material.rev, existing: true };
    }
    const kind = this.kindOf(req, text);
    const id = `mat-${randomUUID()}`;
    const title = req.fileName?.trim() ? clip(req.fileName, 60) : text ? clip(text.split('\n').find((l) => l.trim()) ?? text, 30) : kind === 'image' ? `图片 ${this.now().slice(5, 16).replace('T', ' ')}` : '材料';
    const material: InboxMaterial = {
      id,
      rev: 0,
      kind,
      title,
      source: (req.source ?? 'paste') as InboxSource,
      addedAt: this.now(),
      status: 'analyzing',
      stage: 'reading',
      progress: null,
      ...(size !== undefined ? { size } : {}),
      ...(req.mediaType ? { mediaType: req.mediaType } : {}),
      summary: null,
      items: [],
      routing: null,
      committed: null,
    };
    const doc: Doc = { material, given: { ...req, ...(text ? { text } : {}) }, contentHash, text: null, batch: null };
    await this.save(userId, doc);
    this.enqueue(id);
    return { id, rev: material.rev, existing: false };
  }

  private kindOf(req: InboxAddReq, text: string | null): InboxMaterial['kind'] {
    const name = (req.fileName ?? '').toLowerCase();
    const mt = (req.mediaType ?? '').toLowerCase();
    if (mt === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mt.includes('wordprocessingml') || name.endsWith('.docx')) return 'docx';
    if (mt.startsWith('image/') || /\.(png|jpe?g|heic|webp|gif)$/.test(name)) return 'image';
    const scene = text ? detectScene(text, 'doc') : 'doc';
    return scene === 'mail' ? 'mail' : scene === 'chat' ? 'chat' : 'text';
  }

  async get(userId: Id, id: string, rev: number | undefined): Promise<InboxMaterial> {
    if (id.startsWith('input:') || id.startsWith('proposal:')) {
      const row = await this.deps.accounts.inbox(id);
      if (row && row.userId === userId) return (row.doc as Doc).material;
      return this.virtual(userId, id);
    }
    let { doc } = await this.load(userId, id);
    if (rev !== undefined && doc.material.status === 'analyzing' && doc.material.rev <= rev) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, POLL_MS);
        const set = this.waiters.get(id) ?? new Set();
        function done() {
          clearTimeout(t);
          resolve();
        }
        set.add(done);
        this.waiters.set(id, set);
      });
      doc = (await this.load(userId, id)).doc;
    }
    return doc.material;
  }

  private card(m: InboxMaterial): InboxCard {
    const projects = [...new Set(m.items.map((i) => i.projectId).filter((p): p is Id => !!p))];
    return {
      id: m.id,
      kind: m.kind,
      title: m.title,
      source: m.source,
      addedAt: m.addedAt,
      status: m.status,
      ...(m.status === 'analyzing' ? { stage: m.stage, progress: m.progress } : {}),
      counts: {
        items: m.items.length,
        projects: projects.length || (m.routing?.newProject ? 1 : 0),
        duplicates: m.items.filter((i) => i.duplicateOf).length,
        conflicts: m.items.filter((i) => i.conflict).length,
      },
      projectIds: projects,
      ...(m.committed ? { committed: { projectIds: m.committed.projectIds, count: m.committed.created + m.committed.merged + m.committed.changedDue + (m.committed.revised ?? 0) } } : {}),
      ...(m.error ? { error: m.error } : {}),
    };
  }

  async list(userId: Id): Promise<{ pending: InboxCard[]; recent: InboxCard[]; older: number; badge: number }> {
    const rows = await this.deps.accounts.inboxOf(userId);
    const mats = rows.map((r) => (r.doc as Doc).material);
    const known = new Set(mats.map((m) => m.id));
    const pending = mats.filter((m) => m.status === 'ready').map((m) => this.card(m));
    for (const id of this.virtualIds(userId)) if (!known.has(id)) pending.push(this.card(this.virtual(userId, id)));
    pending.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const since = new Date(this.deps.cfg.now().getTime() - RECENT_DAYS * 86400_000).toISOString();
    const rest = mats.filter((m) => m.status !== 'ready');
    const recent = rest.filter((m) => m.addedAt >= since).map((m) => this.card(m));
    return { pending, recent, older: rest.length - recent.length, badge: pending.length };
  }

  // ---------------------------------------------------------------- existing pending items as materials

  /** Pending extracts (grouped by their input) and open agent proposals in the user's projects. */
  private virtualIds(userId: Id): string[] {
    const s = this.deps.service.view(userId);
    const tc = toConfirm(s, userId, null, this.today());
    return [...new Set(tc.extracts.map((x) => `input:${x.inputId}`)), ...tc.proposals.map((p) => `proposal:${p.id}`)];
  }

  private virtual(userId: Id, id: string): InboxMaterial {
    const s = this.deps.service.view(userId);
    if (id.startsWith('input:')) {
      const input = s.inputs[id.slice(6)];
      if (!input || !this.deps.service.readable(userId).has(input.projectId)) throw new ApiError('NOT_FOUND');
      const items: InboxItem[] = input.extracts
        .filter((x) => x.state === null && !(x.conflict && input.privateTo === null) && x.type !== 'action')
        .map((x) => ({
          id: x.id,
          type: x.type === 'hyp' ? 'hyp' : x.type === 'rev' ? 'rev' : 'need',
          text: x.text,
          due: x.due,
          quote: input.body.find((b) => b.id === x.paraId)?.text ?? null,
          page: null,
          projectId: input.projectId,
          ...(x.type === 'rev' && x.needId ? { revNeedId: x.needId } : {}),
        }));
      return {
        id,
        rev: 0,
        kind: input.scene === 'mail' ? 'mail' : input.scene === 'chat' ? 'chat' : input.kind === 'pdf' ? 'pdf' : input.kind === 'docx' ? 'docx' : 'text',
        title: input.title,
        source: 'project',
        addedAt: s.lastRecordedAt ?? this.now(),
        status: items.length ? 'ready' : 'committed',
        stage: 'done',
        progress: null,
        summary: input.summary,
        items,
        routing: { candidates: [{ projectId: input.projectId, reason: '' }] },
        committed: null,
      };
    }
    const p = s.proposals[id.slice(9)];
    if (!p || !this.deps.service.readable(userId).has(p.projectId)) throw new ApiError('NOT_FOUND');
    return {
      id,
      rev: 0,
      kind: 'proposal',
      title: p.title,
      source: 'agent',
      addedAt: s.lastRecordedAt ?? this.now(),
      status: p.status === 'open' ? 'ready' : 'committed',
      stage: 'done',
      progress: null,
      summary: p.why,
      items: [{ id: p.id, type: p.kind === 'hyp' ? 'hyp' : 'need', text: p.title, due: null, quote: p.why, page: null, projectId: p.projectId }],
      routing: { candidates: [{ projectId: p.projectId, reason: '' }] },
      committed: null,
    };
  }

  // ---------------------------------------------------------------- analysis

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.running < 2 && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      void this.analyse(id).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async analyse(id: string): Promise<void> {
    const row = await this.deps.accounts.inbox(id);
    if (!row) return;
    const userId = row.userId;
    const doc = row.doc as Doc;
    const m = doc.material;
    try {
      await Promise.race([
        this.stages(userId, doc),
        sleep(ANALYSIS_MS).then(() => {
          throw new InboxFail('TIMEOUT', '分析超时');
        }),
      ]);
    } catch (e) {
      const f = e instanceof InboxFail ? e : new InboxFail('UNREADABLE', '没读出来');
      if (!(e instanceof InboxFail)) this.deps.cfg.print(`inbox ${id}: ${(e as Error).message}`);
      m.status = 'failed';
      m.stage = 'done';
      m.error = { code: f.code, message: f.message };
      await this.save(userId, doc, row.createdAt);
    }
  }

  /** Text of the material, with per-page progress for PDFs and OCR where there is no text layer. */
  private async read(userId: Id, doc: Doc): Promise<string> {
    const m = doc.material;
    const g = doc.given;
    if (!g.blobHash) return g.text ?? '';
    const bytes = await this.deps.service.blobFiles.readBytes(g.blobHash);
    if (m.kind === 'image') {
      if (g.ocrText && g.ocrText.trim()) return g.ocrText;
      if (!this.ocrCfg) throw new InboxFail('OCR_FAILED', '这台服务器不能识别图片里的文字');
      const ext = (g.fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? g.mediaType?.split('/')[1] ?? 'png').toLowerCase().replace('jpeg', 'jpg');
      const pages = await ocr(this.ocrCfg, bytes, ext).catch(() => null);
      const t = pages?.join('\n').trim() ?? '';
      if (!t) throw new InboxFail('OCR_FAILED', '图片里没有认出文字，可以重拍一张');
      return t;
    }
    if (m.kind === 'pdf') {
      let pages: string[];
      try {
        pages = await pdfPages(bytes);
      } catch {
        throw new InboxFail('UNREADABLE', '这个 PDF 打不开，可能已加密或损坏');
      }
      m.pages = pages.length;
      const blank = pages.map((p, i) => (p.trim() ? -1 : i)).filter((i) => i >= 0);
      if (blank.length && this.ocrCfg) {
        // A scanned PDF: its pages without text go through OCR.
        m.progress = { page: 0, pages: pages.length };
        await this.save(userId, doc);
        const scanned = await ocr(this.ocrCfg, bytes, 'pdf', 30).catch(() => [] as string[]);
        for (const i of blank) if (scanned[i]) pages[i] = scanned[i]!;
      }
      for (let i = 0; i < pages.length; i++) {
        m.progress = { page: i + 1, pages: pages.length };
        if (pages.length <= 12 || i % 3 === 2 || i === pages.length - 1) {
          await this.save(userId, doc);
          await sleep(STEP_MS);
        }
      }
      const text = pages.join('\n\n');
      if (!text.trim()) throw new InboxFail('NO_TEXT', '这个 PDF 里没有能读的文字');
      doc.pagesText = pages;
      return text;
    }
    if (m.kind === 'docx') return extractText('docx', bytes).catch(() => {
      throw new InboxFail('UNREADABLE', '这个文件打不开');
    });
    return extractText('txt', bytes).catch(() => {
      throw new InboxFail('UNREADABLE', '这个文件打不开');
    });
  }

  private async stages(userId: Id, doc: Doc): Promise<void> {
    const m = doc.material;
    m.stage = 'reading';
    await this.save(userId, doc);
    const text = (await this.read(userId, doc)).replace(/\r\n/g, '\n');
    if (text.length > MAX_IMPORT_CHARS) throw new InboxFail('TOO_LARGE', '内容太长了');
    if (!text.trim()) throw new InboxFail('NO_TEXT', '没有读到文字');
    doc.text = text;
    if (m.kind === 'text' || m.kind === 'image') {
      const scene = detectScene(text, 'doc');
      if (m.kind === 'text' && (scene === 'mail' || scene === 'chat')) m.kind = scene;
    }
    m.stage = 'extracting';
    await this.save(userId, doc);

    const date = this.today();
    const { paras, lead } = toItems(text, 'p');
    const pagesText = doc.pagesText;
    const pageOf = (q: string | null) => {
      if (!q || !pagesText) return null;
      const i = pagesText.findIndex((p) => p.includes(q.slice(0, 20)));
      return i >= 0 ? i + 1 : null;
    };
    // The model sees the first MAX_EXTRACT_CHARS characters, whole paragraphs.
    const forModel: typeof paras = [];
    let used = 0;
    for (const p of paras) {
      if (used + p.text.length > MAX_EXTRACT_CHARS) break;
      forModel.push(p);
      used += p.text.length + 1;
    }
    const ai = this.deps.ai;
    const byModel = ai?.enabled && forModel.length ? await ai.extract(userId, forModel.map((p) => p.text).join('\n'), [], forModel, date) : null;
    if (ai?.enabled && !byModel && forModel.length) this.deps.cfg.print(`inbox ${m.id}: model extraction failed, rules used`);
    const extracts: ExtractInput[] = byModel?.items ?? detectExtracts(paras, [], 8, lead);
    if (byModel?.summary) {
      m.summary = byModel.summary;
      await this.save(userId, doc);
      await sleep(STEP_MS);
    }
    const items: InboxItem[] = extracts
      .filter((x) => x.type === 'new' || x.type === 'hyp')
      .map((x, i) => {
        const quote = paras.find((p) => p.id === x.paraId)?.text ?? null;
        return { id: `x${i + 1}`, type: x.type === 'hyp' ? 'hyp' : 'need', text: x.text, due: x.due ?? null, quote, page: pageOf(quote), projectId: null };
      });
    const first = items.filter((i) => i.due).sort((a, b) => a.due!.localeCompare(b.due!))[0];
    if (first) {
      m.due = { date: first.due!, quote: first.quote };
      await this.save(userId, doc);
      await sleep(STEP_MS);
    }
    for (const it of items) {
      m.items.push(it);
      await this.save(userId, doc);
      await sleep(STEP_MS);
    }
    if (!items.length) {
      m.status = 'empty';
      m.stage = 'done';
      m.progress = null;
      await this.save(userId, doc);
      return;
    }
    m.stage = 'routing';
    await this.save(userId, doc);
    const view = this.deps.service.view(userId);
    const routed = await routeItems(ai, view, userId, { title: m.title, summary: m.summary, due: m.due ?? null }, items);
    m.routing = routed.routing;
    m.stage = 'checking';
    await this.save(userId, doc);
    await sleep(STEP_MS);
    m.items = routed.items;
    m.stage = 'done';
    m.status = 'ready';
    m.progress = null;
    await this.save(userId, doc);
  }

  async retry(userId: Id, id: string): Promise<{ rev: number }> {
    const { doc, createdAt } = await this.load(userId, id);
    const m = doc.material;
    if (m.status === 'committed' || m.status === 'analyzing') throw new ApiError('BAD_REQUEST');
    Object.assign(m, { status: 'analyzing', stage: 'reading', progress: null, summary: null, items: [], routing: null });
    delete m.error;
    delete m.due;
    await this.save(userId, doc, createdAt);
    this.enqueue(id);
    return { rev: m.rev };
  }

  async remove(userId: Id, id: string): Promise<{ ok: true }> {
    const { doc } = await this.load(userId, id);
    if (doc.material.status === 'analyzing') throw new ApiError('BAD_REQUEST');
    await this.deps.accounts.deleteInbox(id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- commit and undo

  private async submit(userId: Id, cmd: Command): Promise<void> {
    await this.deps.service.submit(userId, { ...cmd, id: `ev-${randomUUID()}` } as Command);
  }

  /** The DDL a need due `due` goes under in `projectId`: one with that due date, else a new one (shared within the batch). */
  private async roundFor(userId: Id, projectId: Id, due: IsoDate, title: string, made: Map<string, Id>): Promise<Id> {
    const s = this.deps.service.view(userId);
    const hit = projectRounds(s, projectId).find((r) => r.due === due && r.status !== 'delivered' && !r.span);
    if (hit) return hit.id;
    const key = `${projectId}|${due}`;
    if (made.has(key)) return made.get(key)!;
    const roundId = `rnd-${randomUUID()}`;
    const today = this.today();
    await this.submit(userId, { type: 'round.created', payload: { roundId, projectId, title: clip(title, 40), kind: 'hard', start: today < due ? today : due, due } } as Command);
    made.set(key, roundId);
    return roundId;
  }

  async commit(userId: Id, id: string, req: InboxCommitReq): Promise<InboxCommitRes> {
    let doc: Doc;
    let createdAt: string | undefined;
    const row = await this.deps.accounts.inbox(id);
    // Pending items still in their project; once committed (and maybe undone) a row like any other.
    const virtual = (id.startsWith('input:') || id.startsWith('proposal:')) && !(row && row.userId === userId);
    if (row && row.userId === userId) {
      doc = row.doc as Doc;
      createdAt = row.createdAt;
    } else if (virtual) {
      const material = this.virtual(userId, id);
      const input = id.startsWith('input:') ? this.deps.service.view(userId).inputs[id.slice(6)] : null;
      doc = { material, given: { source: 'project' }, contentHash: id, text: input ? input.body.map((b) => b.text).join('\n') : material.title, batch: null };
    } else throw new ApiError('NOT_FOUND');
    const m = doc.material;
    if (m.status !== 'ready') throw new ApiError('BAD_REQUEST', { field: 'status' });
    if (!Array.isArray(req.items) || !req.items.length) throw new ApiError('BAD_REQUEST', { field: 'items' });
    const byId = new Map(m.items.map((i) => [i.id, i]));
    for (const a of req.items) {
      if (!byId.has(a.itemId)) throw new ApiError('BAD_REQUEST', { field: 'itemId' });
      if (!['accept', 'merge', 'skip'].includes(a.action)) throw new ApiError('BAD_REQUEST', { field: 'action' });
      if (a.action === 'merge' && !a.mergeInto) throw new ApiError('BAD_REQUEST', { field: 'mergeInto' });
    }
    const wantsNew = req.items.some((a) => a.action !== 'skip' && 'newProject' in a.target);
    if (wantsNew && (!req.newProject || !req.newProject.name?.trim())) throw new ApiError('BAD_REQUEST', { field: 'newProject' });
    const readable = this.deps.service.readable(userId);
    for (const a of req.items) {
      if (a.action === 'skip' || 'newProject' in a.target) continue;
      if (!readable.has(a.target.projectId)) throw new ApiError('NOT_A_MEMBER');
      if (virtual && a.target.projectId !== byId.get(a.itemId)!.projectId) throw new ApiError('BAD_REQUEST', { field: 'target' });
    }

    const plan: UndoStep[] = [];
    const made = new Map<string, Id>();
    let created = 0;
    let merged = 0;
    let changedDue = 0;
    let revised = 0;
    const projectIds = new Set<Id>();
    /** Before a revision goes in: what the need said, for undo. */
    const noteRevision = (needId: Id | null | undefined) => {
      const n = needId ? this.deps.service.view(userId).needs[needId] : null;
      if (!n) return;
      plan.push({ t: 'revised', needId: n.id, prev: (n.kind === 'ext' ? n.accept : n.expect) ?? n.title });
      revised++;
    };
    try {
      let newProjectId: Id | null = null;
      if (wantsNew) {
        newProjectId = `p-${randomUUID()}`;
        await this.submit(userId, { type: 'project.created', payload: { projectId: newProjectId, name: clip(req.newProject!.name, 40) } } as Command);
        plan.push({ t: 'project', projectId: newProjectId });
        const fr = req.newProject!.firstRound;
        if (fr?.due) await this.roundFor(userId, newProjectId, fr.due, fr.title || req.newProject!.name, made);
      }
      const target = (a: InboxCommitReq['items'][number]) => ('newProject' in a.target ? newProjectId! : a.target.projectId);

      if (virtual && id.startsWith('proposal:')) {
        const a = req.items[0]!;
        const p = this.deps.service.view(userId).proposals[id.slice(9)]!;
        if (a.action === 'skip') await this.submit(userId, { type: 'proposal.rejected', payload: { proposalId: p.id } } as Command);
        else if (a.action === 'merge') {
          await this.submit(userId, { type: 'proposal.rejected', payload: { proposalId: p.id } } as Command);
          merged += await this.recordMerge(userId, p.projectId, a.mergeInto!, m.title, p.title, plan);
        } else {
          const needId = `n-${randomUUID()}`;
          const roundId = a.due ? await this.roundFor(userId, p.projectId, a.due, p.title, made) : null;
          await this.submit(userId, { type: 'proposal.accepted', payload: { proposalId: p.id, needId, roundId } } as Command);
          plan.push({ t: 'need', needId, kind: p.kind === 'hyp' ? 'hyp' : 'ext' });
          created++;
        }
        projectIds.add(p.projectId);
      } else if (virtual) {
        const input = this.deps.service.view(userId).inputs[id.slice(6)]!;
        for (const a of req.items) {
          const x = input.extracts.find((y) => y.id === a.itemId)!;
          if (a.action === 'skip') {
            await this.submit(userId, { type: 'extract.ignored', payload: { inputId: input.id, extractId: x.id } } as Command);
            continue;
          }
          projectIds.add(input.projectId);
          if (a.action === 'merge') {
            await this.submit(userId, { type: 'extract.ignored', payload: { inputId: input.id, extractId: x.id } } as Command);
            merged += await this.recordMerge(userId, input.projectId, a.mergeInto!, input.title, x.text, plan);
          } else if (x.type === 'new' || x.type === 'hyp') {
            const needId = `n-${randomUUID()}`;
            const due = a.due !== undefined ? a.due : x.due;
            const roundId = due ? await this.roundFor(userId, input.projectId, due, x.text, made) : undefined;
            await this.submit(userId, { type: 'extract.accepted', payload: { inputId: input.id, extractId: x.id, needId, ...(roundId ? { roundId } : {}) } } as Command);
            plan.push({ t: 'need', needId, kind: x.type === 'hyp' ? 'hyp' : 'ext' });
            created++;
          } else {
            if (x.type === 'rev') noteRevision(x.needId);
            await this.submit(userId, { type: 'extract.accepted', payload: { inputId: input.id, extractId: x.id } } as Command);
          }
        }
      } else {
        // One input per target project, carrying that project's items as extracts, then each decided.
        const { paras } = toItems(doc.text ?? m.title, 'p');
        const groups = new Map<Id, InboxCommitReq['items']>();
        for (const a of req.items) {
          if (a.action === 'skip') continue;
          const pid = target(a);
          groups.set(pid, [...(groups.get(pid) ?? []), a]);
        }
        const scene: Scene = m.kind === 'mail' ? 'mail' : m.kind === 'chat' ? 'chat' : 'doc';
        for (const [pid, acts] of groups) {
          projectIds.add(pid);
          const inputId = `in-${randomUUID()}`;
          const paraOf = (q: string | null) => (q ? (paras.find((p) => p.text === q || p.text.includes(q.slice(0, 20)))?.id ?? null) : null);
          const extracts: ExtractInput[] = acts.map((a) => {
            const it = byId.get(a.itemId)!;
            const creates = a.action === 'accept' && !it.conflict && (it.type === 'need' || it.type === 'hyp');
            const revises = a.action === 'accept' && !it.conflict && it.type === 'rev' && it.revNeedId;
            return {
              id: it.id,
              type: creates ? (it.type === 'hyp' ? 'hyp' : 'new') : revises ? 'rev' : 'action',
              text: it.text,
              paraId: paraOf(it.quote),
              ...(revises ? { needId: it.revNeedId } : {}),
              due: a.due !== undefined ? a.due : it.due,
            };
          });
          const fileKind = m.kind === 'pdf' || m.kind === 'docx' ? m.kind : 'txt';
          await this.submit(userId, {
            type: 'input.imported',
            payload: {
              inputId,
              projectId: pid,
              kind: fileKind,
              title: m.title,
              from: null,
              date: this.today(),
              blobHash: fileKind === 'txt' ? null : (doc.given.blobHash ?? null),
              body: paras,
              extracts,
              detector: 'inbox',
              scene,
              ...(m.summary ? { summary: clip(m.summary, 200) } : {}),
              private: false,
            },
          } as Command);
          for (const a of acts) {
            const it = byId.get(a.itemId)!;
            const x = extracts.find((e) => e.id === it.id)!;
            if (a.action === 'merge') {
              await this.submit(userId, { type: 'extract.accepted', payload: { inputId, extractId: x.id } } as Command);
              merged += await this.recordMerge(userId, pid, a.mergeInto!, m.title, it.text, plan);
            } else if (it.conflict) {
              if (a.conflict === 'apply') {
                const need = this.deps.service.view(userId).needs[it.conflict.needId];
                if (need) {
                  const roundId = await this.roundFor(userId, need.projectId, it.conflict.new, need.title, made);
                  await this.submit(userId, { type: 'need.updated', payload: { needId: need.id, roundId } } as Command);
                  plan.push({ t: 'moved', needId: need.id, roundId: need.roundId });
                  changedDue++;
                }
                await this.submit(userId, { type: 'extract.accepted', payload: { inputId, extractId: x.id } } as Command);
              } else await this.submit(userId, { type: 'extract.ignored', payload: { inputId, extractId: x.id } } as Command);
            } else if (x.type === 'new' || x.type === 'hyp') {
              const needId = `n-${randomUUID()}`;
              const roundId = x.due ? await this.roundFor(userId, pid, x.due, it.text, made) : undefined;
              await this.submit(userId, { type: 'extract.accepted', payload: { inputId, extractId: x.id, needId, ...(roundId ? { roundId } : {}) } } as Command);
              plan.push({ t: 'need', needId, kind: x.type === 'hyp' ? 'hyp' : 'ext' });
              created++;
            } else {
              if (x.type === 'rev') noteRevision(x.needId);
              await this.submit(userId, { type: 'extract.accepted', payload: { inputId, extractId: x.id } } as Command);
            }
          }
        }
      }
    } catch (e) {
      // Half a commit is worse than none: take back what was written, then report.
      await this.revert(userId, plan).catch(() => undefined);
      throw e;
    }
    const summary: InboxCommitRes = {
      batchId: `batch-${randomUUID()}`,
      projectIds: [...projectIds],
      created,
      merged,
      changedDue,
      revised,
      undoUntil: new Date(this.deps.cfg.now().getTime() + UNDO_MS).toISOString(),
    };
    doc.batch = { summary, at: this.now(), plan };
    m.status = 'committed';
    m.committed = { ...summary, at: this.now() };
    await this.save(userId, doc, createdAt);
    return summary;
  }

  /** 合并到: the material's sentence becomes a work item on the existing need (its source hangs there). */
  private async recordMerge(userId: Id, projectId: Id, needId: Id, title: string, why: string, plan: UndoStep[]): Promise<number> {
    const need = this.deps.service.view(userId).needs[needId];
    if (!need || need.projectId !== projectId) throw new ApiError('BAD_REQUEST', { field: 'mergeInto' });
    const workId = `w-${randomUUID()}`;
    await this.submit(userId, { type: 'work.recorded', payload: { workId, projectId, needId, src: 'doc', text: clip(title, 80), why: clip(why, 200), date: this.today() } } as Command);
    plan.push({ t: 'work', workId });
    return 1;
  }

  /** Takes a batch back with compensating events, newest first. */
  private async revert(userId: Id, plan: UndoStep[]): Promise<void> {
    const projects: Id[] = [];
    for (const step of [...plan].reverse()) {
      if (step.t === 'need') {
        await this.submit(userId, { type: 'need.status_set', payload: { needId: step.needId, status: step.kind === 'hyp' ? 'parked' : 'dropped' } } as Command);
      } else if (step.t === 'work') {
        await this.submit(userId, { type: 'work.ignored', payload: { workId: step.workId } } as Command);
      } else if (step.t === 'moved') {
        await this.submit(userId, { type: 'need.updated', payload: { needId: step.needId, roundId: step.roundId } } as Command);
      } else if (step.t === 'revised') {
        // A revision is taken back by another one that restores the text.
        await this.submit(userId, { type: 'need.revised', payload: { needId: step.needId, revisionId: `undo-${randomUUID()}`, text: step.prev, why: '撤销收进来的修订', date: this.today() } } as Command);
      } else projects.push(step.projectId);
    }
    // A project the batch created is archived when nothing else went into it since.
    const s = this.deps.service.view(userId);
    const ours = new Set(plan.filter((p) => p.t === 'need').map((p) => (p as { needId: Id }).needId));
    for (const pid of projects) {
      const other = Object.values(s.needs).some((n: Need) => n.projectId === pid && !ours.has(n.id));
      if (!other && !s.projects[pid]?.archived) await this.submit(userId, { type: 'project.archived', payload: { projectId: pid } } as Command);
    }
  }

  async undo(userId: Id, id: string): Promise<{ ok: true }> {
    const { doc, createdAt } = await this.load(userId, id);
    const m = doc.material;
    if (m.status !== 'committed' || !doc.batch) throw new ApiError('BAD_REQUEST', { field: 'status' });
    if (doc.batch.summary.undoUntil < this.now()) throw new ApiError('BAD_REQUEST', { field: 'undoUntil' });
    await this.revert(userId, doc.batch.plan);
    doc.batch = null;
    m.status = 'ready';
    m.committed = null;
    await this.save(userId, doc, createdAt);
    return { ok: true };
  }
}

