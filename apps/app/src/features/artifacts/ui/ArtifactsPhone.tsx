import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { noDots, type ArtifactKind, type Id } from '@meetless/core';
import { Button, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, space } from '@/theme';
import { ARTIFACT_ICON, Icon } from '../../inputs/ui/icons';
import { artifactList } from '../model';

/** The short type word in the meta line (design 08: Notion, Git, PDF, PPTX). */
const TYPE_WORD: Record<ArtifactKind, string> = { notion: 'Notion', code: 'Git', pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', overleaf: 'TeX' };

/** Bottom room under the last row (the shell's content area already stops above the ask bar and tab bar). The + lives in the shell header (useHeaderActions in ArtifactsScreen). */
export const PHONE_BOTTOM = 24;

/**
 * 项目 › 产物 on phones (mobile-v1 08): 「N 个产物」, one row per artifact (type icon, name, type,
 * where and date, linked need codes on the right), tap to preview, + to add.
 */
export function ArtifactsPhone({ projectId, onNew }: { projectId: Id; onNew: () => void }) {
  const { live, me, t, fmtDay } = useApp();
  const go = useGo();
  const list = artifactList(live, projectId);
  return (
    <ScrollView contentContainerStyle={{ paddingTop: space[3], paddingBottom: PHONE_BOTTOM }} testID="page-artifacts-phone">
      <View style={st.secH}>
        <Text size="base" weight="medium" color="textSecondary" style={{ flex: 1 }}>
          {t('af.m.count', { n: list.length })}
        </Text>
        <Text size="base" color="textTertiary">
          {t('af.m.byUpdated')}
        </Text>
      </View>
      {list.length === 0 ? (
        <View style={{ paddingHorizontal: space[5], paddingTop: space[3], gap: space[3], alignItems: 'flex-start' }}>
          <Text color="textSecondary">{t('af.empty')}</Text>
          <Button testID="af-new-empty" label={t('af.new')} onPress={onNew} />
        </View>
      ) : null}
      {list.map((a, i) => {
        const v0 = a.versions[0];
        const needs = a.needIds.map((id) => live.needs[id]).filter((n): n is NonNullable<typeof n> => !!n && n.projectId === projectId);
        const shown = needs.length > 3 ? needs.slice(0, 2) : needs;
        return (
          <Pressable
            key={a.id}
            testID="af-item"
            accessibilityRole="button"
            onPress={() => go({ view: 'artifacts', projectId, focusId: a.id })}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.hover }]}
          >
            {i > 0 ? <View style={st.sep} /> : null}
            <View style={st.icon}>
              <Icon name={ARTIFACT_ICON[a.kind]} size={18} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text size="md" weight="medium" tight numberOfLines={2}>
                {noDots(a.title)}
              </Text>
              <View style={st.meta}>
                <Text size="sm" color="textSecondary">
                  {TYPE_WORD[a.kind]}
                </Text>
                {a.where.trim() && a.where.trim().toLowerCase() !== TYPE_WORD[a.kind].toLowerCase() ? (
                  <Text size="sm" color="textTertiary">
                    {noDots(a.where)}
                  </Text>
                ) : null}
                {v0 ? (
                  <Text size="sm" color="textTertiary">
                    {fmtDay(v0.date)}
                  </Text>
                ) : null}
                {a.privateTo === me ? (
                  <Text size="sm" color="textTertiary">
                    {t('pv.mine')}
                  </Text>
                ) : null}
              </View>
            </View>
            {shown.length > 0 ? (
              <View style={st.codes}>
                {shown.map((n) => (
                  <Pressable key={n.id} hitSlop={6} accessibilityRole="link" onPress={() => go({ view: 'board', projectId, needId: n.id })}>
                    <Text size="sm" mono color="textSecondary">
                      {n.code}
                    </Text>
                  </Pressable>
                ))}
                {needs.length > shown.length ? (
                  <Text size="sm" mono color="textTertiary">
                    {`+${needs.length - shown.length}`}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {list.length > 0 ? (
        <Text size="sm" color="textTertiary" style={st.hint}>
          {t('af.m.hint')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  secH: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], marginBottom: space[1] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: space[3], paddingHorizontal: space[5] },
  sep: { position: 'absolute', top: 0, left: 56, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  icon: { width: 22, alignItems: 'center', paddingTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, marginTop: 3 },
  codes: { flexDirection: 'row', gap: space[2], paddingTop: 3 },
  hint: { paddingTop: 14, paddingLeft: 56, paddingRight: space[5] },
});
