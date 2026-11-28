import { inputStatus, noDots, pendingExtracts, SCENES, SEP, type ExtractType, type Id, type Input, type InputKind, type Scene, type State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import type { Tone } from '@renderer/ui/tone';
import { sceneOf } from '@renderer/needs/lineage';
import { EXTRACT_TONE, extractAction, inputGroups, paraExtract, requesterLabel } from '@renderer/inputs/model';

export * from '@renderer/inputs/model';
export { sceneOf };
export type { Tone };

type T = (key: MessageKey, params?: Record<string, string | number>) => string;
type FmtDay = (d: string) => string;

export interface InputRow {
  id: Id;
  kind: InputKind;
  title: string;
  fact: string;
  open: number;
  mine: boolean;
  selected: boolean;
  status: 'pending' | 'done';
}

function inputRow(s: State, me: Id, i: Input, selectedId: Id | null, fmtDay: FmtDay): InputRow {
  return {
    id: i.id,
    kind: i.kind,
    title: noDots(i.title),
    fact: [requesterLabel(s, i.from), fmtDay(i.date)].filter((x): x is string => !!x).join(SEP),
    open: pendingExtracts(i),
    mine: i.privateTo === me,
    selected: i.id === selectedId,
    status: inputStatus(i),
  };
}

/** The list pane: pending first, then done, each as display-ready rows. */
export function inputRows(s: State, me: Id, projectId: Id, selectedId: Id | null, fmtDay: FmtDay): { pending: InputRow[]; done: InputRow[] } {
  const g = inputGroups(s, projectId);
  return {
    pending: g.pending.map((i) => inputRow(s, me, i, selectedId, fmtDay)),
    done: g.done.map((i) => inputRow(s, me, i, selectedId, fmtDay)),
  };
}

export interface SheetHeader {
  title: string;
  fact: string;
  mine: boolean;
  /** 公开到项目 shows. */
  canShare: boolean;
  /** The share was refused for private needs: offer to share them first. */
  blocked: boolean;
  isDocFile: boolean;
  hasOriginal: boolean;
  scene: Scene;
}

export function sheetHeader(s: State, me: Id, input: Input, blockedNeedIds: Id[] | null, t: T, fmtDay: FmtDay): SheetHeader {
  const fromLabel = requesterLabel(s, input.from);
  const mine = input.privateTo === me;
  const blocked = mine && blockedNeedIds !== null && blockedNeedIds.length > 0;
  const isDocFile = input.kind === 'docx' || input.kind === 'pdf';
  return {
    title: noDots(input.title),
    fact: [fromLabel ? t('in.from', { who: fromLabel }) : null, fmtDay(input.date)].filter((x): x is string => !!x).join(SEP),
    mine,
    canShare: mine && !blocked,
    blocked,
    isDocFile,
    hasOriginal: isDocFile && !!input.blobHash,
    scene: sceneOf(input),
  };
}

export const SCENE_OPTIONS: readonly { scene: Scene; key: MessageKey }[] = SCENES.map((scene) => ({ scene, key: `lin.type.${scene}` as MessageKey }));

export interface ParaRow {
  id: Id;
  text: string;
  extractId: Id | null;
  /** Has an extract pointing at it. */
  hit: boolean;
  /** Focused by the route, or its extract is the hot one. */
  on: boolean;
  focused: boolean;
}

export function paraRows(input: Input, paraId: Id | null | undefined, hotExtractId: Id | null): ParaRow[] {
  const map = paraExtract(input);
  return input.body.map((p) => {
    const xId = map[p.id] ?? null;
    const focused = p.id === paraId;
    return { id: p.id, text: noDots(p.text), extractId: xId, hit: xId !== null, on: focused || (xId !== null && xId === hotExtractId), focused };
  });
}

export interface ExtractCard {
  id: Id;
  type: ExtractType;
  typeKey: MessageKey;
  tone: Tone;
  text: string;
  action: 'decide' | 'open' | 'accepted' | 'ignored';
  /** A rev extract's target need, shown as a chip before the type pill. */
  needId: Id | null;
  resultNeedId: Id | null;
  /** Its need is one the refused share named: deciding it is the other way out. */
  blocking: boolean;
  paraId: Id | null;
}

export function extractCards(input: Input, blockingNeedIds: readonly Id[]): ExtractCard[] {
  return input.extracts.map((x) => ({
    id: x.id,
    type: x.type,
    typeKey: `in.x.${x.type}` as MessageKey,
    tone: EXTRACT_TONE[x.type],
    text: noDots(x.text),
    action: extractAction(input, x),
    needId: x.type === 'rev' ? x.needId : null,
    resultNeedId: x.resultNeedId ?? null,
    blocking: x.type === 'rev' && x.state === null && x.needId !== null && blockingNeedIds.includes(x.needId),
    paraId: x.paraId ?? null,
  }));
}

/** What the extract panel says it was produced by: DeepSeek (violet) or the rule detector. */
export function detectorMark(input: Input): 'ai' | 'rules' {
  return input.detector.startsWith('deepseek') ? 'ai' : 'rules';
}

/** The import refusals with their own copy; anything else goes through errorText. */
export function importErrorKey(code: string): MessageKey | null {
  if (code === 'BAD_TYPE') return 'in.badType';
  if (code === 'EMPTY_FILE') return 'in.emptyFile';
  return null;
}

export const IMPORT_ACCEPT = ['.pdf', '.docx', '.txt', '.md', '.markdown'] as const;
export const IMPORT_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;
