import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { noDots, projectRounds, type Id, type IsoDate, type NeedStatus, type State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { ST_TONE } from '@renderer/ui/tone';
import { Button, Sheet, Text, TextField } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space, tones, type ColorName } from '@/theme';
import { urgencyTone } from '@/ui/urgency';
import { PHONE_BOTTOM } from '../../artifacts/ui/ArtifactsPhone';
import { themeTone } from '../../inputs/ui/common';
import { Icon } from '../../inputs/ui/icons';
import { deliverySections, draftItems, feedbackLine, type DeliverySection } from '../model';

function daysLeft(today: IsoDate, due: IsoDate): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

const STATUS_COLOR: Record<string, ColorName> = { current: 'info', planned: 'textTertiary', delivered: 'success' };

interface CardData {
  items: string[];
  account: { needId: Id; status: NeedStatus; note?: string | null }[];
}

/** What a round's card lists: the draft for the current one, the frozen delivery, or what is planned so far. */
function cardData(s: State, section: DeliverySection): CardData {
  const { round, draft, delivered } = section;
  if (round.status === 'delivered' && delivered) return { items: delivered.items, account: delivered.account };
  if (draft) return draft;
  const account = Object.values(s.needs)
    .filter((n) => n.roundId === round.id && n.kind === 'ext' && n.privateTo === null)
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((n) => ({ needId: n.id, status: n.status }));
  return { items: round.items, account };
}

/**
 * 项目 › 交付 on phones (mobile-v1 09): the current deadline as a card with 「标记为已交付」 under
 * its needs, then the other deadlines as rows that open in place into the same card, read-only.
 */
export function DeliveriesPhone({ projectId, round }: { projectId: Id; round?: number }) {
  const { live, t } = useApp();
  const go = useGo();
  const sections = deliverySections(live, projectId, null);
  const cur = sections.find((s) => s.round.status === 'current') ?? null;
  const rest = sections.filter((s) => s !== cur);
  const [open, setOpen] = useState<number | null>(round ?? null);

  if (projectRounds(live, projectId).length === 0 || !cur) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: PHONE_BOTTOM }}>
        <View style={{ padding: space[5], gap: space[3], alignItems: 'flex-start' }}>
          <Text color="textSecondary">{t('dl.m.noCurrent')}</Text>
          <Button testID="dl-set-rounds" label={t('dl.m.addRound')} onPress={() => go({ view: 'rounds', projectId })} />
        </View>
        <Folded projectId={projectId} rest={rest} open={open} setOpen={setOpen} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: PHONE_BOTTOM }} testID="page-deliveries-phone">
      <RoundCard projectId={projectId} section={cur} />
      <Folded projectId={projectId} rest={rest} open={open} setOpen={setOpen} />
    </ScrollView>
  );
}

