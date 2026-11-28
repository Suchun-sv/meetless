import { StyleSheet, View } from 'react-native';
import { Avatar, Card, Status, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, space } from '@/theme';
import type { CardVM, HandoffLineVM } from './model/board';
import { Row, themeTone } from './ui/kit';

/** A handoff as one line of text (`ho.from` / `ho.to` / `ho.fromTo` plus state); sent to me and unanswered reads in the info tone. */
export function HandoffText({ h }: { h: HandoffLineVM }) {
  const { t } = useApp();
  const who = h.dir === 'from' ? t('ho.from', { who: h.from }) : h.dir === 'to' ? t('ho.to', { who: h.to }) : t('ho.fromTo', { from: h.from, to: h.to });
  return (
    <Text size="xs" tight color={h.hot ? 'info' : 'textSecondary'} weight={h.hot ? 'medium' : 'regular'} numberOfLines={1} style={{ flexShrink: 1 }}>
      {`${who} ${t(`ho.st.${h.state}`)}`}
    </Text>
  );
}

/** A board card: code, only-me mark, status, title, who asked and evidence, then handoff or To-confirm mark and the owner. */
export function NeedCard({ c, selected, onPress }: { c: CardVM; selected?: boolean; onPress: () => void }) {
  const { t } = useApp();
  const who = c.requester.self ? t('card.self') : c.requester.name;
  const meta = c.evidence > 0 ? `${who}  ${t('card.evidence', { n: c.evidence })}` : who;
  return (
    <Card dense selected={selected} onPress={onPress} testID="need-card" style={[c.kind === 'hyp' && styles.hyp, c.status === 'refuted' && styles.refuted]}>
      <Row>
        <Text size="xs" mono color="textTertiary" tight>
          {c.code}
        </Text>
        {c.private ? (
          <Text size="xs" color="textSecondary" tight>
            {t('pv.mine')}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Status label={t(`st.${c.status}`)} tone={themeTone(c.tone)} />
      </Row>
      <Text size="sm" weight="medium" numberOfLines={3}>
        {c.title}
      </Text>
      <Text size="xs" color="textSecondary" tight numberOfLines={1}>
        {meta}
      </Text>
      {c.footer ? (
        <Row style={styles.foot}>
          {c.handoff ? (
            <HandoffText h={c.handoff} />
          ) : c.pending ? (
            <Text size="xs" color="warning" weight="medium" tight>
              {t('ask.btn')}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {c.ownerId ? <Avatar userId={c.ownerId} size="sm" /> : null}
        </Row>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  hyp: { borderStyle: 'dashed', borderColor: colors.borderStrong },
  refuted: { opacity: 0.7 },
  foot: { paddingTop: space[1] },
});
