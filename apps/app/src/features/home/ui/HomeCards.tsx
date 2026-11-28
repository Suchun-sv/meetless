import { Pressable, StyleSheet, View } from 'react-native';
import { allRisks, homeItems, projectsCard, SEP, type CardId, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { Avatar, Button, Pill, Text } from '@/components/ui';
import { useRouter, type Href } from 'expo-router';
import { displayName, routePath, useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { HomeTimeline } from '../../timeline/ui/HomeTimeline';
import { confirmRows, dueSoon, leftText, mineRows, riskText, riskTone } from '../../dashboard/model/rows';
import { Bar, Faint, NeedChip, NeedStatusText, Row, styles as ps, Tag, toneColor } from '../../dashboard/ui/parts';
import { handoffAnswer, type HandoffAnswer } from '../model/home';

/*
 * Home's cross-project cards. Each reads core's cross-project queries (`homeItems`, `allRisks`,
 * `projectsCard`), which already leave out other people's private items.
 */

function Projects() {
  const { live, me, t, today, fmtDay } = useApp();
  const go = useGo();
  return (
    <View style={styles.pj}>
      {projectsCard(live, me, today).map((row) => (
        <Pressable
          key={row.projectId}
          accessibilityRole="link"
          onPress={() => go({ view: 'dash', projectId: row.projectId })}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.pjItem, hovered && { borderColor: colors.borderStrong }]}
        >
          <View style={ps.line}>
            <Text weight="semibold" tight numberOfLines={1} style={{ flex: 1 }}>
              {live.projects[row.projectId]?.name ?? ''}
            </Text>
            <Text size="sm" tight color={dueSoon(row.daysLeft) ? 'warning' : 'textTertiary'}>
              {leftText(t, row.daysLeft)}
            </Text>
          </View>
          {row.round ? (
            <Text size="sm" color="textSecondary" tight numberOfLines={1}>
              {[row.round.title || t('round', { n: row.round.n }), t('round.due', { d: fmtDay(row.round.due) })].join(SEP)}
            </Text>
          ) : null}
          <Bar a={row.done} b={row.ext} />
          <Text size="xs" color="textTertiary" tight>
            {t('pg.done', { a: row.done, b: row.ext })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Confirm() {
  const { live, me, t, today } = useApp();
  const go = useGo();
  const rows = confirmRows(t, live, me, homeItems(live, me, today).confirm, today);
  if (!rows.length) return <Faint>{t('home.empty')}</Faint>;
  return (
    <View style={ps.stack}>
      {rows.map((row) => (
        <Row key={row.key} onPress={() => go({ view: 'confirm', projectId: row.projectId })}>
          <Tag projectId={row.projectId} />
          {row.tag === 'extract' ? <Pill tone="ai" label={t('app.rules')} /> : null}
          <Text size="sm" tight numberOfLines={1} style={{ flex: 1 }}>
            {row.text}
          </Text>
          {row.tag === 'conflict' ? <Pill tone="warning" label={t('cf.title')} /> : null}
          <Text size="xs" color="textTertiary" tight>
            {`${t('home.go')} ›`}
          </Text>
        </Row>
      ))}
    </View>
  );
}

function ToMe() {
  const { live, me, t, today, fmtDay, submit } = useApp();
  const router = useRouter();
  const link = (projectId: Id, needId: Id) => router.push(`${routePath({ view: 'handoff', projectId })}?need=${encodeURIComponent(needId)}&mode=link` as Href);
  const items = homeItems(live, me, today).toMe;
  if (!items.length) return <Faint>{t('home.empty')}</Faint>;
  const respond = (id: Id, r: HandoffAnswer) => void submit('handoff.responded', handoffAnswer(id, r));
  return (
    <View style={{ gap: space[3] }}>
      {items.map((item) => {
        const h = live.handoffs[item.handoffId];
        if (!h) return null;
        return (
          <View key={h.id} style={styles.item}>
            <View style={ps.line}>
              <Avatar userId={h.fromId} size="sm" />
              <Text size="sm" tight>
                {t('ho.from', { who: displayName(live, h.fromId) })}
              </Text>
              <Tag projectId={item.projectId} />
              <View style={{ flex: 1 }} />
              {h.due ? (
                <Text size="xs" color="textTertiary" tight>
                  {t('ho.dueOn', { d: fmtDay(h.due) })}
                </Text>
              ) : null}
            </View>
            <NeedChip projectId={item.projectId} needId={item.needId} />
            {h.ask ? (
              <Text size="sm" color="textSecondary" numberOfLines={3}>
                {h.ask}
              </Text>
            ) : null}
            {h.state === 'sent' ? (
              <View style={ps.line}>
                <Button size="sm" variant="primary" label={t('ho.accept')} testID="home-accept" onPress={() => respond(h.id, 'accepted')} />
                <Button size="sm" label={t('ho.question')} testID="home-ask" onPress={() => respond(h.id, 'asked')} />
                <Button size="sm" label={t('ho.decline')} testID="home-decline" onPress={() => respond(h.id, 'declined')} />
              </View>
            ) : (
              <View style={ps.line}>
                <Text size="xs" weight="medium" tight style={{ color: colors.info, flex: 1 }}>
                  {t(`ho.st.${h.state}` as MessageKey)}
                </Text>
                {h.state === 'accepted' || h.state === 'doing' ? <Button size="sm" label={t('lk.btn')} testID="home-link" onPress={() => link(item.projectId, item.needId)} /> : null}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function ByMe() {
  const { live, me, t, today } = useApp();
  const go = useGo();
  const items = homeItems(live, me, today).byMe;
  if (!items.length) return <Faint>{t('home.empty')}</Faint>;
  return (
    <View style={{ gap: space[2] }}>
      {items.map((item) => {
        const h = live.handoffs[item.handoffId];
        const n = live.needs[item.needId];
        if (!h || !n) return null;
        return (
          <Pressable
            key={h.id}
            accessibilityRole="link"
            onPress={() => go({ view: 'board', projectId: item.projectId, needId: item.needId })}
            style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered && { backgroundColor: colors.hover }]}
          >
            <View style={ps.line}>
              <Avatar userId={h.toId} size="sm" />
              <Text size="sm" tight>
                {[t('ho.to', { who: displayName(live, h.toId) }), t(`ho.st.${h.state}` as MessageKey)].join(SEP)}
              </Text>
              <Tag projectId={item.projectId} />
            </View>
            <Text size="sm" numberOfLines={2}>
              <Text size="sm" mono color="textTertiary">
                {n.code}
              </Text>
              {` ${n.title}`}
            </Text>
            {item.last ? (
              <Text size="sm" color="textSecondary" numberOfLines={2}>
                {item.last.text}
              </Text>
            ) : null}
            {item.stale !== null ? (
              <Text size="xs" color="warning" tight>
                {t('ho.stale', { v: item.stale })}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Mine() {
  const { live, me, t, today } = useApp();
  const go = useGo();
  const items = mineRows(live, me, homeItems(live, me, today).mine);
  if (!items.length) return <Faint>{t('mine.none')}</Faint>;
  return (
    <View style={ps.stack}>
      {items.map((item) => {
        const n = live.needs[item.needId];
        if (!n) return null;
        return (
          <Row key={item.needId} onPress={() => go({ view: 'board', projectId: item.projectId, needId: item.needId })}>
            <Tag projectId={item.projectId} />
            <Text size="xs" mono color="textTertiary" tight>
              {n.code}
            </Text>
            <Text size="sm" tight numberOfLines={1} style={{ flex: 1 }}>
              {n.title}
            </Text>
            <NeedStatusText s={n.status} />
          </Row>
        );
      })}
    </View>
  );
}

function Due() {
  const { live, me, t, today, fmtDay } = useApp();
  const go = useGo();
  const items = homeItems(live, me, today).due;
  if (!items.length) return <Faint>{t('home.empty')}</Faint>;
  return (
    <View style={ps.stack}>
      {items.map((item) => {
        const r = live.rounds[item.roundId];
        return (
          <Row key={item.projectId} onPress={() => go({ view: 'dash', projectId: item.projectId })}>
            <Text size="sm" tight numberOfLines={1} style={{ flex: 1 }}>
              {live.projects[item.projectId]?.name ?? ''}
              {r ? (
                <Text size="sm" color="textTertiary">
                  {`${SEP}${r.title || t('round', { n: r.n })}`}
                </Text>
              ) : null}
            </Text>
            <Text size="xs" tight color={dueSoon(item.daysLeft) ? 'warning' : 'textTertiary'}>
              {[r ? fmtDay(r.due) : '', leftText(t, item.daysLeft)].join(SEP)}
            </Text>
          </Row>
        );
      })}
    </View>
  );
}

function AllRisks() {
  const { live, me, t, today } = useApp();
  const go = useGo();
  const risks = allRisks(live, me, today);
  if (!risks.length) return <Faint>{t('rk.none')}</Faint>;
  return (
    <View style={ps.stack}>
      {risks.map((r, i) => (
        <Row key={i} tinted onPress={() => go({ view: 'dash', projectId: r.projectId })}>
          <Tag projectId={r.projectId} />
          <Text size="sm" style={{ flex: 1, color: toneColor(riskTone(r)) }}>
            {riskText(t, live, r)}
          </Text>
        </Row>
      ))}
    </View>
  );
}

/** One Home card's body, by id. */
export function HomeCard({ id }: { id: CardId }) {
  switch (id) {
    case 'timeline':
      return <HomeTimeline />;
    case 'projects':
      return <Projects />;
    case 'toMe':
      return <ToMe />;
    case 'confirm':
      return <Confirm />;
    case 'byMe':
      return <ByMe />;
    case 'mine':
      return <Mine />;
    case 'due':
      return <Due />;
    case 'allRisks':
      return <AllRisks />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  pj: { gap: space[2] },
  pjItem: { gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[4], backgroundColor: colors.bg },
  item: { gap: space[2], padding: space[2], borderRadius: radius.md },
});
