import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { noDots, projectRounds, type Id } from '@meetless/core';
import { ST_TONE } from '@renderer/ui/tone';
import type { MessageKey } from '@meetless/i18n';
import { Button, Card, Pill, Screen, Status, Text, TextField } from '@/components/ui';
import { useApp, useGo, useProjectId } from '@/state';
import { space, useLayout } from '@/theme';
import { DeliveriesPhone } from './DeliveriesPhone';
import { ProjectTimeline } from '../../timeline/ui/ProjectTimeline';
import { NeedChip, Row, SectionLabel, themeTone, useContainerWidth } from '../../inputs/ui/common';
import { deliverySections, draftItems, feedbackLine, roundHeader, type DeliverySection } from '../model';

/**
 * 交付: A1's project timeline, then each round's delivery, newest first. Tapping a bar keeps only
 * that round (tap again to clear); `?round=` preselects.
 */
export function DeliveriesScreen({ round }: { round?: number }) {
  const { live, t } = useApp();
  const projectId = useProjectId();
  const go = useGo();
  const [selected, setSelected] = useState<number | null>(round ?? null);
  useEffect(() => setSelected(round ?? null), [round]);
  const [w, onLayout] = useContainerWidth();
  const rounds = projectRounds(live, projectId);
  const { phone } = useLayout();
  if (phone) return <DeliveriesPhone projectId={projectId} round={round} />;

  return (
    <Screen title={t('dl.title')}>
      <View onLayout={onLayout} style={{ gap: space[4] }} testID="page-deliveries">
        {rounds.length === 0 ? (
          <View style={{ gap: space[2], alignItems: 'flex-start' }}>
            <Text color="textSecondary">{t('dl.noRounds')}</Text>
            <Button testID="dl-set-rounds" label={t('dl.setRounds')} onPress={() => go({ view: 'rounds', projectId })} />
          </View>
        ) : (
          <>
            <ProjectTimeline projectId={projectId} selected={selected} onSelect={setSelected} events="on" />
            {deliverySections(live, projectId, selected).map((s) => (
              <RoundCard key={s.round.id} projectId={projectId} section={s} twoCol={w >= 620} />
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

function AccountRow({ projectId, needId, status, note }: { projectId: Id; needId: Id; status: string; note?: string | null }) {
  const { t } = useApp();
  return (
    <Row wrap>
      <NeedChip projectId={projectId} needId={needId} status={false} />
      <Status label={t(`st.${status}` as MessageKey)} tone={themeTone(ST_TONE[status as keyof typeof ST_TONE])} />
      {note ? (
        <Text size="xs" color="textSecondary">
          {noDots(note)}
        </Text>
      ) : null}
    </Row>
  );
}

function Items({ items }: { items: string[] }) {
  const { t } = useApp();
  if (items.length === 0)
    return (
      <Text size="sm" color="textSecondary">
        {t('dl.noItems')}
      </Text>
    );
  return (
    <View style={{ gap: space[1] }}>
      {items.map((it, i) => (
        <Text key={i} size="sm">
          {noDots(it)}
        </Text>
      ))}
    </View>
  );
}

function RoundCard({ projectId, section, twoCol }: { projectId: Id; section: DeliverySection; twoCol: boolean }) {
  const { live, t, fmtDay, submit, today } = useApp();
  const { round, delivered, draft, feedback } = section;
  const h = roundHeader(t, fmtDay, round);
  const [form, setForm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (form === null) return;
    setBusy(true);
    const r = await submit('round.delivered', { roundId: round.id, date: today, items: draftItems(form) });
    setBusy(false);
    if (r.kind !== 'rejected') setForm(null);
  };
  const grid = (a: ReactNode, b: ReactNode) => (
    <View style={[{ gap: space[3] }, twoCol && { flexDirection: 'row' }]}>
      {/* flex: 1 only side by side: stacked, a zero flex basis squeezed the second half under what follows. */}
      <View style={[{ gap: space[1] }, twoCol && { flex: 1 }]}>{a}</View>
      <View style={[{ gap: space[1] }, twoCol && { flex: 1 }]}>{b}</View>
    </View>
  );
  return (
    <Card testID="dl-round" style={round.status === 'planned' ? { opacity: 0.8 } : undefined}>
      <Row wrap>
        <Text weight="semibold">{h.title}</Text>
        <Pill label={t(h.statusKey)} tone={themeTone(section.tone)} />
        <Text size="xs" color="textSecondary">
          {h.meta}
        </Text>
      </Row>
      {round.status === 'delivered' && delivered ? (
        <>
          <Text size="sm" color="textSecondary">
            {t('dl.deliveredOn', { d: fmtDay(delivered.date) })}
          </Text>
          {grid(
            <>
              <SectionLabel>{t('dl.items')}</SectionLabel>
              <Items items={delivered.items} />
            </>,
            <>
              <SectionLabel>{t('dl.account')}</SectionLabel>
              {delivered.account.map((a) => (
                <AccountRow key={a.needId} projectId={projectId} needId={a.needId} status={a.status} note={a.note} />
              ))}
            </>,
          )}
          <SectionLabel>{t('dl.feedback')}</SectionLabel>
          {feedback.length === 0 ? (
            <Text size="sm" color="textSecondary">
              {t('dl.noFeedback')}
            </Text>
          ) : (
            feedback.map((f) => {
              const l = feedbackLine(live, t, f);
              return (
                <View key={f.id} style={{ gap: space[1] }}>
                  <Text size="sm" color="textSecondary">
                    {l.text}
                  </Text>
                  <NeedChip projectId={projectId} needId={l.needId} />
                </View>
              );
            })
          )}
        </>
      ) : null}
      {round.status === 'current' && draft ? (
        <>
          <Row wrap>
            <Pill label={t('app.rules')} tone="ai" />
            <Text size="sm">{t('dl.draft')}</Text>
          </Row>
          {grid(
            <>
              <SectionLabel>{t('dl.planned')}</SectionLabel>
              <Items items={draft.items} />
            </>,
            <>
              <SectionLabel>{t('dl.account')}</SectionLabel>
              {draft.account.map((a) => (
                <AccountRow key={a.needId} projectId={projectId} needId={a.needId} status={a.status} />
              ))}
            </>,
          )}
          {form === null ? (
            <Button testID="dl-deliver" label={t('dl.deliver')} variant="primary" onPress={() => setForm(draft.items.join('\n'))} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <View style={{ gap: space[2] }}>
              <TextField testID="dl-items" multiline value={form} onChangeText={setForm} placeholder={t('dl.itemPh')} style={{ minHeight: 120 }} />
              <Row>
                <Button label={t('common.cancel')} onPress={() => setForm(null)} />
                <Button testID="dl-confirm" label={t('dl.confirm')} variant="primary" busy={busy} onPress={() => void confirm()} />
              </Row>
            </View>
          )}
        </>
      ) : null}
      {round.status === 'planned' ? (
        <Text size="sm" color="textSecondary">
          {t('dl.none')}
        </Text>
      ) : null}
    </Card>
  );
}



