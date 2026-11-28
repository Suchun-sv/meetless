import { StyleSheet, View } from 'react-native';
import {
  activityCard,
  currentRound,
  deliveryCard,
  hypothesesCard,
  membersCard,
  progressCard,
  projectRounds,
  riskList,
  sourcesCard,
  weeklyCard,
  SEP,
  type CardId,
  type Id,
  type Risk,
} from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { Avatar, Button, Text } from '@/components/ui';
import { displayName, useApp, useGo } from '@/state';
import { space } from '@/theme';
import { ProjectTimeline } from '../../timeline/ui/ProjectTimeline';
import { HYP_CARD_STATUSES, leftText, riskTarget, riskText, riskTone } from '../model/rows';
import { Bar, CardEmpty, Faint, NeedChip, NeedStatusText, Row, styles as ps, toneColor } from './parts';

/*
 * The project dashboard cards. Each reads core's card functions, which already leave out
 * private items, so none of these filter on their own.
 */

function useRiskNav(): (r: Risk) => void {
  const go = useGo();
  return (r) => {
    const target = riskTarget(r);
    if (target.kind === 'need') go({ view: 'board', projectId: target.projectId, needId: target.needId });
    else if (target.kind === 'confirm') go({ view: 'confirm', projectId: target.projectId });
    else go({ view: 'inputs', projectId: target.projectId });
  };
}

