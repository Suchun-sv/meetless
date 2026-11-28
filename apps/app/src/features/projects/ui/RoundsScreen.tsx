import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { daysBetween, projectRounds, SEP, type Id, type Round } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { canSubmitRound, ddlStart, nextRoundDraft, roundCreateCommand, roundDraftError, roundUpdateCommand, type RoundDraft } from '@renderer/setup/model';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { newId, useApp, useProjectId } from '@/state';
import { colors, radius, space } from '@/theme';
import { leftText } from '../../dashboard/model/rows';
import { ProjectTimeline } from '../../timeline/ui/ProjectTimeline';
import { DateField, H2 } from './fields';

const STATUS_COLOR = { current: 'info', planned: 'textSecondary', delivered: 'success' } as const;

function RoundFields({ prefix, draft, onChange }: { prefix: string; draft: RoundDraft; onChange: (d: RoundDraft) => void }) {
  const { t } = useApp();
  return (
    <View style={styles.fields}>
      <View style={{ flex: 1, minWidth: 180 }}>
        <TextField value={draft.title} onChangeText={(v) => onChange({ ...draft, title: v })} placeholder={t('pj.roundTitle')} accessibilityLabel={t('pj.roundTitle')} testID={`${prefix}-title`} />
      </View>
      <DateField value={draft.start} onChange={(v) => onChange({ ...draft, start: v })} label={t('pj.roundStart')} testID={`${prefix}-start`} />
      <DateField value={draft.due} onChange={(v) => onChange({ ...draft, due: v })} label={t('pj.roundDue')} testID={`${prefix}-due`} />
    </View>
  );
}

/**
 * The project's DDLs: the timeline, one row per DDL (title, due date, days left, status as
 * coloured text) with 「设为当前」 on planned ones and inline edit on those not delivered, then
 * the add form. Delivered DDLs are frozen.
 */
export function RoundsScreen() {
  const { live, today, t, fmtDay, submit } = useApp();
  const projectId = useProjectId();
  const rounds = projectRounds(live, projectId);
  const [draft, setDraft] = useState<RoundDraft>(() => nextRoundDraft(rounds, today));
  const [addBusy, setAddBusy] = useState(false);
  const [addTried, setAddTried] = useState(false);
  const [editing, setEditing] = useState<Id | null>(null);
  const [editDraft, setEditDraft] = useState<RoundDraft | null>(null);
  const [editTried, setEditTried] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  if (!live.projects[projectId])
    return (
      <Screen>
        <Text color="textSecondary">{t('home.empty')}</Text>
      </Screen>
    );
  const addError = addTried ? roundDraftError(t, draft) : null;
  const addRound = async () => {
    setAddTried(true);
    if (!canSubmitRound(t, draft, addBusy)) return;
    const cmd = roundCreateCommand(projectId, draft, newId('rnd'), ddlStart(rounds, draft.due, today));
    setAddBusy(true);
    const r = await submit(cmd.type, cmd.payload);
    setAddBusy(false);
    if (r.kind !== 'rejected') {
      setAddTried(false);
      setDraft(nextRoundDraft([...rounds, { due: draft.due } as Round], today));
    }
  };
  const startEdit = (r: Round) => {
    setEditing(r.id);
    setEditDraft({ title: r.title, kind: r.kind, start: r.start, due: r.due });
    setEditTried(false);
  };
  const saveEdit = async (r: Round) => {
    if (!editDraft) return;
    setEditTried(true);
    if (!canSubmitRound(t, editDraft, editBusy)) return;
    const cmd = roundUpdateCommand(r, editDraft);
    if (!cmd) return setEditing(null);
    setEditBusy(true);
    const res = await submit(cmd.type, cmd.payload);
    setEditBusy(false);
    if (res.kind !== 'rejected') setEditing(null);
  };

  return (
    <Screen title={t('pj.rounds')}>
      <View testID="page-rounds">
        <ProjectTimeline projectId={projectId} />
      </View>
      {rounds.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('pj.noRounds')}
        </Text>
      ) : (
        <View style={{ gap: space[2] }}>
          {rounds.map((r) => {
            const isEditing = editing === r.id && editDraft;
            return (
              <View key={r.id} style={styles.round} testID="round">
                {isEditing ? (
                  <View style={{ gap: space[2] }}>
                    <RoundFields prefix="round-edit" draft={editDraft} onChange={setEditDraft} />
                    {editTried && roundDraftError(t, editDraft) ? (
                      <Text size="sm" color="danger" testID="round-edit-error">
                        {roundDraftError(t, editDraft)!}
                      </Text>
                    ) : null}
                    <View style={styles.line}>
                      <Button size="sm" variant="primary" label={t('common.save')} busy={editBusy} testID="round-edit-save" onPress={() => void saveEdit(r)} />
                      <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => setEditing(null)} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.line}>
                    <Text style={{ flex: 1, minWidth: 160 }}>
                      {r.title || t('round', { n: r.n })}
                      <Text size="sm" color="textSecondary">
                        {`${SEP}${fmtDay(r.due)}${r.status !== 'delivered' ? `${SEP}${leftText(t, daysBetween(today, r.due))}` : ''}`}
                      </Text>
                    </Text>
                    <Text size="xs" weight="medium" color={STATUS_COLOR[r.status]} tight>
                      {t(`round.${r.status}` as MessageKey)}
                    </Text>
                    {r.status === 'planned' ? <Button size="sm" label={t('round.makeCurrent')} testID="round-start-now" onPress={() => void submit('round.started', { roundId: r.id })} /> : null}
                    {r.status !== 'delivered' ? <Button size="sm" label={t('pj.edit')} testID="round-edit" onPress={() => startEdit(r)} /> : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <H2>{t('pj.addRound')}</H2>
      <View style={{ gap: space[2] }}>
        <RoundFields prefix="round" draft={draft} onChange={setDraft} />
        {addError ? (
          <Text size="sm" color="danger" testID="round-error">
            {addError}
          </Text>
        ) : null}
        <Button variant="primary" label={t('pj.addRound')} busy={addBusy} testID="round-add" onPress={() => void addRound()} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  round: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[3], backgroundColor: colors.bg },
});
