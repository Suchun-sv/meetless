import { myProjectIds, projectRounds, type Id, type IsoDate, type Round, type State } from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import { avatarTone } from '../../../../../desktop/src/renderer/ui/tone';
import { axisLabels, DAY, MIN_PX_PER_DAY, ms, packLanes, textPx, type AxisLabel } from './lanes';

/*
 * The two DDL timelines as px layouts (desktop `Timeline` and `ProjectsTimeline`): a project's
 * own rounds with diamonds and a today line, and Home's every-round-of-my-projects view in
 * project colours. The track is at least MIN_PX_PER_DAY a day and at least the container's
 * width; when wider, the screen scrolls it sideways, starting at `scrollTo`.
 */

const LABEL_GAP = 6;
const LABEL_MIN = 40;

export type ProjectTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Where a bar's label goes: always outside the bar, to its right when it fits before the next bar
 * (or the track end), else to its left when it fits after the previous bar and its label, else on
 * the roomier side clipped (at least LABEL_MIN px), else only in the accessibility label.
 */
export type LabelAt = 'right' | 'left' | 'none';

export interface Bar<T> {
  key: string;
  left: number;
  width: number;
  label: string;
  labelAt: LabelAt;
  /** The label's box: left edge and width in px (clipped with an ellipsis when narrower than the text). */
  labelX: number;
  labelW: number;
  item: T;
}

export interface TimelineLayout<T> {
  /** Track width in px. */
  width: number;
  start: number;
  end: number;
  todayX: number;
  /** Scroll offset that puts today a third of the way in, or 0 when the track fits. */
  scrollTo: number;
  axis: { main: AxisLabel[]; months: AxisLabel[] };
  lanes: Bar<T>[][];
  px: (d: IsoDate) => number;
}

function layout<T>(
  items: T[],
  range: { s: number; e: number },
  avail: number,
  minWidth: number,
  today: IsoDate,
  locale: string,
  todayText: string,
  get: { key: (x: T) => string; start: (x: T) => IsoDate; due: (x: T) => IsoDate; label: (x: T) => string },
): TimelineLayout<T> {
  const { s, e } = range;
  const width = Math.max(avail || minWidth, ((e - s) / DAY) * MIN_PX_PER_DAY);
  const px = (d: IsoDate) => ((ms(d) - s) / (e - s)) * width;
  const dayPx = width / ((e - s) / DAY);
  const lanes = packLanes(items, (x) => ms(get.start(x)), (x) => ms(get.due(x)) + DAY).map((lane) => {
    let used = 0;
    return lane.map((it, i): Bar<T> => {
      const left = Math.max(0, px(get.start(it)));
      const right = Math.min(width, px(get.due(it)) + dayPx);
      const w = Math.max(6, right - left);
      const label = get.label(it);
      const need = textPx(label) + 4;
      const next = lane[i + 1] ? Math.max(0, px(get.start(lane[i + 1]!))) : width;
      const roomRight = Math.min(next, width) - (left + w + LABEL_GAP);
      const roomLeft = left - LABEL_GAP - used;
      let labelAt: LabelAt = 'none';
      let labelW = 0;
      if (roomRight >= need) [labelAt, labelW] = ['right', need];
      else if (roomLeft >= need) [labelAt, labelW] = ['left', need];
      else if (Math.max(roomRight, roomLeft) >= LABEL_MIN) [labelAt, labelW] = roomRight >= roomLeft ? ['right', roomRight] : ['left', roomLeft];
      const labelX = labelAt === 'right' ? left + w + LABEL_GAP : labelAt === 'left' ? left - LABEL_GAP - labelW : 0;
      used = labelAt === 'right' ? labelX + labelW : left + w;
      return { key: get.key(it), left, width: w, label, labelAt, labelX, labelW, item: it };
    });
  });
  const todayX = px(today);
  const scrollTo = avail > 0 && width > avail ? Math.max(0, todayX - avail / 3) : 0;
  return { width, start: s, end: e, todayX, scrollTo, axis: axisLabels(s, e, width, ms(today), locale, todayText), lanes, px };
}