function Progress({ projectId }: { projectId: Id }) {
  const { live, t, today, fmtDay } = useApp();
  const go = useGo();
  const pc = progressCard(live, projectId, today);
  if (!pc.round) {
    return (
      <View style={{ gap: space[2], alignItems: 'flex-start' }}>
        <Text size="xl" weight="semibold">
          {leftText(t, null)}
        </Text>
        <Button size="sm" label={t('pg.setRounds')} testID="pg-set-rounds" onPress={() => go({ view: 'rounds', projectId })} />
      </View>
    );
  }
  const { round } = pc;
  return (
    <View style={{ gap: space[2] }}>
      <View>
        <Text size="xl" weight="semibold">
          {leftText(t, pc.daysLeft)}
        </Text>
        <Text size="sm" color="textSecondary">
          {[round.title || t('round', { n: round.n }), t('round.due', { d: fmtDay(round.due) })].join(SEP)}
        </Text>
      </View>
      <Bar a={pc.done} b={pc.ext} />
      <View style={[ps.line, { columnGap: space[4] }]}>
        {[t('pg.done', { a: pc.done, b: pc.ext }), t('pg.doing', { n: pc.doing }), t('pg.todo', { n: pc.todo }), t('pg.hyp', { n: pc.hypTesting })].map((s) => (
          <Text key={s} size="sm" color="textSecondary" tight>
            {s}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Risks({ projectId }: { projectId: Id }) {
  const { live, me, t, today } = useApp();
  const nav = useRiskNav();
  const list = riskList(live, me, projectId, today);
  if (!list.length) return <Faint>{t('rk.none')}</Faint>;
  return (
    <View style={ps.stack}>
      {list.map((r, i) => (
        <Row key={i} tinted onPress={() => nav(r)} style={{ flexWrap: 'wrap' }}>
          <Text size="sm" style={{ flex: 1, minWidth: 160, color: toneColor(riskTone(r)) }}>
            {riskText(t, live, r)}
          </Text>
          {r.needId ? <NeedChip projectId={projectId} needId={r.needId} /> : null}
        </Row>
      ))}
    </View>
  );
}

function Members({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay } = useApp();
  return (
    <View style={{ gap: space[3] }}>
      {membersCard(live, projectId).map((row) => (
        <View key={row.userId} style={styles.member}>
          <Avatar userId={row.userId} />
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <View style={ps.line}>
              <Text size="sm" weight="semibold" tight numberOfLines={1} style={{ flexShrink: 1 }}>
                {displayName(live, row.userId)}
              </Text>
              <Text size="xs" color="textTertiary" tight numberOfLines={1}>
                {row.role ?? t('pj.noRole')}
              </Text>
              <View style={{ flex: 1 }} />
              <Text size="xs" color="textSecondary" tight>
                {t('mb.owns', { n: row.owns })}
              </Text>
            </View>
            <Text size="sm" color="textSecondary" numberOfLines={2}>
              {row.last ? [fmtDay(row.last.date), row.last.text].join(SEP) : t('mb.none')}
            </Text>
            {row.handoffs.map((h) => (
              <Text key={h.id} size="xs" color="textTertiary" tight numberOfLines={1}>
                {[
                  live.needs[h.needId]?.code ?? '',
                  h.toId === row.userId ? t('ho.from', { who: displayName(live, h.fromId) }) : t('ho.to', { who: displayName(live, h.toId) }),
                  t(`ho.st.${h.state}` as MessageKey),
                ].join(SEP)}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Line({ projectId, needId, status }: { projectId: Id; needId: Id; status: Parameters<typeof NeedStatusText>[0]['s'] }) {
  return (
    <View style={[ps.line, { flexWrap: 'nowrap' }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <NeedChip projectId={projectId} needId={needId} />
      </View>
      <NeedStatusText s={status} />
    </View>
  );
}

function Delivery({ projectId }: { projectId: Id }) {
  const { live, t } = useApp();
  const go = useGo();
  const dc = deliveryCard(live, projectId);
  if (!dc.round) return <CardEmpty text={t('pg.noRound')} action={t('pg.setRounds')} onAction={() => go({ view: 'rounds', projectId })} />;
  if (!dc.lines.length) return <CardEmpty text={t('db.deliveryEmpty')} action={t('db.openInputs')} onAction={() => go({ view: 'inputs', projectId })} />;
  return (
    <View style={ps.stack}>
      {dc.lines.map((line) => (
        <Line key={line.needId} projectId={projectId} needId={line.needId} status={line.status} />
      ))}
    </View>
  );
}

function Hyps({ projectId }: { projectId: Id }) {
  const { live, t } = useApp();
  const go = useGo();
  const hc = hypothesesCard(live, projectId);
  return (
    <View style={{ gap: space[3] }}>
      <View style={styles.hyRow}>
        {HYP_CARD_STATUSES.map((s) => (
          <View key={s} style={styles.hyCell}>
            <Text size="xl" weight="semibold" tight>
              {String(hc.counts[s])}
            </Text>
            <NeedStatusText s={s} />
          </View>
        ))}
      </View>
      {hc.recent.length === 0 ? <CardEmpty text={t('db.hypsEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} /> : null}
      {hc.recent.map((needId) => (live.needs[needId] ? <Line key={needId} projectId={projectId} needId={needId} status={live.needs[needId]!.status} /> : null))}
    </View>
  );
}

function Activity({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay } = useApp();
  const go = useGo();
  const items = activityCard(live, projectId);
  if (!items.length) return <CardEmpty text={t('db.activityEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} />;
  return (
    <View style={{ gap: space[2] }}>
      {items.map((w) => (
        <View key={w.id} style={[ps.line, { flexWrap: 'nowrap', alignItems: 'flex-start' }]}>
          <Text size="xs" color="textTertiary" tight style={{ width: 52, paddingTop: 3 }}>
            {fmtDay(w.date)}
          </Text>
          <Avatar userId={w.by} size="sm" />
          <View style={{ flex: 1, gap: space[1], minWidth: 0 }}>
            <Text size="sm" numberOfLines={2}>
              {w.text}
            </Text>
            {w.needId ? <NeedChip projectId={projectId} needId={w.needId} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Sources({ projectId }: { projectId: Id }) {
  const { live, t } = useApp();
  const go = useGo();
  const rows = sourcesCard(live, projectId);
  if (!rows.length) return <CardEmpty text={t('db.sourcesEmpty')} action={t('db.openInputs')} onAction={() => go({ view: 'inputs', projectId })} />;
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <View style={{ gap: space[2] }}>
      {rows.map((row) => (
        <View key={row.key} style={[ps.line, { flexWrap: 'nowrap' }]}>
          <Text size="sm" tight numberOfLines={1} style={{ width: 96 }}>
            {row.userId ? displayName(live, row.userId) : (row.name ?? '')}
          </Text>
          <Bar a={row.count} b={max} grow />
          <Text size="xs" color="textTertiary" tight>
            {t('sr.count', { n: row.count })}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Weekly({ projectId }: { projectId: Id }) {
  const { live, t, today } = useApp();
  const go = useGo();
  const rows = weeklyCard(live, projectId, today);
  if (!rows.length) return <CardEmpty text={t('db.weeklyEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} />;
  return (
    <View style={{ gap: space[2] }}>
      {rows.map((row) => (
        <View key={row.userId} style={styles.member}>
          <Avatar userId={row.userId} size="sm" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={ps.line}>
              <Text size="sm" weight="semibold" tight>
                {displayName(live, row.userId)}
              </Text>
              <Text size="xs" color="textTertiary" tight>
                {t('wk.items', { n: row.count })}
              </Text>
            </View>
            <Text size="sm" color="textSecondary" numberOfLines={2}>
              {row.last.text}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The project's rounds with the today line; a round opens Deliveries at it (the current one when none is tapped). */
function RoundsCard({ projectId }: { projectId: Id }) {
  const { live, t } = useApp();
  const go = useGo();
  const cur = currentRound(live, projectId);
  if (projectRounds(live, projectId).length === 0) return <Faint>{t('dl.noRounds')}</Faint>;
  return (
    <ProjectTimeline
      projectId={projectId}
      events="on"
      selected={cur?.n ?? null}
      onSelect={(n) => go({ view: 'deliveries', projectId, ...(n !== null ? { round: n } : cur ? { round: cur.n } : {}) })}
    />
  );
}

/** One project dashboard card's body, by id. */
export function ProjectCard({ id, projectId }: { id: CardId; projectId: Id }) {
  switch (id) {
    case 'timeline':
      return <RoundsCard projectId={projectId} />;
    case 'progress':
      return <Progress projectId={projectId} />;
    case 'risks':
      return <Risks projectId={projectId} />;
    case 'members':
      return <Members projectId={projectId} />;
    case 'delivery':
      return <Delivery projectId={projectId} />;
    case 'hyps':
      return <Hyps projectId={projectId} />;
    case 'activity':
      return <Activity projectId={projectId} />;
    case 'sources':
      return <Sources projectId={projectId} />;
    case 'weekly':
      return <Weekly projectId={projectId} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  member: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  hyRow: { flexDirection: 'row', gap: space[2] },
  hyCell: { flex: 1, alignItems: 'flex-start', gap: 2 },
});