function Folded({ projectId, rest, open, setOpen }: { projectId: Id; rest: DeliverySection[]; open: number | null; setOpen: (n: number | null) => void }) {
  const { t, fmtDay, today } = useApp();
  return (
    <View style={{ marginTop: 22 }}>
      {rest.map((s, i) => {
        const r = s.round;
        const isOpen = open === r.n;
        return (
          <View key={r.id}>
            <Pressable testID="dl-row" accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : r.n)} style={({ pressed }) => [st.dr, pressed && { backgroundColor: colors.hover }]}>
              {i > 0 ? <View style={st.sep} /> : null}
              <Text size="base" color={STATUS_COLOR[r.status] ?? 'textTertiary'}>
                {t(`round.${r.status}` as MessageKey)}
              </Text>
              <Text size="base" style={{ color: r.status === 'delivered' ? colors.textTertiary : urgencyTone(daysLeft(today, r.due)).fg }}>
                {fmtDay(r.status === 'delivered' && r.delivery ? r.delivery.date : r.due)}
              </Text>
              <Text size="md" numberOfLines={1} style={{ flex: 1 }}>
                {noDots(r.title) || t('round', { n: r.n })}
              </Text>
              <View style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}>
                <Icon name="chevron-right" size={17} />
              </View>
            </Pressable>
            {isOpen ? <RoundCard projectId={projectId} section={s} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function NeedLine({ projectId, needId, status }: { projectId: Id; needId: Id; status: NeedStatus }) {
  const { live, t } = useApp();
  const go = useGo();
  const n = live.needs[needId];
  if (!n || n.projectId !== projectId) return null;
  const tone = themeTone(ST_TONE[status]);
  return (
    <Pressable style={st.nr} onPress={() => go({ view: 'board', projectId, needId })} testID="dl-need">
      <Text size="sm" mono color="textTertiary" style={{ width: 30 }}>
        {n.code}
      </Text>
      <Text size="md" numberOfLines={2} style={{ flex: 1 }}>
        {noDots(n.title)}
      </Text>
      <Text size="base" style={{ color: status === 'met' ? colors.success : tone === 'neutral' ? colors.textTertiary : tones[tone].fg }}>
        {t(`st.${status}` as MessageKey)}
      </Text>
    </Pressable>
  );
}

/** One deadline as a card. Only the current one has 「标记为已交付」; a delivered one shows its feedback. */
function RoundCard({ projectId, section }: { projectId: Id; section: DeliverySection }) {
  const { live, t, fmtDay, today, submit } = useApp();
  const go = useGo();
  const { round, feedback } = section;
  const data = cardData(live, section);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const left = daysLeft(today, round.due);
  const met = data.account.filter((a) => a.status === 'met').length;
  const isCur = round.status === 'current';
  const delivered = round.status === 'delivered' ? round.delivery : null;

  const deliver = async () => {
    setBusy(true);
    const r = await submit('round.delivered', { roundId: round.id, date: today, items: draftItems(text) });
    setBusy(false);
    if (r.kind !== 'rejected') setConfirming(false);
  };

  return (
    <View style={st.cur} testID="dl-round">
      <View style={st.ch}>
        <Text size="lg" weight="semibold" style={{ flex: 1 }}>
          {noDots(round.title) || t('round', { n: round.n })}
        </Text>
        <Text size="base" weight="semibold" color={STATUS_COLOR[round.status] ?? 'textTertiary'}>
          {t(`round.${round.status}` as MessageKey)}
        </Text>
      </View>
      <View style={st.cm}>
        {delivered ? (
          <Text size="base" color="textSecondary">
            {t('dl.deliveredOn', { d: fmtDay(delivered.date) })}
          </Text>
        ) : (
          <>
            <Text size="base" color="textSecondary">
              {t('round.due', { d: fmtDay(round.due) })}
            </Text>
            <Text size="base" style={{ color: urgencyTone(left, data.account.length > 0 && met === data.account.length).fg }}>
              {t('round.left', { n: Math.max(0, left) })}
            </Text>
          </>
        )}
      </View>

      <Text size="sm" weight="medium" color="textSecondary" style={st.lb}>
        {delivered ? t('dl.items') : t('dl.planned')}
      </Text>
      {data.items.length === 0 ? (
        <Pressable onPress={() => go({ view: 'rounds', projectId })}>
          <Text size="md" color="textTertiary">
            {t('dl.m.noPlan')}
          </Text>
        </Pressable>
      ) : (
        data.items.map((it, i) => (
          <Text key={i} size="md" style={{ lineHeight: 26 }}>
            {noDots(it)}
          </Text>
        ))
      )}

      <View style={st.lbRow}>
        <Text size="sm" weight="medium" color="textSecondary">
          {t('dl.m.needs')}
        </Text>
        <Text size="sm" weight="medium" color="textSecondary">
          {t('dl.m.done', { a: met, b: data.account.length })}
        </Text>
      </View>
      {data.account.map((a) => (
        <NeedLine key={a.needId} projectId={projectId} needId={a.needId} status={a.status} />
      ))}

      {delivered && feedback.length > 0 ? (
        <>
          <Text size="sm" weight="medium" color="textSecondary" style={st.lb}>
            {t('dl.feedback')}
          </Text>
          {feedback.map((f) => (
            <Text key={f.id} size="sm" color="textSecondary">
              {feedbackLine(live, t, f).text}
            </Text>
          ))}
        </>
      ) : null}

      {isCur ? (
        <Pressable
          testID="dl-deliver"
          accessibilityRole="button"
          onPress={() => {
            setText(data.items.join('\n'));
            setConfirming(true);
          }}
          style={({ pressed }) => [st.btn, pressed && { backgroundColor: colors.hover }]}
        >
          <Text size="md" weight="semibold">
            {t('dl.deliver')}
          </Text>
        </Pressable>
      ) : null}

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('dl.deliver')}
        footer={
          <>
            <Button label={t('common.cancel')} onPress={() => setConfirming(false)} />
            <Button testID="dl-confirm" label={t('dl.confirm')} variant="primary" busy={busy} onPress={() => void deliver()} />
          </>
        }
      >
        {data.account.length - met > 0 ? <Text color="warning">{t('dl.m.unfinished', { n: data.account.length - met })}</Text> : null}
        <TextField testID="dl-items" label={t('dl.items')} multiline value={text} onChangeText={setText} placeholder={t('dl.itemPh')} style={{ minHeight: 110 }} />
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  cur: { marginTop: 18, marginHorizontal: space[4], backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: 14 },
  ch: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  cm: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, marginTop: 3 },
  lb: { marginTop: 14, marginBottom: 4 },
  lbRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 4 },
  nr: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingVertical: 6 },
  btn: { marginTop: 14, height: 42, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sheet },
  dr: { flexDirection: 'row', alignItems: 'center', columnGap: 12, paddingVertical: space[3], paddingHorizontal: space[5] },
  sep: { position: 'absolute', top: 0, left: space[5], right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
});