export interface Milestone {
  key: string;
  x: number;
  kind: Round['kind'];
  status: Round['status'];
  title: string;
}

export const roundLabel = (t: Translator['t'], r: Round) => r.title || t('round', { n: r.n });

/**
 * A project's rounds: from three days before the first start (or today) to four days after the
 * last due date. `null` when the project has no rounds (the card shows `dl.noRounds`).
 * `avail` is the container's width in px (0 before it is measured).
 */
export function projectTimeline(s: State, t: Translator['t'], locale: string, projectId: Id, today: IsoDate, avail: number): (TimelineLayout<Round> & { milestones: Milestone[] }) | null {
  const rounds = projectRounds(s, projectId);
  if (rounds.length === 0) return null;
  const range = { s: Math.min(...rounds.map((r) => ms(r.start)), ms(today) - 3 * DAY), e: Math.max(...rounds.map((r) => ms(r.due)), ms(today)) + 4 * DAY };
  const l = layout(rounds, range, avail, 800, today, locale, t('tl.today'), { key: (r) => r.id, start: (r) => r.start, due: (r) => r.due, label: (r) => roundLabel(t, r) });
  const milestones = rounds.map((r) => ({ key: r.id, x: l.px(r.due), kind: r.kind, status: r.status, title: roundLabel(t, r) }));
  return { ...l, milestones };
}

export interface HomeBar {
  round: Round;
  projectId: Id;
  name: string;
  tone: ProjectTone;
}

/** Each project's colour: its own hash of the avatar tokens, or the next free one when two projects would share it. */
export function projectTones(pids: Id[]): Map<Id, ProjectTone> {
  const tone = new Map<Id, ProjectTone>();
  for (const pid of pids) {
    let n: number = avatarTone(pid);
    for (let k = 0; k < 8 && [...tone.values()].includes(n as ProjectTone); k++) n = (n % 8) + 1;
    tone.set(pid, n as ProjectTone);
  }
  return tone;
}

/**
 * Every round of the viewer's projects on one track (Home's timeline card), packed into lanes so
 * parallel rounds all show, each bar 「项目名 轮次名」 in its project's colour. The window is two
 * weeks back to ten weeks ahead; `all` widens it to every round. `null` when no project has a
 * round (`tl.noneHome`). A bar opens that project's Deliveries at its round.
 */
export function homeTimeline(
  s: State,
  t: Translator['t'],
  locale: string,
  me: Id,
  today: IsoDate,
  avail: number,
  all: boolean,
): (TimelineLayout<HomeBar> & { legend: { projectId: Id; name: string; tone: ProjectTone }[]; projectIds: Id[] }) | null {
  const pids = [...myProjectIds(s, me)].sort();
  const tones = projectTones(pids);
  const name = (pid: Id) => s.projects[pid]?.name ?? pid;
  const bars: HomeBar[] = pids.flatMap((pid) => projectRounds(s, pid).map((round) => ({ round, projectId: pid, name: name(pid), tone: tones.get(pid)! })));
  if (bars.length === 0) return null;
  const range =
    all
      ? { s: Math.min(...bars.map((b) => ms(b.round.start)), ms(today) - 3 * DAY), e: Math.max(...bars.map((b) => ms(b.round.due)), ms(today)) + 4 * DAY }
      : { s: ms(today) - 14 * DAY, e: ms(today) + 70 * DAY };
  const shown = bars.filter((b) => ms(b.round.due) + DAY > range.s && ms(b.round.start) < range.e);
  const l = layout(shown, range, avail, 720, today, locale, t('tl.today'), {
    key: (b) => `${b.projectId}-${b.round.id}`,
    start: (b) => b.round.start,
    due: (b) => b.round.due,
    label: (b) => `${b.name} ${roundLabel(t, b.round)}`,
  });
  const legend = pids.filter((pid) => bars.some((b) => b.projectId === pid)).map((pid) => ({ projectId: pid, name: name(pid), tone: tones.get(pid)! }));
  return { ...l, legend, projectIds: pids };
}
